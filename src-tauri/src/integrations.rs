use crate::{credential_vault::CredentialVault, oauth};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{Duration, Utc};
use sandbox_engine::{ConnectionStatus, Database};
use serde_json::{json, Map, Value};
use std::sync::Arc;
use url::Url;

const GMAIL_API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_PROVIDER_ERROR: usize = 4096;
const MAX_EMAIL_BODY: usize = 1024 * 1024;

pub async fn execute(
    operation: &str,
    payload: Value,
    database: &Database,
    vault: Arc<dyn CredentialVault>,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;
    match operation {
        "gmail_get_email" => gmail_get(&client, payload, database, vault).await,
        "gmail_create_draft" => gmail_write(&client, payload, database, vault, false).await,
        "gmail_send_email" => gmail_write(&client, payload, database, vault, true).await,
        "gmail_add_label" => gmail_labels(&client, payload, database, vault).await,
        "discord_webhook" | "discord_embed" | "slack_webhook" => {
            webhook(&client, operation, payload, database, vault).await
        }
        _ => Err(format!(
            "Integration operation '{operation}' is not supported."
        )),
    }
}

pub async fn poll_gmail(
    workflow_id: &str,
    configuration: &Value,
    database: &Database,
    vault: Arc<dyn CredentialVault>,
) -> Result<Vec<Value>, String> {
    let credential_id = required(
        configuration,
        "credentialId",
        "New Email Trigger requires a Gmail connection.",
    )?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;
    let token = gmail_access(&client, credential_id, database, &vault).await?;
    let mut terms = vec![];
    for (key, prefix) in [
        ("sender", "from:"),
        ("recipient", "to:"),
        ("subjectContains", "subject:"),
    ] {
        if let Some(value) = configuration
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
        {
            terms.push(format!("{prefix}{}", query_term(value)));
        }
    }
    if configuration.get("hasAttachment").and_then(Value::as_bool) == Some(true) {
        terms.push("has:attachment".into());
    }
    if let Some(label) = configuration
        .get("label")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        terms.push(format!("label:{}", query_term(label)));
    }
    let response = client
        .get(format!("{GMAIL_API}/messages"))
        .bearer_auth(&token)
        .query(&[("q", terms.join(" ")), ("maxResults", "25".into())])
        .send()
        .await
        .map_err(|error| format!("New Email polling could not connect to Gmail: {error}"))?;
    let listing = provider_json(response, "New Email polling").await?;
    let mut messages = Vec::new();
    for item in listing
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(message_id) = item.get("id").and_then(Value::as_str) else {
            continue;
        };
        if database
            .gmail_message_processed(workflow_id, message_id)
            .map_err(|error| error.to_string())?
        {
            continue;
        }
        let response = client
            .get(format!("{GMAIL_API}/messages/{message_id}"))
            .query(&[("format", "full")])
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|error| {
                format!("New Email could not retrieve message {message_id}: {error}")
            })?;
        let mut parsed = parse_gmail_message(provider_json(response, "New Email").await?);
        if configuration
            .get("includeHtmlBody")
            .and_then(Value::as_bool)
            != Some(true)
        {
            parsed
                .as_object_mut()
                .map(|object| object.remove("htmlBody"));
        }
        messages.push(parsed);
    }
    Ok(messages)
}

