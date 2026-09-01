use crate::credential_vault::CredentialVault;
use chrono::{Duration, Utc};
use reqwest::{blocking::Client, header, Method, StatusCode};
use sandbox_engine::{ConnectionMetadata, ConnectionStatus, Database};
use sandbox_plugin_runtime::{CredentialOperationBroker, PluginError};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{fs, path::Path, sync::Arc, time::Duration as StdDuration};

const GITHUB_API_VERSION: &str = "2026-03-10";
const NOTION_API_VERSION: &str = "2026-03-11";
const MAX_PROVIDER_ERROR: usize = 4096;

pub struct ProviderOperationAdapter {
    database: Database,
    vault: Arc<dyn CredentialVault>,
    client: Client,
}

#[derive(Debug, Clone)]
pub struct PollBatch {
    pub events: Vec<Value>,
    pub event_keys: Vec<String>,
    pub cursor: Value,
}

#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct ProviderResource { pub id:String,pub label:String,pub metadata:Value }

impl ProviderOperationAdapter {
    pub fn new(database: Database, vault: Arc<dyn CredentialVault>) -> Result<Self, PluginError> {
        let client = Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(StdDuration::from_secs(30))
            .user_agent("sndbox/0.8 first-party-provider-host")
            .build()
            .map_err(host)?;
        Ok(Self { database, vault, client })
    }

    pub fn poll(
        &self,
        credential_id: &str,
        provider: &str,
        operation: &str,
        config: &Value,
        cursor: Option<&Value>,
    ) -> Result<PollBatch, PluginError> {
        let connection = self.database.get_connection(credential_id).map_err(storage)?.ok_or_else(||PluginError::Permission("The selected connection no longer exists.".into()))?;
        if connection.provider != provider || connection.status != ConnectionStatus::Connected {
            return Err(PluginError::Permission("The selected polling connection needs attention.".into()));
        }
        if provider=="github_app"{validate_selected_github_repository(&connection,config)?;}
        let secret=self.vault.get(credential_id).map_err(PluginError::Host)?;
        let result=match operation {
            "google.calendar.event_changed" => self.poll_google_calendar(config,cursor,&self.google_access_token(credential_id,secret)?),
            "google.drive.file_changed" => self.poll_google_drive(config,cursor,&self.google_access_token(credential_id,secret)?),
            "google.sheets.row_added" => self.poll_google_sheets(config,cursor,&self.google_access_token(credential_id,secret)?),
            "slack.channel_message_posted" => self.poll_slack(config,cursor,access_token(&secret)?),
            "notion.data_source_page_changed" => self.poll_notion(config,cursor,access_token(&secret)?),
            "github.issue_or_pull_request_changed" => self.poll_github_issues(config,cursor,access_token(&secret)?),
            "github.workflow_run_completed" => self.poll_github_runs(config,cursor,access_token(&secret)?),
            _ => Err(PluginError::Permission(format!("Unsupported polling operation '{operation}'."))),
        };
        if let Err(error)=&result{self.mark_connection_attention_if_needed(&connection,error);}
        result
    }

    pub fn list_resources(&self,credential_id:&str,kind:&str,parent:Option<&str>)->Result<Vec<ProviderResource>,PluginError>{
        let connection=self.database.get_connection(credential_id).map_err(storage)?.ok_or_else(||PluginError::Permission("The selected connection no longer exists.".into()))?;
        if connection.status!=ConnectionStatus::Connected && !(connection.provider=="github_app"&&kind=="github_repository") {return Err(PluginError::Permission("The selected connection needs attention.".into()));}
        let secret=self.vault.get(credential_id).map_err(PluginError::Host)?;
        let token=if connection.provider=="google_workspace"{self.google_access_token(credential_id,secret)?}else{access_token(&secret)?.to_string()};
        match (connection.provider.as_str(),kind){
            ("github_app","github_repository")=>{
                let installations=connection.metadata.get("installations").and_then(Value::as_array).cloned().unwrap_or_default();let mut output=Vec::new();
                for installation in installations{let Some(id)=installation.get("id").and_then(Value::as_u64)else{continue};let result=response_json(self.github_request(Method::GET,format!("https://api.github.com/user/installations/{id}/repositories?per_page=100"),&token).send().map_err(host)?,"List GitHub installation repositories")?;for repository in result.get("repositories").and_then(Value::as_array).cloned().unwrap_or_default(){if let(Some(full_name),Some(repo_id))=(repository.get("full_name").and_then(Value::as_str),repository.get("id")){output.push(ProviderResource{id:full_name.into(),label:full_name.into(),metadata:json!({"repositoryId":repo_id,"installationId":id,"owner":repository.pointer("/owner/login"),"private":repository.get("private"),"permissions":repository.get("permissions")})});}}
                }Ok(output)
            }
            ("github_app","github_workflow")=>{let repository=parent.ok_or_else(||PluginError::Host("Select a repository first.".into()))?;validate_repository(repository)?;let result=response_json(self.github_request(Method::GET,format!("https://api.github.com/repos/{repository}/actions/workflows?per_page=100"),&token).send().map_err(host)?,"List GitHub workflows")?;Ok(result.get("workflows").and_then(Value::as_array).cloned().unwrap_or_default().into_iter().filter_map(|item|Some(ProviderResource{id:item.get("path")?.as_str()?.rsplit('/').next()?.into(),label:item.get("name")?.as_str()?.into(),metadata:json!({"workflowId":item.get("id"),"path":item.get("path"),"state":item.get("state")})})).collect())}
            ("github_app","github_branch")=>{let repository=parent.ok_or_else(||PluginError::Host("Select a repository first.".into()))?;validate_repository(repository)?;let result=response_json(self.github_request(Method::GET,format!("https://api.github.com/repos/{repository}/branches?per_page=100"),&token).send().map_err(host)?,"List GitHub branches")?;Ok(result.as_array().cloned().unwrap_or_default().into_iter().filter_map(|item|Some(ProviderResource{id:item.get("name")?.as_str()?.into(),label:item.get("name")?.as_str()?.into(),metadata:json!({"headSha":item.pointer("/commit/sha"),"protected":item.get("protected")})})).collect())}
            ("slack_oauth","slack_channel")=>{let result=self.slack_json("conversations.list",&token,Some(&[("types","public_channel,private_channel".into()),("limit","200".into())]),None)?;Ok(result.get("channels").and_then(Value::as_array).cloned().unwrap_or_default().into_iter().filter_map(|item|Some(ProviderResource{id:item.get("id")?.as_str()?.into(),label:format!("#{}",item.get("name")?.as_str()?),metadata:json!({"private":item.get("is_private"),"archived":item.get("is_archived")})})).collect())}
            ("notion","notion_data_source")=>{let result=response_json(self.client.post("https://api.notion.com/v1/search").bearer_auth(&token).header("Notion-Version",NOTION_API_VERSION).json(&json!({"filter":{"property":"object","value":"data_source"},"page_size":100})).send().map_err(host)?,"List Notion data sources")?;Ok(result.get("results").and_then(Value::as_array).cloned().unwrap_or_default().into_iter().filter_map(|item|Some(ProviderResource{id:item.get("id")?.as_str()?.into(),label:notion_title(&item),metadata:json!({"url":item.get("url"),"parent":item.get("parent")})})).collect())}
            ("google_workspace","google_calendar")=>{let result=response_json(self.client.get("https://www.googleapis.com/calendar/v3/users/me/calendarList").bearer_auth(&token).query(&[("maxResults","250")]).send().map_err(host)?,"List Google calendars")?;Ok(result.get("items").and_then(Value::as_array).cloned().unwrap_or_default().into_iter().filter_map(|item|Some(ProviderResource{id:item.get("id")?.as_str()?.into(),label:item.get("summary").and_then(Value::as_str).unwrap_or("Calendar").into(),metadata:json!({"primary":item.get("primary"),"accessRole":item.get("accessRole")})})).collect())}
            ("google_workspace","google_spreadsheet")=>{let result=response_json(self.client.get("https://www.googleapis.com/drive/v3/files").bearer_auth(&token).query(&[("q","mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"),("pageSize","1000"),("fields","files(id,name,modifiedTime,webViewLink)")]).send().map_err(host)?,"List Google spreadsheets")?;Ok(result.get("files").and_then(Value::as_array).cloned().unwrap_or_default().into_iter().filter_map(|item|Some(ProviderResource{id:item.get("id")?.as_str()?.into(),label:item.get("name")?.as_str()?.into(),metadata:json!({"modifiedTime":item.get("modifiedTime"),"webViewLink":item.get("webViewLink")})})).collect())}
            _=>Err(PluginError::Permission(format!("Resource picker '{kind}' is not available for {}.",connection.provider))),
        }
    }

