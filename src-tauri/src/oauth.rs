use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Duration, Utc};
use rand::RngCore;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use url::Url;

const GMAIL_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
pub const GMAIL_REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
pub const GMAIL_SCOPES: &str = "openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.send";

#[derive(Debug, Clone)]
pub struct OAuthAttempt {
    pub state: String,
    pub verifier: String,
    pub redirect_uri: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStart {
    pub authorization_url: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
    pub scope: Option<String>,
    pub token_type: Option<String>,
    pub id_token: Option<String>,
}

pub fn gmail_client_id() -> Result<String, String> {
    std::env::var("SANDBOX_GMAIL_CLIENT_ID").ok().filter(|value| !value.trim().is_empty()).ok_or_else(||
        "Gmail OAuth is not configured in this build. Set SANDBOX_GMAIL_CLIENT_ID to a Google Desktop OAuth client ID, then restart Sandbox.".into())
}

pub fn start_gmail(
    client_id: &str,
    redirect_uri: String,
) -> Result<(OAuthAttempt, OAuthStart), String> {
    let mut state_bytes = [0_u8; 32];
    let mut verifier_bytes = [0_u8; 64];
    rand::rng().fill_bytes(&mut state_bytes);
    rand::rng().fill_bytes(&mut verifier_bytes);
    let state = URL_SAFE_NO_PAD.encode(state_bytes);
    let verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let created_at = Utc::now();
    let attempt = OAuthAttempt {
        state: state.clone(),
        verifier,
        redirect_uri: redirect_uri.clone(),
        created_at,
    };
    let mut url = Url::parse(GMAIL_AUTH_URL).map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", GMAIL_SCOPES)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    Ok((
        attempt,
        OAuthStart {
            authorization_url: url.into(),
            expires_at: created_at + Duration::minutes(5),
        },
    ))
}

impl OAuthAttempt {
    pub fn validate_callback(&self, callback_url: &str) -> Result<String, String> {
        if Utc::now() - self.created_at > Duration::minutes(5) {
            return Err(
                "The Gmail authorization attempt expired. Start the connection again.".into(),
            );
        }
        let url = Url::parse(callback_url)
            .map_err(|_| "The OAuth callback URL is invalid.".to_string())?;
        if let Some(error) = url
            .query_pairs()
            .find(|(key, _)| key == "error")
            .map(|(_, value)| value.into_owned())
        {
            return Err(format!("Gmail authorization was not completed: {error}."));
        }
        let state = url
            .query_pairs()
            .find(|(key, _)| key == "state")
            .map(|(_, value)| value.into_owned())
            .ok_or_else(|| "OAuth callback did not include state.".to_string())?;
        if state.as_bytes().len() != self.state.as_bytes().len()
            || !constant_time_equal(state.as_bytes(), self.state.as_bytes())
        {
            return Err("OAuth state validation failed. The connection was not stored.".into());
        }
        url.query_pairs()
            .find(|(key, _)| key == "code")
            .map(|(_, value)| value.into_owned())
            .ok_or_else(|| "OAuth callback did not include an authorization code.".to_string())
    }
}

pub async fn exchange_gmail_code(
    client: &Client,
    client_id: &str,
    attempt: &OAuthAttempt,
    code: &str,
) -> Result<TokenResponse, String> {
    let response = client
        .post(GMAIL_TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("code", code),
            ("code_verifier", attempt.verifier.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", attempt.redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|error| format!("Gmail token exchange could not connect: {error}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Gmail returned an invalid token response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Gmail token exchange failed with HTTP {status}: {}",
            body.get("error_description")
                .and_then(Value::as_str)
                .or_else(|| body.get("error").and_then(Value::as_str))
                .unwrap_or("unknown error")
        ));
    }
    serde_json::from_value(body)
        .map_err(|error| format!("Gmail token response was incomplete: {error}"))
}

pub async fn refresh_gmail_token(
    client: &Client,
    client_id: &str,
    refresh_token: &str,
) -> Result<TokenResponse, String> {
    let response = client
        .post(GMAIL_TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|error| format!("Gmail token refresh could not connect: {error}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Gmail returned an invalid refresh response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Gmail token refresh failed with HTTP {status}. Reconnect the account."
        ));
    }
    serde_json::from_value(body)
        .map_err(|error| format!("Gmail refresh response was incomplete: {error}"))
}

pub fn token_secret(token: &TokenResponse) -> Value {
    json!({"accessToken":token.access_token,"refreshToken":token.refresh_token,"tokenType":token.token_type,"idToken":token.id_token})
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
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
    fn creates_pkce_and_validates_state() {
        let (attempt, start) = start_gmail(
            "desktop-client",
            "http://127.0.0.1:43123/oauth/callback".into(),
        )
        .unwrap();
        assert!(start
            .authorization_url
            .contains("code_challenge_method=S256"));
        let callback = format!(
            "{}?code=code-123&state={}",
            attempt.redirect_uri, attempt.state
        );
        assert_eq!(attempt.validate_callback(&callback).unwrap(), "code-123");
    }
    #[test]
    fn rejects_wrong_oauth_state() {
        let (attempt, _) = start_gmail(
            "desktop-client",
            "http://127.0.0.1:43123/oauth/callback".into(),
        )
        .unwrap();
        assert!(attempt
            .validate_callback("http://127.0.0.1:43123/oauth/callback?code=x&state=wrong")
            .unwrap_err()
            .contains("state validation"));
    }
}