async fn gmail_access(
    client: &reqwest::Client,
    credential_id: &str,
    database: &Database,
    vault: &Arc<dyn CredentialVault>,
) -> Result<String, String> {
    let mut connection = database
        .get_connection(credential_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The selected Gmail connection no longer exists.".to_string())?;
    if connection.provider != "gmail" {
        return Err("The selected credential is not a Gmail connection.".into());
    }
    if connection.status != ConnectionStatus::Connected {
        return Err("The Gmail connection requires reconnection before it can run.".into());
    }
    let mut secret = vault.get(credential_id)?;
    let should_refresh = connection
        .expires_at
        .is_some_and(|expiry| expiry <= Utc::now() + Duration::seconds(60));
    if should_refresh {
        let refresh_token = secret
            .get("refreshToken")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                "The Gmail refresh token is unavailable. Reconnect the account.".to_string()
            })?;
        let client_id = oauth::gmail_client_id()?;
        match oauth::refresh_gmail_token(client, &client_id, refresh_token).await {
            Ok(token) => {
                secret["accessToken"] = Value::String(token.access_token.clone());
                if let Some(new_refresh) = token.refresh_token {
                    secret["refreshToken"] = Value::String(new_refresh);
                }
                vault.put(credential_id, &secret)?;
                connection.expires_at = token
                    .expires_in
                    .map(|seconds| Utc::now() + Duration::seconds(seconds));
                connection.last_used_at = Some(Utc::now());
                database
                    .save_connection(&connection)
                    .map_err(|error| error.to_string())?;
                return Ok(token.access_token);
            }
            Err(error) => {
                connection.status = ConnectionStatus::Expired;
                database
                    .save_connection(&connection)
                    .map_err(|db_error| db_error.to_string())?;
                return Err(error);
            }
        }
    }
    let access = secret
        .get("accessToken")
        .and_then(Value::as_str)
        .ok_or_else(|| "The Gmail access token is unavailable. Reconnect the account.".to_string())?
        .to_string();
    connection.last_used_at = Some(Utc::now());
    database
        .save_connection(&connection)
        .map_err(|error| error.to_string())?;
    Ok(access)
}

async fn gmail_get(
    client: &reqwest::Client,
    payload: Value,
    database: &Database,
    vault: Arc<dyn CredentialVault>,
) -> Result<Value, String> {
    let credential_id = required(
        &payload,
        "credentialId",
        "Get Email requires a Gmail connection.",
    )?;
    let message_id = required(&payload, "messageId", "Get Email requires a message ID.")?;
    let token = gmail_access(client, credential_id, database, &vault).await?;
    let response = client
        .get(format!("{GMAIL_API}/messages/{message_id}"))
        .query(&[("format", "full")])
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Get Email could not connect to Gmail: {error}"))?;
    provider_json(response, "Get Email")
        .await
        .map(parse_gmail_message)
}

async fn gmail_write(
    client: &reqwest::Client,
    payload: Value,
    database: &Database,
    vault: Arc<dyn CredentialVault>,
    send: bool,
) -> Result<Value, String> {
    let credential_id = required(
        &payload,
        "credentialId",
        "Gmail action requires a connection.",
    )?;
    let token = gmail_access(client, credential_id, database, &vault).await?;
    let raw = build_message(&payload)?;
    let thread_id = payload
        .get("replyToMessage")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());
    let body = if send {
        json!({"raw":raw,"threadId":thread_id})
    } else {
        json!({"message":{"raw":raw,"threadId":thread_id}})
    };
    let endpoint = if send {
        format!("{GMAIL_API}/messages/send")
    } else {
        format!("{GMAIL_API}/drafts")
    };
    let response = client
        .post(endpoint)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            format!(
                "Gmail {} could not connect: {error}",
                if send { "Send Email" } else { "Create Draft" }
            )
        })?;
    let result = provider_json(response, if send { "Send Email" } else { "Create Draft" }).await?;
    Ok(
        json!({"id":result.get("id"),"messageId":result.pointer("/message/id").or_else(||result.get("id")),"threadId":result.pointer("/message/threadId").or_else(||result.get("threadId")),"sent":send,"draftCreated":!send}),
    )
}

async fn gmail_labels(
    client: &reqwest::Client,
    payload: Value,
    database: &Database,
    vault: Arc<dyn CredentialVault>,
) -> Result<Value, String> {
    let credential_id = required(
        &payload,
        "credentialId",
        "Add Label requires a Gmail connection.",
    )?;
    let message_id = required(&payload, "messageId", "Add Label requires a message ID.")?;
    let token = gmail_access(client, credential_id, database, &vault).await?;
    let add = payload
        .get("addLabelIds")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let remove = payload
        .get("removeLabelIds")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let response = client
        .post(format!("{GMAIL_API}/messages/{message_id}/modify"))
        .bearer_auth(token)
        .json(&json!({"addLabelIds":add,"removeLabelIds":remove}))
        .send()
        .await
        .map_err(|error| format!("Add Label could not connect to Gmail: {error}"))?;
    let result = provider_json(response, "Add Label").await?;
    Ok(json!({"messageId":message_id,"labelIds":result.get("labelIds")}))
}