    fn mark_connection_attention_if_needed(&self,connection:&ConnectionMetadata,error:&PluginError){
        let message=error.to_string();
        if connection.provider!="github_app"||(!message.contains("permission_missing")&&!message.contains("resource_not_found")&&!message.contains("authentication_expired")){return;}
        let mut updated=connection.clone();updated.status=ConnectionStatus::Error;updated.metadata["attentionReason"]=Value::String(message.chars().take(1000).collect());updated.metadata["lastValidationFailureAt"]=json!(Utc::now());let _=self.database.save_connection(&updated);
    }

    fn poll_google_calendar(&self,config:&Value,cursor:Option<&Value>,token:&str)->Result<PollBatch,PluginError>{
        let calendar=optional_str(config,"calendarId").unwrap_or("primary");
        let mut request=self.client.get(format!("https://www.googleapis.com/calendar/v3/calendars/{}/events",urlencoding::encode(calendar))).bearer_auth(token).query(&[("singleEvents","true"),("maxResults","2500")]);
        if let Some(sync)=cursor.and_then(|value|value.get("syncToken")).and_then(Value::as_str){request=request.query(&[("syncToken",sync)]);}else{request=request.query(&[("timeMin",Utc::now().to_rfc3339())]);}
        let result=response_json(request.send().map_err(host)?,"Calendar polling")?;
        let events=result.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
        let keys=events.iter().filter_map(|event|Some(format!("{}:{}",event.get("id")?.as_str()?,event.get("updated")?.as_str()?))).collect();
        Ok(PollBatch{events,event_keys:keys,cursor:json!({"syncToken":result.get("nextSyncToken"),"observedAt":Utc::now()})})
    }

    fn poll_google_drive(&self,config:&Value,cursor:Option<&Value>,token:&str)->Result<PollBatch,PluginError>{
        let page_token=cursor.and_then(|value|value.get("pageToken")).and_then(Value::as_str);
        if page_token.is_none(){let start=response_json(self.client.get("https://www.googleapis.com/drive/v3/changes/startPageToken").bearer_auth(token).query(&[("supportsAllDrives","true")]).send().map_err(host)?,"Drive polling baseline")?;return Ok(PollBatch{events:vec![],event_keys:vec![],cursor:json!({"pageToken":start.get("startPageToken")})});}
        let mut request=self.client.get("https://www.googleapis.com/drive/v3/changes").bearer_auth(token).query(&[("pageToken",page_token.unwrap()),("pageSize","1000"),("includeRemoved","true"),("supportsAllDrives","true"),("includeItemsFromAllDrives","true"),("fields","nextPageToken,newStartPageToken,changes(fileId,removed,time,file(id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink,driveId))")]);
        if let Some(drive)=optional_str(config,"driveId"){request=request.query(&[("driveId",drive),("corpora","drive")]);}
        let result=response_json(request.send().map_err(host)?,"Drive polling")?;let events=result.get("changes").and_then(Value::as_array).cloned().unwrap_or_default();let keys=events.iter().filter_map(|event|Some(format!("{}:{}",event.get("fileId")?.as_str()?,event.get("time").and_then(Value::as_str).unwrap_or("changed")))).collect();let next=result.get("nextPageToken").or_else(||result.get("newStartPageToken")).cloned().unwrap_or_else(||Value::String(page_token.unwrap().into()));Ok(PollBatch{events,event_keys:keys,cursor:json!({"pageToken":next})})
    }

    fn poll_google_sheets(&self,config:&Value,cursor:Option<&Value>,token:&str)->Result<PollBatch,PluginError>{
        let sheet=required_str(config,"spreadsheetId","Spreadsheet is required.")?;let range=required_str(config,"range","Range is required.")?;let result=response_json(self.client.get(format!("https://sheets.googleapis.com/v4/spreadsheets/{}/values/{}",urlencoding::encode(sheet),urlencoding::encode(range))).bearer_auth(token).query(&[("majorDimension","ROWS")]).send().map_err(host)?,"Sheets polling")?;let rows=result.get("values").and_then(Value::as_array).cloned().unwrap_or_default();let header=config.get("headerRow").and_then(Value::as_u64).unwrap_or(1) as usize;let previous=cursor.and_then(|value|value.get("lastRow")).and_then(Value::as_u64).unwrap_or(rows.len() as u64) as usize;let events=rows.iter().enumerate().skip(previous.max(header)).map(|(index,row)|json!({"rowNumber":index+1,"values":row})).collect::<Vec<_>>();let keys=events.iter().filter_map(|event|event.get("rowNumber").map(|row|format!("{sheet}:{range}:{row}"))).collect();Ok(PollBatch{events,event_keys:keys,cursor:json!({"lastRow":rows.len()})})
    }

