use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Duration, Utc};
use rand::RngCore;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use url::Url;

pub const ACCOUNT_VAULT_ID: &str = "account-session-v1";
pub const ACCOUNT_METADATA_KEY: &str = "account.session.metadata";

#[derive(Debug, Clone)]
pub struct AccountAuthAttempt {
    state: String,
    verifier: String,
    redirect_uri: String,
    token_url: String,
    api_base_url: String,
    client_id: String,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountAuthStart {
    pub authorization_url: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountMetadata {
    pub account_id: String,
    pub email: String,
    pub display_name: String,
    pub session_id: String,
    pub expires_at: DateTime<Utc>,
    pub signed_in_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub configured: bool,
    pub signed_in: bool,
    pub metadata: Option<AccountMetadata>,
    pub local_workflows_available: bool,
    pub configuration_error: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    token_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileResponse {
    account_id: String,
    email: String,
    display_name: String,
    session_id: String,
}

struct Configuration {
    authorization_url: String,
    token_url: String,
    api_base_url: String,
    client_id: String,
}

pub fn configured() -> Result<(), String> {
    configuration().map(|_| ())
}

pub fn control_plane_url() -> Result<String, String> {
    configuration().map(|configuration| configuration.api_base_url)
}

pub fn start(
    redirect_uri: String,
    create_account: bool,
) -> Result<(AccountAuthAttempt, AccountAuthStart), String> {
    let configuration = configuration()?;
    let mut state_bytes = [0_u8; 32];
    let mut verifier_bytes = [0_u8; 64];
    rand::rng().fill_bytes(&mut state_bytes);
    rand::rng().fill_bytes(&mut verifier_bytes);
    let state = URL_SAFE_NO_PAD.encode(state_bytes);
    let verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let created_at = Utc::now();
    let mut url = Url::parse(&configuration.authorization_url)
        .map_err(|error| format!("Account authorization URL is invalid: {error}"))?;
    url.query_pairs_mut()
        .append_pair("client_id", &configuration.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email offline_access")
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair(
            "screen_hint",
            if create_account { "signup" } else { "login" },
        );
    Ok((
        AccountAuthAttempt {
            state,
            verifier,
            redirect_uri,
            token_url: configuration.token_url,
            api_base_url: configuration.api_base_url,
            client_id: configuration.client_id,
            created_at,
        },
        AccountAuthStart {
            authorization_url: url.into(),
            expires_at: created_at + Duration::minutes(5),
        },
    ))
}

impl AccountAuthAttempt {
    pub fn validate_callback(&self, callback_url: &str) -> Result<String, String> {
        if Utc::now() - self.created_at > Duration::minutes(5) {
            return Err("The account authorization attempt expired. Start again.".into());
        }
        let url = Url::parse(callback_url)
            .map_err(|_| "The account callback URL is invalid.".to_string())?;
        if let Some(error) = url
            .query_pairs()
            .find(|(key, _)| key == "error")
            .map(|(_, value)| value.into_owned())
        {
            return Err(format!("Account authorization was not completed: {error}."));
        }
        let state = url
            .query_pairs()
            .find(|(key, _)| key == "state")
            .map(|(_, value)| value.into_owned())
            .ok_or_else(|| "Account callback did not include state.".to_string())?;
        if state.len() != self.state.len()
            || !constant_time_equal(state.as_bytes(), self.state.as_bytes())
        {
            return Err("Account OAuth state validation failed. No session was stored.".into());
        }
        url.query_pairs()
            .find(|(key, _)| key == "code")
            .map(|(_, value)| value.into_owned())
            .ok_or_else(|| "Account callback did not include an authorization code.".to_string())
    }

    pub async fn exchange(
        &self,
        client: &Client,
        code: &str,
    ) -> Result<(Value, AccountMetadata), String> {
        let response = client
            .post(&self.token_url)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("code", code),
                ("code_verifier", self.verifier.as_str()),
                ("grant_type", "authorization_code"),
                ("redirect_uri", self.redirect_uri.as_str()),
            ])
            .send()
            .await
            .map_err(|error| format!("Account token exchange could not connect: {error}"))?;
        let status = response.status();
        let body: Value = response.json().await.map_err(|error| {
            format!("Account service returned an invalid token response: {error}")
        })?;
        if !status.is_success() {
            return Err(format!(
                "Account token exchange failed with HTTP {status}: {}",
                body.get("error_description")
                    .and_then(Value::as_str)
                    .or_else(|| body.get("error").and_then(Value::as_str))
                    .unwrap_or("unknown error")
            ));
        }
        let token: TokenResponse = serde_json::from_value(body)
            .map_err(|error| format!("Account token response was incomplete: {error}"))?;
        if !token.token_type.eq_ignore_ascii_case("bearer")
            || token.refresh_token.is_empty()
            || token.access_token.is_empty()
        {
            return Err("Account service returned an unsupported token response.".into());
        }
        let profile_response = client
            .get(format!(
                "{}/v1/account/profile",
                self.api_base_url.trim_end_matches('/')
            ))
            .bearer_auth(&token.access_token)
            .send()
            .await
            .map_err(|error| format!("Account profile verification could not connect: {error}"))?;
        if !profile_response.status().is_success() {
            return Err(format!(
                "Account profile verification failed with HTTP {}.",
                profile_response.status()
            ));
        }
        let profile: ProfileResponse = profile_response
            .json()
            .await
            .map_err(|error| format!("Account profile response was invalid: {error}"))?;
        let expires_at = Utc::now() + Duration::seconds(token.expires_in.clamp(60, 86_400));
        let metadata = AccountMetadata {
            account_id: profile.account_id,
            email: profile.email,
            display_name: profile.display_name,
            session_id: profile.session_id,
            expires_at,
            signed_in_at: Utc::now(),
        };
        Ok((
            json!({"accessToken":token.access_token,"refreshToken":token.refresh_token,"tokenType":"Bearer","expiresAt":expires_at}),
            metadata,
        ))
    }
}

fn configuration() -> Result<Configuration, String> {
    let value = |name: &str| {
        std::env::var(name)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("{name} is not configured in this build."))
    };
    let configuration = Configuration {
        authorization_url: value("SANDBOX_ACCOUNT_AUTH_URL")?,
        token_url: value("SANDBOX_ACCOUNT_TOKEN_URL")?,
        api_base_url: value("SANDBOX_CONTROL_PLANE_URL")?,
        client_id: value("SANDBOX_ACCOUNT_CLIENT_ID")?,
    };
    for (name, url) in [
        ("SANDBOX_ACCOUNT_AUTH_URL", &configuration.authorization_url),
        ("SANDBOX_ACCOUNT_TOKEN_URL", &configuration.token_url),
        ("SANDBOX_CONTROL_PLANE_URL", &configuration.api_base_url),
    ] {
        if !Url::parse(url)
            .is_ok_and(|value| value.scheme() == "https" && value.host_str().is_some())
        {
            return Err(format!("{name} must be an HTTPS URL."));
        }
    }
    Ok(configuration)
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn callback_state_is_required_and_checked() {
        let attempt = AccountAuthAttempt {
            state: "expected".into(),
            verifier: "verifier".into(),
            redirect_uri: "http://127.0.0.1:1234/callback".into(),
            token_url: "https://example.com/token".into(),
            api_base_url: "https://example.com".into(),
            client_id: "desktop".into(),
            created_at: Utc::now(),
        };
        assert_eq!(
            attempt
                .validate_callback("http://127.0.0.1:1234/callback?code=one&state=expected")
                .unwrap(),
            "one"
        );
        assert!(attempt
            .validate_callback("http://127.0.0.1:1234/callback?code=one&state=wrong")
            .unwrap_err()
            .contains("state validation"));
    }
}