async fn webhook(
    client: &reqwest::Client,
    operation: &str,
    payload: Value,
    database: &Database,
    vault: Arc<dyn CredentialVault>,
) -> Result<Value, String> {
    let credential_id = required(
        &payload,
        "credentialId",
        "Webhook action requires a connection.",
    )?;
    let connection = database
        .get_connection(credential_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The selected webhook connection no longer exists.".to_string())?;
    let expected = if operation.starts_with("discord") {
        "discord"
    } else {
        "slack"
    };
    if connection.provider != expected || connection.status != ConnectionStatus::Connected {
        return Err(format!(
            "The selected {} connection is unavailable.",
            provider_label(expected)
        ));
    }
    let secret = vault.get(credential_id)?;
    let webhook_url = secret
        .get("webhookUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            "The webhook URL is missing from the operating-system credential store. Reconnect it."
                .to_string()
        })?;
    validate_webhook(expected, webhook_url)?;
    let body = match operation {
        "discord_embed" => discord_embed_body(&payload),
        _ => {
            json!({"content":payload.get("content"),"text":payload.get("content"),"username":payload.get("username"),"avatar_url":payload.get("avatarUrl")})
        }
    };
    let response = client
        .post(webhook_url)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            format!(
                "{} webhook could not connect: {error}",
                provider_label(expected)
            )
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "{} webhook returned HTTP {status}. Check the connection and channel permissions.",
            provider_label(expected)
        ));
    }
    Ok(json!({"delivered":true,"provider":expected,"status":status.as_u16()}))
}

fn discord_embed_body(payload: &Value) -> Value {
    let mut body = Map::new();
    for (source, target) in [
        ("content", "content"),
        ("username", "username"),
        ("avatarUrl", "avatar_url"),
    ] {
        if let Some(value) = payload
            .get(source)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
        {
            body.insert(target.into(), json!(value));
        }
    }
    let mut embed = Map::new();
    for key in ["title", "description", "url", "timestamp"] {
        if let Some(value) = payload
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
        {
            embed.insert(key.into(), json!(value));
        }
    }
    if let Some(fields) = payload
        .get("fields")
        .and_then(Value::as_array)
        .filter(|fields| !fields.is_empty())
    {
        embed.insert("fields".into(), Value::Array(fields.clone()));
    }
    if let Some(color) = payload.get("color").and_then(Value::as_u64) {
        embed.insert("color".into(), json!(color));
    }
    if let Some(footer) = payload.get("footer").filter(|value| value.is_object()) {
        embed.insert("footer".into(), footer.clone());
    }
    if let Some(image) = payload
        .get("image")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        embed.insert("image".into(), json!({"url":image}));
    }
    body.insert("embeds".into(), json!([Value::Object(embed)]));
    Value::Object(body)
}

fn build_message(payload: &Value) -> Result<String, String> {
    let to = addresses(payload.get("to"));
    if to.is_empty() {
        return Err("Send Email requires at least one recipient.".into());
    }
    let subject = safe_header(payload.get("subject").and_then(Value::as_str).unwrap_or(""))?;
    let mut headers = vec![
        format!("To: {}", to.join(", ")),
        format!("Subject: {subject}"),
        "MIME-Version: 1.0".into(),
    ];
    for (key, label) in [("cc", "Cc"), ("bcc", "Bcc")] {
        let values = addresses(payload.get(key));
        if !values.is_empty() {
            headers.push(format!("{label}: {}", values.join(", ")));
        }
    }
    let html = payload
        .get("htmlBody")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());
    let body = html
        .or_else(|| payload.get("body").and_then(Value::as_str))
        .unwrap_or("");
    headers.push(if html.is_some() {
        "Content-Type: text/html; charset=utf-8".into()
    } else {
        "Content-Type: text/plain; charset=utf-8".into()
    });
    Ok(URL_SAFE_NO_PAD.encode(format!("{}\r\n\r\n{}", headers.join("\r\n"), body).as_bytes()))
}