    fn poll_slack(&self,config:&Value,cursor:Option<&Value>,token:&str)->Result<PollBatch,PluginError>{
        let channel=required_str(config,"channelId","Channel is required.")?;
        let mut query=vec![("channel",channel.to_string()),("limit","100".into())];
        if let Some(oldest)=cursor.and_then(|value|value.get("latestTs")).and_then(Value::as_str){query.push(("oldest",oldest.into()));query.push(("inclusive","false".into()));}
        let result=self.slack_json("conversations.history",token,Some(&query),None)?;
        let include_bots=config.get("includeBotMessages").and_then(Value::as_bool).unwrap_or(false);
        let include_replies=config.get("includeThreadReplies").and_then(Value::as_bool).unwrap_or(false);
        let mut events=result.get("messages").and_then(Value::as_array).cloned().unwrap_or_default().into_iter().filter(|message|(include_bots||message.get("bot_id").is_none())&&(include_replies||message.get("thread_ts").is_none()||message.get("thread_ts")==message.get("ts"))).collect::<Vec<_>>();
        events.reverse();
        let latest=events.iter().filter_map(|value|value.get("ts").and_then(Value::as_str)).max().or_else(||cursor.and_then(|value|value.get("latestTs")).and_then(Value::as_str)).unwrap_or("0").to_string();
        let keys=events.iter().filter_map(|message|message.get("ts").and_then(Value::as_str).map(|ts|format!("{channel}:{ts}"))).collect();
        Ok(PollBatch{events,event_keys:keys,cursor:json!({"latestTs":latest})})
    }

    fn poll_notion(&self,config:&Value,cursor:Option<&Value>,token:&str)->Result<PollBatch,PluginError>{
        let source=required_str(config,"dataSourceId","Data source is required.")?;
        let body=json!({"page_size":100,"sorts":[{"timestamp":"last_edited_time","direction":"descending"}],"filter":config.get("filter")});
        let result=response_json(self.client.post(format!("https://api.notion.com/v1/data_sources/{source}/query")).bearer_auth(token).header("Notion-Version",NOTION_API_VERSION).json(&body).send().map_err(host)?,"Notion polling")?;
        let previous=cursor.and_then(|value|value.get("lastEditedTime")).and_then(Value::as_str).unwrap_or("");
        let mut pages=result.get("results").and_then(Value::as_array).cloned().unwrap_or_default().into_iter().filter(|page|page.get("last_edited_time").and_then(Value::as_str).is_some_and(|time|time>previous)).collect::<Vec<_>>();
        let latest=pages.iter().filter_map(|page|page.get("last_edited_time").and_then(Value::as_str)).max().unwrap_or(previous).to_string();
        let keys=pages.iter().filter_map(|page|Some(format!("{}:{}",page.get("id")?.as_str()?,page.get("last_edited_time")?.as_str()?))).collect();
        pages.reverse();
        let events=pages.iter().map(normalize_notion_page).collect();
        Ok(PollBatch{events,event_keys:keys,cursor:json!({"lastEditedTime":if latest.is_empty(){Utc::now().to_rfc3339()}else{latest}})})
    }

    fn poll_github_issues(&self,config:&Value,cursor:Option<&Value>,token:&str)->Result<PollBatch,PluginError>{
        let repository=required_str(config,"repository","Repository is required.")?;validate_repository(repository)?;
        let repository_metadata=response_json(self.github_request(Method::GET,format!("https://api.github.com/repos/{repository}"),token).send().map_err(host)?,"GitHub repository metadata")?;
        let repository_id=repository_metadata.get("id").map(ToString::to_string).unwrap_or_else(||repository.to_string());
        let previous=cursor.and_then(|value|value.get("updatedAt")).and_then(Value::as_str);
        let mut query=vec![("state",optional_str(config,"state").unwrap_or("all").to_string()),("per_page","100".into()),("sort","updated".into()),("direction","asc".into())];if let Some(since)=previous{query.push(("since",since.into()));}
        let result=response_json(self.client.get(format!("https://api.github.com/repos/{repository}/issues")).bearer_auth(token).header(header::ACCEPT,"application/vnd.github+json").header("X-GitHub-Api-Version",GITHUB_API_VERSION).query(&query).send().map_err(host)?,"GitHub issue polling")?;
        let record_type=optional_str(config,"recordType").unwrap_or("both");let labels=config.get("labels").and_then(Value::as_array).cloned().unwrap_or_default();let actors=config.get("actors").and_then(Value::as_array).cloned().unwrap_or_default();
        let provider_records=result.as_array().cloned().unwrap_or_default();
        let latest=provider_records.iter().filter_map(|item|item.get("updated_at").and_then(Value::as_str)).max().or(previous).unwrap_or("").to_string();
        let records=provider_records.into_iter().filter(|item|{let is_pr=item.get("pull_request").is_some();(record_type=="both"||(record_type=="pull_request"&&is_pr)||(record_type=="issue"&&!is_pr))&&(labels.is_empty()||item.get("labels").and_then(Value::as_array).is_some_and(|current|labels.iter().all(|wanted|current.iter().any(|label|label.get("name")==Some(wanted)))))&&(actors.is_empty()||actors.iter().any(|actor|item.pointer("/user/login")==Some(actor)))}).collect::<Vec<_>>();
        let keys=records.iter().filter_map(|item|Some(format!("{}:{}:{}",repository_id,item.get("node_id")?.as_str()?,item.get("updated_at")?.as_str()?))).collect();
        let mut events=Vec::with_capacity(records.len());
        for item in records{
            let pull=if item.get("pull_request").is_some(){let number=item.get("number").and_then(Value::as_u64).ok_or_else(||PluginError::Host("GitHub pull request had no number.".into()))?;Some(response_json(self.github_request(Method::GET,format!("https://api.github.com/repos/{repository}/pulls/{number}"),token).send().map_err(host)?,"Enrich polled GitHub pull request")?)}else{None};
            let kind=if previous.is_some_and(|since|item.get("created_at").and_then(Value::as_str).is_some_and(|created|created>since)){"created"}else{"updated"};
            events.push(json!({"changeKind":kind,"snapshot":normalize_issue_or_pull(repository,&item,pull.as_ref())}));
        }
        Ok(PollBatch{events,event_keys:keys,cursor:json!({"updatedAt":if latest.is_empty(){Utc::now().to_rfc3339()}else{latest}})})
    }

    fn poll_github_runs(&self,config:&Value,cursor:Option<&Value>,token:&str)->Result<PollBatch,PluginError>{
        let repository=required_str(config,"repository","Repository is required.")?;validate_repository(repository)?;
        let mut query=vec![("status","completed".to_string()),("per_page","100".into())];for (target,source) in [("branch","branch"),("event","event")]{if let Some(value)=optional_str(config,source){query.push((target,value.into()));}}
        let workflow=optional_str(config,"workflow");let url=workflow.map(|value|format!("https://api.github.com/repos/{repository}/actions/workflows/{}/runs",urlencoding::encode(value))).unwrap_or_else(||format!("https://api.github.com/repos/{repository}/actions/runs"));
        let result=response_json(self.github_request(Method::GET,url,token).query(&query).send().map_err(host)?,"GitHub workflow polling")?;
        let previous=cursor.and_then(|value|value.get("completedAt")).and_then(Value::as_str).unwrap_or("");let workflow=optional_str(config,"workflow");let conclusions=config.get("conclusions").and_then(Value::as_array).cloned().unwrap_or_default();
        let allow_all=conclusions.is_empty()||conclusions.iter().any(|value|value.as_str()==Some("all"));
        let provider_runs=result.get("workflow_runs").and_then(Value::as_array).cloned().unwrap_or_default();
        let latest=provider_runs.iter().filter_map(workflow_completed_time).max().unwrap_or(previous).to_string();
        let mut events=provider_runs.into_iter().filter(|run|workflow_completed_time(run).is_some_and(|time|time>previous)&&workflow.is_none_or(|wanted|run.get("workflow_id").map(|value|value.to_string()).as_deref()==Some(wanted)||run.get("name").and_then(Value::as_str)==Some(wanted)||run.get("path").and_then(Value::as_str).is_some_and(|path|path==wanted||path.ends_with(&format!("/{wanted}"))))&&(allow_all||conclusions.iter().any(|value|run.get("conclusion")==Some(value)))).collect::<Vec<_>>();
        events.sort_by_key(|run|workflow_completed_time(run).unwrap_or("").to_string());
        let keys=events.iter().filter_map(|run|Some(format!("{}:{}:{}",run.get("id")?,run.get("run_attempt").map(ToString::to_string).unwrap_or_else(||"1".into()),workflow_completed_time(run)?))).collect();
        let events=events.iter().map(normalize_workflow_run).collect();
        Ok(PollBatch{events,event_keys:keys,cursor:json!({"completedAt":if latest.is_empty(){Utc::now().to_rfc3339()}else{latest}})})
    }

    fn execute_inner(
        &self,
        credential_id: &str,
        provider: &str,
        operation: &str,
        input: &Value,
    ) -> Result<Value, PluginError> {
        let connection = self
            .database
            .get_connection(credential_id)
            .map_err(storage)?
            .ok_or_else(|| PluginError::Permission("The selected connection no longer exists.".into()))?;
        if connection.provider != provider {
            return Err(PluginError::Permission(format!(
                "The selected connection is {}, not {provider}.",
                connection.provider
            )));
        }
        if connection.status != ConnectionStatus::Connected {
            return Err(PluginError::Permission(
                "The selected connection needs attention before it can run.".into(),
            ));
        }
        let arguments = input.get("arguments").unwrap_or(input);
        let configuration = arguments.get("configuration").unwrap_or(arguments);
        if provider=="github_app"{validate_selected_github_repository(&connection,configuration)?;}
        let secret = self.vault.get(credential_id).map_err(PluginError::Host)?;
        let result = match provider {
            "google_workspace" => {
                let token = self.google_access_token(credential_id, secret)?;
                self.google(operation, configuration, &token, input)
            }
            "slack_oauth" => self.slack(operation, configuration, access_token(&secret)?, input),
            "notion" => self.notion(operation, configuration, access_token(&secret)?),
            "github_app" => self.github(operation, configuration, access_token(&secret)?),
            _ => Err(PluginError::Permission(format!(
                "Provider '{provider}' is not registered."
            ))),
        };
        if let Err(error)=&result{self.mark_connection_attention_if_needed(&connection,error);}
        let result=result?;
        if let Some(mut connection) = self.database.get_connection(credential_id).map_err(storage)? {
            connection.last_used_at = Some(Utc::now());
            self.database.save_connection(&connection).map_err(storage)?;
        }
        Ok(result)
    }

    fn google_access_token(&self, credential_id: &str, mut secret: Value) -> Result<String, PluginError> {
        let mut connection = self
            .database
            .get_connection(credential_id)
            .map_err(storage)?
            .ok_or_else(|| PluginError::Permission("Google Workspace connection is missing.".into()))?;
        let needs_refresh = connection
            .expires_at
            .is_some_and(|expires| expires <= Utc::now() + Duration::seconds(60));
        if needs_refresh {
            let refresh = secret
                .get("refreshToken")
                .and_then(Value::as_str)
                .ok_or_else(|| PluginError::Permission("Google authorization expired; reconnect it.".into()))?;
            let client_id = std::env::var("SANDBOX_GOOGLE_WORKSPACE_CLIENT_ID")
                .or_else(|_| std::env::var("SANDBOX_GMAIL_CLIENT_ID"))
                .map_err(|_| PluginError::Host("Google Workspace OAuth client is not configured.".into()))?;
            let response = self
                .client
                .post("https://oauth2.googleapis.com/token")
                .form(&[
                    ("client_id", client_id.as_str()),
                    ("refresh_token", refresh),
                    ("grant_type", "refresh_token"),
                ])
                .send()
                .map_err(host)?;
            let token = response_json(response, "Google token refresh")?;
            let access = required_str(&token, "access_token", "Google did not return an access token.")?.to_string();
            secret["accessToken"] = Value::String(access.clone());
            self.vault.put(credential_id, &secret).map_err(PluginError::Host)?;
            connection.expires_at = token
                .get("expires_in")
                .and_then(Value::as_i64)
                .map(|seconds| Utc::now() + Duration::seconds(seconds));
            self.database.save_connection(&connection).map_err(storage)?;
            return Ok(access);
        }
        access_token(&secret).map(str::to_string)
    }