fn parse_gmail_message(message: Value) -> Value {
    let headers: Map<String, Value> = message
        .pointer("/payload/headers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|header| {
            Some((
                header.get("name")?.as_str()?.to_lowercase(),
                header.get("value")?.clone(),
            ))
        })
        .collect();
    let mut plain = String::new();
    let mut html = String::new();
    collect_body(message.get("payload"), &mut plain, &mut html);
    json!({"messageId":message.get("id"),"threadId":message.get("threadId"),"sender":headers.get("from"),"recipients":headers.get("to"),"subject":headers.get("subject"),"plainTextBody":plain,"htmlBody":html,"receivedDate":headers.get("date"),"labels":message.get("labelIds"),"attachmentMetadata":attachments(message.get("payload"))})
}

fn collect_body(part: Option<&Value>, plain: &mut String, html: &mut String) {
    if let Some(part) = part {
        let mime = part.get("mimeType").and_then(Value::as_str).unwrap_or("");
        if let Some(data) = part
            .pointer("/body/data")
            .and_then(Value::as_str)
            .and_then(|data| URL_SAFE_NO_PAD.decode(data).ok())
        {
            let text = String::from_utf8_lossy(&data);
            let limited: String = text.chars().take(MAX_EMAIL_BODY).collect();
            if mime == "text/plain" {
                plain.push_str(&limited);
            } else if mime == "text/html" {
                html.push_str(&limited);
            }
        }
        for child in part
            .get("parts")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            collect_body(Some(child), plain, html);
        }
    }
}
fn attachments(part: Option<&Value>) -> Vec<Value> {
    let mut result = Vec::new();
    fn walk(part: &Value, out: &mut Vec<Value>) {
        if let Some(name) = part
            .get("filename")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty())
        {
            out.push(json!({"filename":name,"mimeType":part.get("mimeType"),"size":part.pointer("/body/size"),"attachmentId":part.pointer("/body/attachmentId")}));
        }
        for child in part
            .get("parts")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            walk(child, out)
        }
    }
    if let Some(part) = part {
        walk(part, &mut result)
    }
    result
}
fn addresses(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
        Some(Value::String(value)) => value
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
        _ => vec![],
    }
}
fn query_term(value: &str) -> String {
    if value.chars().any(char::is_whitespace) {
        format!("\"{}\"", value.replace('"', ""))
    } else {
        value.to_string()
    }
}
fn safe_header(value: &str) -> Result<String, String> {
    if value.contains(['\r', '\n']) {
        Err("Email headers cannot contain line breaks.".into())
    } else {
        Ok(value.to_string())
    }
}
fn required<'a>(value: &'a Value, key: &str, message: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| message.to_string())
}
fn validate_webhook(provider: &str, value: &str) -> Result<(), String> {
    let url = Url::parse(value)
        .map_err(|_| "Stored webhook URL is invalid. Reconnect it.".to_string())?;
    let valid = url.scheme() == "https"
        && if provider == "discord" {
            ["discord.com", "discordapp.com"].contains(&url.host_str().unwrap_or(""))
                && url.path().starts_with("/api/webhooks/")
        } else {
            url.host_str() == Some("hooks.slack.com") && url.path().starts_with("/services/")
        };
    if valid {
        Ok(())
    } else {
        Err(format!(
            "Stored {} webhook URL does not use the expected HTTPS provider domain.",
            provider_label(provider)
        ))
    }
}
fn provider_label(value: &str) -> &str {
    if value == "discord" {
        "Discord"
    } else {
        "Slack"
    }
}
async fn provider_json(response: reqwest::Response, action: &str) -> Result<Value, String> {
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("{action} response could not be read: {error}"))?;
    if !status.is_success() {
        let detail = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_PROVIDER_ERROR)]);
        return Err(format!("{action} failed with HTTP {status}: {detail}"));
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("{action} returned invalid JSON: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discord_embed_omits_empty_optional_media_and_keeps_design_metadata() {
        let body = discord_embed_body(&json!({
            "username":"sndbox bug reports",
            "title":"Bug: Example",
            "description":"Something happened.",
            "color":15158332,
            "fields":[{"name":"Severity","value":"Critical","inline":true}],
            "footer":{"text":"credentials are never included"},
            "timestamp":"2026-09-01T12:00:00Z",
            "image":""
        }));
        let embed = &body["embeds"][0];
        assert_eq!(embed["color"], 15_158_332);
        assert_eq!(embed["footer"]["text"], "credentials are never included");
        assert!(embed.get("image").is_none());
        assert!(body.get("avatar_url").is_none());
    }
}