    fn google(&self, operation: &str, config: &Value, token: &str, input: &Value) -> Result<Value, PluginError> {
        match operation {
            "google.calendar.list_events" => {
                let calendar = optional_str(config, "calendarId").unwrap_or("primary");
                let mut query = vec![("singleEvents", "true".to_string()), ("orderBy", "startTime".to_string())];
                push_query(&mut query, "timeMin", config, "timeMin");
                push_query(&mut query, "timeMax", config, "timeMax");
                push_query(&mut query, "q", config, "query");
                let response = self.client.get(format!("https://www.googleapis.com/calendar/v3/calendars/{}/events", urlencoding::encode(calendar))).bearer_auth(token).query(&query).send().map_err(host)?;
                response_json(response, "List Calendar Events")
            }
            "google.calendar.create_event" | "google.calendar.update_event" => {
                let calendar = optional_str(config, "calendarId").unwrap_or("primary");
                let body = calendar_body(config);
                let request = if operation.ends_with("update_event") {
                    let event = required_str(config, "eventId", "Update Calendar Event requires eventId.")?;
                    self.client.patch(format!("https://www.googleapis.com/calendar/v3/calendars/{}/events/{}", urlencoding::encode(calendar), urlencoding::encode(event)))
                } else {
                    self.client.post(format!("https://www.googleapis.com/calendar/v3/calendars/{}/events", urlencoding::encode(calendar)))
                };
                response_json(request.bearer_auth(token).json(&body).send().map_err(host)?, if operation.ends_with("update_event") { "Update Calendar Event" } else { "Create Calendar Event" })
            }
            "google.drive.search_files" => {
                let mut request = self.client.get("https://www.googleapis.com/drive/v3/files").bearer_auth(token).query(&[("q", required_str(config, "query", "Search Drive Files requires query.")?), ("pageSize", &config.get("pageSize").and_then(Value::as_u64).unwrap_or(100).to_string()), ("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink,driveId)")]);
                if let Some(drive) = optional_str(config, "driveId") { request = request.query(&[("driveId", drive), ("corpora", "drive"), ("includeItemsFromAllDrives", "true"), ("supportsAllDrives", "true")]); }
                response_json(request.send().map_err(host)?, "Search Drive Files")
            }
            "google.drive.upload_file" => {
                let grant = required_str(config, "fileGrant", "Upload Drive File requires a file grant.")?;
                let (path, bytes) = self.file_bytes(grant, input)?;
                let name = optional_str(config, "name").or_else(|| Path::new(&path).file_name().and_then(|value| value.to_str())).unwrap_or("upload.bin");
                let mime = optional_str(config, "mimeType").unwrap_or("application/octet-stream");
                let mut metadata = json!({"name": name});
                if let Some(parent) = optional_str(config, "parentFolderId") { metadata["parents"] = json!([parent]); }
                let boundary = format!("sndbox-{}", uuid::Uuid::new_v4());
                let mut body = format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--{boundary}\r\nContent-Type: {mime}\r\n\r\n", metadata).into_bytes();
                body.extend_from_slice(&bytes);
                body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
                let response = self.client.post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink").bearer_auth(token).header(header::CONTENT_TYPE, format!("multipart/related; boundary={boundary}")).body(body).send().map_err(host)?;
                let result = response_json(response, "Upload Drive File")?;
                self.database.consume_file_grant(grant).map_err(storage)?;
                Ok(result)
            }
            "google.sheets.read_range" => {
                let sheet = required_str(config, "spreadsheetId", "Read Sheet Range requires spreadsheetId.")?;
                let range = required_str(config, "range", "Read Sheet Range requires range.")?;
                response_json(self.client.get(format!("https://sheets.googleapis.com/v4/spreadsheets/{}/values/{}", urlencoding::encode(sheet), urlencoding::encode(range))).bearer_auth(token).query(&[("majorDimension", optional_str(config, "majorDimension").unwrap_or("ROWS"))]).send().map_err(host)?, "Read Sheet Range")
            }
            "google.sheets.append_rows" | "google.sheets.update_range" => {
                let sheet = required_str(config, "spreadsheetId", "Sheets action requires spreadsheetId.")?;
                let range = required_str(config, "range", "Sheets action requires range.")?;
                let values = config.get(if operation.ends_with("append_rows") { "rows" } else { "values" }).cloned().unwrap_or_else(|| json!([]));
                let base = format!("https://sheets.googleapis.com/v4/spreadsheets/{}/values/{}", urlencoding::encode(sheet), urlencoding::encode(range));
                let option = optional_str(config, "valueInputOption").unwrap_or("USER_ENTERED");
                let request = if operation.ends_with("append_rows") { self.client.post(format!("{base}:append")).query(&[("valueInputOption", option), ("insertDataOption", "INSERT_ROWS")]) } else { self.client.put(base).query(&[("valueInputOption", option)]) };
                response_json(request.bearer_auth(token).json(&json!({"majorDimension":"ROWS","values":values})).send().map_err(host)?, "Write Sheet Range")
            }
            _ => Err(PluginError::Permission(format!("Unsupported Google operation '{operation}'."))),
        }
    }

    fn slack(&self, operation: &str, config: &Value, token: &str, input: &Value) -> Result<Value, PluginError> {
        match operation {
            "slack.list_channel_messages" => {
                let mut query = vec![("channel", required_str(config, "channelId", "Channel is required.")?.to_string()), ("limit", config.get("limit").and_then(Value::as_u64).unwrap_or(15).min(100).to_string())];
                push_query(&mut query, "oldest", config, "oldest"); push_query(&mut query, "latest", config, "latest");
                self.slack_json("conversations.history", token, Some(&query), None)
            }
            "slack.send_message" | "slack.reply_to_thread" => {
                let mut body = json!({"channel":required_str(config,"channelId","Channel is required.")?,"text":required_str(config,"text","Message text is required.")?});
                if let Some(blocks) = config.get("blocks").filter(|value| value.as_object().is_some_and(|object| !object.is_empty())) { body["blocks"] = blocks.clone(); }
                if operation.ends_with("reply_to_thread") { body["thread_ts"] = Value::String(required_str(config,"threadTs","Thread timestamp is required.")?.into()); }
                self.slack_json("chat.postMessage", token, None, Some(&body))
            }
            "slack.add_reaction" => self.slack_json("reactions.add", token, None, Some(&json!({"channel":required_str(config,"channelId","Channel is required.")?,"timestamp":required_str(config,"timestamp","Message timestamp is required.")?,"name":required_str(config,"emoji","Emoji name is required.")?}))),
            "slack.upload_file" => {
                let grant = required_str(config, "fileGrant", "Upload Slack File requires a file grant.")?;
                let (path, bytes) = self.file_bytes(grant, input)?;
                let filename = optional_str(config,"filename").or_else(||Path::new(&path).file_name().and_then(|value|value.to_str())).unwrap_or("upload.bin");
                let upload = self.slack_json("files.getUploadURLExternal", token, Some(&[("filename",filename.to_string()),("length",bytes.len().to_string())]), None)?;
                let upload_url = required_str(&upload,"upload_url","Slack did not return an upload URL.")?;
                let file_id = required_str(&upload,"file_id","Slack did not return a file ID.")?;
                let part = reqwest::blocking::multipart::Part::bytes(bytes).file_name(filename.to_string());
                let response = self.client.post(upload_url).multipart(reqwest::blocking::multipart::Form::new().part("file",part)).send().map_err(host)?;
                if !response.status().is_success() { return Err(provider_status("Slack file transfer", response)); }
                let mut body = json!({"files":[{"id":file_id,"title":optional_str(config,"title").unwrap_or(filename)}],"channel_id":required_str(config,"channelId","Channel is required.")?});
                for (source,target) in [("initialComment","initial_comment"),("threadTs","thread_ts")] { if let Some(value)=optional_str(config,source){ body[target]=Value::String(value.into()); } }
                let result = self.slack_json("files.completeUploadExternal", token, None, Some(&body))?;
                self.database.consume_file_grant(grant).map_err(storage)?;
                Ok(result)
            }
            _ => Err(PluginError::Permission(format!("Unsupported Slack operation '{operation}'."))),
        }
    }

    fn slack_json(&self, method: &str, token: &str, query: Option<&[(&str, String)]>, body: Option<&Value>) -> Result<Value, PluginError> {
        let mut request = if body.is_some() { self.client.post(format!("https://slack.com/api/{method}")) } else { self.client.get(format!("https://slack.com/api/{method}")) }.bearer_auth(token);
        if let Some(query) = query { request = request.query(query); }
        if let Some(body) = body { request = request.json(body); }
        let result = response_json(request.send().map_err(host)?, "Slack API")?;
        if result.get("ok").and_then(Value::as_bool) != Some(true) { return Err(PluginError::Host(format!("Slack rejected the operation: {}", result.get("error").and_then(Value::as_str).unwrap_or("unknown_error")))); }
        Ok(result)
    }

    fn notion(&self, operation: &str, config: &Value, token: &str) -> Result<Value, PluginError> {
        let (method, url, body) = match operation {
            "notion.query_data_source" => (Method::POST, format!("https://api.notion.com/v1/data_sources/{}/query", required_str(config,"dataSourceId","Data source is required.")?), json!({"filter":config.get("filter"),"sorts":config.get("sorts"),"page_size":config.get("pageSize").and_then(Value::as_u64).unwrap_or(100)})),
            "notion.get_page" => (Method::GET, format!("https://api.notion.com/v1/pages/{}", required_str(config,"pageId","Page ID is required.")?), Value::Null),
            "notion.create_page" => (Method::POST, "https://api.notion.com/v1/pages".into(), json!({"parent":{optional_str(config,"parentType").unwrap_or("data_source_id"):required_str(config,"parentId","Parent ID is required.")?},"properties":config.get("properties").cloned().unwrap_or_else(||json!({})),"children":config.get("children").cloned().unwrap_or_else(||json!([]))})),
            "notion.update_page" => (Method::PATCH, format!("https://api.notion.com/v1/pages/{}", required_str(config,"pageId","Page ID is required.")?), json!({"properties":config.get("properties").cloned().unwrap_or_else(||json!({})),"archived":config.get("archived").cloned().unwrap_or(Value::Null)})),
            _ => return Err(PluginError::Permission(format!("Unsupported Notion operation '{operation}'."))),
        };
        let mut request = self.client.request(method.clone(), url).bearer_auth(token).header("Notion-Version", NOTION_API_VERSION);
        if method != Method::GET { request = request.json(&body); }
        let result=response_json(request.send().map_err(host)?, "Notion API")?;
        Ok(if operation=="notion.query_data_source"{
            let pages=result.get("results").and_then(Value::as_array).cloned().unwrap_or_default().iter().map(normalize_notion_page).collect::<Vec<_>>();
            json!({"results":pages,"hasMore":result.get("has_more"),"nextCursor":result.get("next_cursor"),"rawProviderPayload":result})
        }else{normalize_notion_page(&result)})
    }

    fn github(&self, operation: &str, config: &Value, token: &str) -> Result<Value, PluginError> {
        let repository = required_str(config, "repository", "GitHub repository is required.")?;
        validate_repository(repository)?;
        let base = format!("https://api.github.com/repos/{repository}");
        if operation == "github.get_issue_or_pull_request" {
            let issue=response_json(self.github_request(Method::GET,format!("{base}/issues/{}",number(config,"number")?),token).send().map_err(host)?,"Get GitHub issue or pull request")?;
            let pull=if issue.get("pull_request").is_some(){Some(response_json(self.github_request(Method::GET,format!("{base}/pulls/{}",number(config,"number")?),token).send().map_err(host)?,"Enrich GitHub pull request")?)}else{None};
            return Ok(normalize_issue_or_pull(repository,&issue,pull.as_ref()));
        }
        let (method, url, body, empty_ok) = match operation {
            "github.create_issue" => (Method::POST, format!("{base}/issues"), compact_json(config, &[("title","title"),("body","body"),("assignees","assignees"),("labels","labels"),("milestone","milestone")]), false),
            "github.update_issue" => (Method::PATCH, format!("{base}/issues/{}", number(config,"number")?), compact_json(config, &[("title","title"),("body","body"),("state","state"),("state_reason","stateReason"),("assignees","assignees"),("labels","labels"),("milestone","milestone")]), false),
            "github.add_comment" => (Method::POST, format!("{base}/issues/{}/comments", number(config,"number")?), json!({"body":required_str(config,"body","Comment body is required.")?}), false),
            "github.create_pull_request" => (Method::POST, format!("{base}/pulls"), compact_json(config, &[("title","title"),("head","head"),("base","base"),("body","body"),("draft","draft"),("maintainer_can_modify","maintainerCanModify")]), false),
            "github.update_pull_request" => (Method::PATCH, format!("{base}/pulls/{}", number(config,"number")?), compact_json(config, &[("title","title"),("body","body"),("state","state"),("base","base"),("maintainer_can_modify","maintainerCanModify")]), false),
            "github.request_reviewers" => {
                let reviewers = config.get("reviewers").and_then(Value::as_array).map_or(0,Vec::len);
                let teams = config.get("teamReviewers").and_then(Value::as_array).map_or(0,Vec::len);
                if reviewers + teams == 0 { return Err(PluginError::Host("Request Reviewers needs at least one user or team.".into())); }
                (Method::POST, format!("{base}/pulls/{}/requested_reviewers",number(config,"number")?), json!({"reviewers":config.get("reviewers").cloned().unwrap_or_else(||json!([])),"team_reviewers":config.get("teamReviewers").cloned().unwrap_or_else(||json!([]))}), false)
            }
            "github.merge_pull_request" => (Method::PUT, format!("{base}/pulls/{}/merge",number(config,"number")?), compact_json(config,&[("sha","expectedHeadSha"),("merge_method","mergeMethod"),("commit_title","commitTitle"),("commit_message","commitMessage")]), false),
            "github.get_workflow_run" => (Method::GET,format!("{base}/actions/runs/{}",number(config,"runId")?),Value::Null,false),
            "github.dispatch_workflow" => (Method::POST,format!("{base}/actions/workflows/{}/dispatches",urlencoding::encode(required_str(config,"workflow","Workflow is required.")?)),json!({"ref":required_str(config,"ref","Git ref is required.")?,"inputs":config.get("inputs").cloned().unwrap_or_else(||json!({}))}),true),
            "github.cancel_workflow_run" => (Method::POST,format!("{base}/actions/runs/{}/cancel",number(config,"runId")?),Value::Null,true),
            _ => return Err(PluginError::Permission(format!("Unsupported GitHub operation '{operation}'."))),
        };
        let mut request = self.github_request(method.clone(),url,token);
        if method != Method::GET && !body.is_null() { request=request.json(&body); }
        let response=request.send().map_err(host)?;
        if operation=="github.cancel_workflow_run" && response.status()==StatusCode::CONFLICT { return Ok(json!({"accepted":false,"runId":config.get("runId"),"reason":"already_completed","requestedAt":Utc::now()})); }
        if empty_ok && response.status().is_success() {
            return Ok(if operation=="github.dispatch_workflow" {json!({"accepted":true,"repository":repository,"workflow":config.get("workflow"),"ref":config.get("ref"),"dispatchedAt":Utc::now()})}else{json!({"accepted":true,"runId":config.get("runId"),"requestedAt":Utc::now()})});
        }
        let result=response_json(response,"GitHub API")?;
        Ok(match operation {
            "github.create_issue"|"github.update_issue"=>normalize_issue_or_pull(repository,&result,None),
            "github.add_comment"=>normalize_comment(&result),
            "github.create_pull_request"|"github.update_pull_request"=>normalize_pull(repository,&result),
            "github.request_reviewers"=>json!({"requestedUsers":result.get("requested_reviewers").cloned().unwrap_or_else(||json!([])),"requestedTeams":result.get("requested_teams").cloned().unwrap_or_else(||json!([]))}),
            "github.merge_pull_request"=>json!({"merged":result.get("merged").cloned().unwrap_or(Value::Bool(false)),"mergeSha":result.get("sha"),"message":result.get("message"),"url":format!("https://github.com/{repository}/pull/{}",number(config,"number")?)}),
            "github.get_workflow_run"=>normalize_workflow_run(&result),
            _=>result,
        })
    }

    fn github_request(&self,method:Method,url:String,token:&str)->reqwest::blocking::RequestBuilder{
        self.client.request(method,url).bearer_auth(token).header(header::ACCEPT,"application/vnd.github+json").header("X-GitHub-Api-Version",GITHUB_API_VERSION)
    }

    fn file_bytes(&self, grant: &str, input: &Value) -> Result<(String, Vec<u8>), PluginError> {
        if !input.get("fileGrants").and_then(Value::as_array).is_some_and(|values|values.iter().any(|value|value.as_str()==Some(grant))) {
            return Err(PluginError::Permission("The file was not granted to this invocation.".into()));
        }
        let (path, maximum) = self.database.resolve_file_grant(grant).map_err(storage)?.ok_or_else(||PluginError::Permission("The file grant is missing, expired, or already consumed.".into()))?;
        let metadata=fs::metadata(&path).map_err(host)?;
        if !metadata.is_file(){return Err(PluginError::Permission("File grants cannot reference directories.".into()));}
        if metadata.len()>maximum{return Err(PluginError::ResourceLimit(format!("File exceeds the {maximum}-byte grant limit.")));}
        let bytes=fs::read(&path).map_err(host)?;
        Ok((path,bytes))
    }
}

impl CredentialOperationBroker for ProviderOperationAdapter {
    fn execute(&self, credential_id: &str, credential_type: &str, operation: &str, input: &Value) -> Result<Value, PluginError> {
        self.execute_inner(credential_id,credential_type,operation,input)
    }
}

fn response_json(response: reqwest::blocking::Response, action: &str) -> Result<Value, PluginError> {
    let status=response.status();
    if status==StatusCode::NO_CONTENT{return Ok(json!({"accepted":true}));}
    if !status.is_success(){return Err(provider_status(action,response));}
    response.json().map_err(|error|PluginError::Host(format!("{action} returned invalid JSON: {error}")))
}

fn provider_status(action:&str,response:reqwest::blocking::Response)->PluginError{
    let status=response.status();
    let retry_after=response.headers().get(header::RETRY_AFTER).and_then(|value|value.to_str().ok()).map(str::to_string);
    let rate_remaining_zero=response.headers().get("x-ratelimit-remaining").and_then(|value|value.to_str().ok())==Some("0");
    let reset_delay=response.headers().get("x-ratelimit-reset").and_then(|value|value.to_str().ok()).and_then(|value|value.parse::<i64>().ok()).map(|reset|(reset-Utc::now().timestamp()).max(1).to_string());
    let detail=response.text().unwrap_or_default();
    let detail:String=detail.chars().take(MAX_PROVIDER_ERROR).collect();
    let rate_limited=status==StatusCode::TOO_MANY_REQUESTS||(status==StatusCode::FORBIDDEN&&(retry_after.is_some()||rate_remaining_zero||detail.to_ascii_lowercase().contains("rate limit")));
    let retry=retry_after.or(reset_delay);
    let classification=if rate_limited{"rate_limited"}else{match status.as_u16(){401=>"authentication_expired",403=>"permission_missing",404=>"resource_not_found",409=>"conflict_or_stale_revision",422=>"validation_failure",500..=599=>"transient_provider_failure",_=>"permanent_provider_failure"}};
    PluginError::Host(format!("{classification}: {action} failed with HTTP {status}{}: {detail}",retry.map(|value|format!("; retry after {value}")).unwrap_or_default()))
}

fn calendar_body(config:&Value)->Value{
    let mut body=compact_json(config,&[("summary","summary"),("description","description"),("attendees","attendees")]);
    for key in ["start","end"]{if let Some(value)=optional_str(config,key){body[key]=json!({"dateTime":value,"timeZone":optional_str(config,"timeZone")});}}
    if let Some(attendees)=body.get_mut("attendees").and_then(Value::as_array_mut){*attendees=attendees.iter().filter_map(Value::as_str).map(|email|json!({"email":email})).collect();}
    body
}

fn compact_json(config:&Value,mapping:&[(&str,&str)])->Value{
    let mut output=Map::new();
    for (target,source) in mapping{if let Some(value)=config.get(*source).filter(|value|!value.is_null()&&value.as_str()!=Some("")){output.insert((*target).into(),value.clone());}}
    Value::Object(output)
}

fn access_token(secret:&Value)->Result<&str,PluginError>{required_str(secret,"accessToken","The connection access token is unavailable; reconnect it.")}
fn optional_str<'a>(value:&'a Value,key:&str)->Option<&'a str>{value.get(key).and_then(Value::as_str).filter(|value|!value.trim().is_empty())}
fn required_str<'a>(value:&'a Value,key:&str,message:&str)->Result<&'a str,PluginError>{optional_str(value,key).ok_or_else(||PluginError::Host(message.into()))}
fn number(value:&Value,key:&str)->Result<u64,PluginError>{value.get(key).and_then(Value::as_u64).ok_or_else(||PluginError::Host(format!("{key} must be a positive integer.")))}
fn push_query(query:&mut Vec<(&'static str,String)>,target:&'static str,config:&Value,source:&str){if let Some(value)=optional_str(config,source){query.push((target,value.into()));}}
fn validate_repository(value:&str)->Result<(),PluginError>{let parts=value.split('/').collect::<Vec<_>>();if parts.len()!=2||parts.iter().any(|part|part.is_empty()||!part.chars().all(|c|c.is_ascii_alphanumeric()||matches!(c,'-'|'_'|'.'))){Err(PluginError::Host("Repository must use owner/name format.".into()))}else{Ok(())}}
fn workflow_completed_time(run:&Value)->Option<&str>{run.get("completed_at").or_else(||run.get("updated_at")).and_then(Value::as_str)}
fn validate_selected_github_repository(connection:&ConnectionMetadata,config:&Value)->Result<(),PluginError>{
    let Some(repository)=optional_str(config,"repository")else{return Ok(());};
    let selected=connection.metadata.get("selectedRepositories").and_then(Value::as_array).ok_or_else(||PluginError::Permission("Select a GitHub App installation and its allowed repositories in Connection settings.".into()))?;
    if !selected.iter().any(|item|item.as_str()==Some(repository)||item.get("fullName").and_then(Value::as_str)==Some(repository)){return Err(PluginError::Permission(format!("Repository '{repository}' is not selected for this GitHub App connection.")));}
    Ok(())
}
fn notion_title(value:&Value)->String{value.get("title").and_then(Value::as_array).and_then(|parts|parts.iter().filter_map(|part|part.get("plain_text").and_then(Value::as_str)).next()).unwrap_or("Untitled data source").to_string()}
fn normalize_issue_or_pull(repository:&str,issue:&Value,pull:Option<&Value>)->Value{
    let is_pull=issue.get("pull_request").is_some()||pull.is_some();
    json!({
        "repository":repository,"repositoryId":issue.pointer("/repository/id"),"type":if is_pull{"pull_request"}else{"issue"},
        "id":issue.get("id"),"nodeId":issue.get("node_id"),"number":issue.get("number"),"state":issue.get("state"),"stateReason":issue.get("state_reason"),
        "title":issue.get("title"),"body":issue.get("body"),"author":issue.pointer("/user/login"),
        "assignees":issue.get("assignees").and_then(Value::as_array).map(|items|items.iter().filter_map(|item|item.get("login").cloned()).collect::<Vec<_>>()).unwrap_or_default(),
        "labels":issue.get("labels").and_then(Value::as_array).map(|items|items.iter().filter_map(|item|item.get("name").cloned()).collect::<Vec<_>>()).unwrap_or_default(),
        "milestone":issue.get("milestone"),"createdAt":issue.get("created_at"),"updatedAt":issue.get("updated_at"),"closedAt":issue.get("closed_at"),
        "commentsCount":issue.get("comments"),"apiUrl":issue.get("url"),"htmlUrl":issue.get("html_url"),
        "pullRequest":pull.map(|value|json!({"draft":value.get("draft"),"merged":value.get("merged"),"mergeable":value.get("mergeable"),"mergeableState":value.get("mergeable_state"),"headRef":value.pointer("/head/ref"),"headSha":value.pointer("/head/sha"),"baseRef":value.pointer("/base/ref"),"baseSha":value.pointer("/base/sha"),"maintainerCanModify":value.get("maintainer_can_modify"),"requestedReviewers":value.get("requested_reviewers"),"requestedTeams":value.get("requested_teams"),"commits":value.get("commits"),"additions":value.get("additions"),"deletions":value.get("deletions"),"changedFiles":value.get("changed_files")}))
    })
}
fn normalize_pull(repository:&str,pull:&Value)->Value{
    let issue=json!({"id":pull.get("id"),"node_id":pull.get("node_id"),"number":pull.get("number"),"state":pull.get("state"),"title":pull.get("title"),"body":pull.get("body"),"user":pull.get("user"),"assignees":pull.get("assignees"),"labels":pull.get("labels"),"milestone":pull.get("milestone"),"created_at":pull.get("created_at"),"updated_at":pull.get("updated_at"),"closed_at":pull.get("closed_at"),"comments":pull.get("comments"),"url":pull.get("url"),"html_url":pull.get("html_url"),"pull_request":{}});
    normalize_issue_or_pull(repository,&issue,Some(pull))
}
fn normalize_comment(comment:&Value)->Value{json!({"commentId":comment.get("id"),"nodeId":comment.get("node_id"),"body":comment.get("body"),"author":comment.pointer("/user/login"),"createdAt":comment.get("created_at"),"updatedAt":comment.get("updated_at"),"url":comment.get("html_url")})}
fn normalize_workflow_run(run:&Value)->Value{json!({"runId":run.get("id"),"runAttempt":run.get("run_attempt"),"workflowId":run.get("workflow_id"),"workflowName":run.get("name"),"status":run.get("status"),"conclusion":run.get("conclusion"),"event":run.get("event"),"branch":run.get("head_branch"),"headSha":run.get("head_sha"),"actor":run.pointer("/actor/login"),"createdAt":run.get("created_at"),"updatedAt":run.get("updated_at"),"runStartedAt":run.get("run_started_at"),"completedAt":run.get("updated_at"),"htmlUrl":run.get("html_url"),"jobsUrl":run.get("jobs_url"),"artifactsUrl":run.get("artifacts_url")})}
fn normalize_notion_page(page:&Value)->Value{
    let properties=page.get("properties").and_then(Value::as_object).map(|values|Value::Object(values.iter().map(|(name,property)|{
        let kind=property.get("type").and_then(Value::as_str).unwrap_or("unknown");
        (name.clone(),json!({"id":property.get("id"),"type":kind,"value":property.get(kind).cloned().unwrap_or(Value::Null)}))
    }).collect())).unwrap_or_else(||json!({}));
    json!({"id":page.get("id"),"url":page.get("url"),"createdAt":page.get("created_time"),"lastEditedAt":page.get("last_edited_time"),"archived":page.get("archived"),"inTrash":page.get("in_trash"),"parent":page.get("parent"),"properties":properties,"rawProviderPayload":page})
}
fn host(error:impl std::fmt::Display)->PluginError{PluginError::Host(error.to_string())}
fn storage(error:impl std::fmt::Display)->PluginError{PluginError::Storage(error.to_string())}
