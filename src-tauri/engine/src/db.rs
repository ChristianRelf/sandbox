use crate::{
    BrowserDiagnostics, BrowserProfile, ConnectionMetadata, ConnectionStatus, EngineError,
    ExecutionError, ExecutionRecord, ExecutionStatus, PendingApproval, RecordedWorkflowDraft,
    Workflow, WorkflowSummary,
};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use std::{
    path::Path,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct Database {
    connection: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, EngineError> {
        let connection = Connection::open(path).map_err(storage)?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(storage)?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(storage)?;
        let db = Self {
            connection: Arc::new(Mutex::new(connection)),
        };
        db.migrate()?;
        Ok(db)
    }

    pub fn in_memory() -> Result<Self, EngineError> {
        let connection = Connection::open_in_memory().map_err(storage)?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(storage)?;
        let db = Self {
            connection: Arc::new(Mutex::new(connection)),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<(), EngineError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(storage)?;
        if version < 1 {
            connection
                .execute_batch(include_str!("../migrations/001_initial.sql"))
                .map_err(storage)?;
        }
        if version < 2 {
            connection
                .execute_batch(include_str!("../migrations/002_schedule_state.sql"))
                .map_err(storage)?;
        }
        if version < 3 {
            connection
                .execute_batch(include_str!("../migrations/003_browser_integrations.sql"))
                .map_err(storage)?;
        }
        if version < 4 {
            connection
                .execute_batch(include_str!("../migrations/004_integration_polling.sql"))
                .map_err(storage)?;
        }
        migrate_saved_workflows(&connection)?;
        Ok(())
    }

    pub fn schema_version(&self) -> Result<i64, EngineError> {
        self.connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(storage)
    }

    pub fn set_setting<T: Serialize>(&self, key: &str, value: &T) -> Result<(), EngineError> {
        if key.is_empty() || key.len() > 128 {
            return Err(EngineError::Storage("Setting key is invalid.".into()));
        }
        let encoded = serde_json::to_string(value).map_err(storage)?;
        self.connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?
            .execute(
                "INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
                params![key, encoded, Utc::now().to_rfc3339()],
            )
            .map_err(storage)?;
        Ok(())
    }

    pub fn get_setting<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, EngineError> {
        let encoded: Option<String> = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?
            .query_row(
                "SELECT value_json FROM settings WHERE key=?",
                [key],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage)?;
        encoded
            .map(|value| serde_json::from_str(&value).map_err(storage))
            .transpose()
    }

    pub fn delete_setting(&self, key: &str) -> Result<(), EngineError> {
        self.connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?
            .execute("DELETE FROM settings WHERE key=?", [key])
            .map_err(storage)?;
        Ok(())
    }

    pub fn save_workflow(&self, workflow: Workflow) -> Result<Workflow, EngineError> {
        let mut workflow = migrate_workflow(workflow)?;
        let previous = self.get_workflow(&workflow.id)?;
        if let Some(old) = &previous {
            if dangerous_fingerprint(old) != dangerous_fingerprint(&workflow) {
                workflow.settings.permissions.command_execution_permitted = false;
                workflow.settings.permissions.approval_revision = None;
            }
            if browser_fingerprint(old) != browser_fingerprint(&workflow) {
                workflow.settings.permissions.browser_automation_permitted = false;
            }
            if communication_fingerprint(old) != communication_fingerprint(&workflow) {
                workflow
                    .settings
                    .permissions
                    .external_communication_permitted = false;
                workflow
                    .settings
                    .permissions
                    .communication_approval_revision = None;
            }
        } else if workflow.nodes.iter().any(|n| n.node_type == "run_command") {
            workflow.settings.permissions.command_execution_permitted = false;
            workflow.settings.permissions.approval_revision = None;
        }
        if previous.is_none()
            && workflow
                .nodes
                .iter()
                .any(|node| is_browser_node(&node.node_type))
        {
            workflow.settings.permissions.browser_automation_permitted = false;
        }
        if previous.is_none()
            && workflow
                .nodes
                .iter()
                .any(|node| is_communication_node(&node.node_type))
        {
            workflow
                .settings
                .permissions
                .external_communication_permitted = false;
            workflow
                .settings
                .permissions
                .communication_approval_revision = None;
        }
        workflow.updated_at = Utc::now();
        let trigger_type = workflow
            .nodes
            .iter()
            .find(|n| n.id == workflow.trigger_node_id)
            .map(|n| n.node_type.as_str())
            .unwrap_or("unknown");
        let json = serde_json::to_string(&workflow).map_err(storage)?;
        let previous_permissions = previous
            .as_ref()
            .map(|w| serde_json::to_string(&w.settings.permissions).unwrap());
        let current_permissions =
            serde_json::to_string(&workflow.settings.permissions).map_err(storage)?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        let transaction = connection.transaction().map_err(storage)?;
        transaction.execute(
            "INSERT INTO workflows(id,name,description,enabled,trigger_type,schema_version,definition_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,enabled=excluded.enabled,trigger_type=excluded.trigger_type,schema_version=excluded.schema_version,definition_json=excluded.definition_json,updated_at=excluded.updated_at",
            params![workflow.id, workflow.name, workflow.description, workflow.enabled, trigger_type, workflow.schema_version, json, workflow.created_at.to_rfc3339(), workflow.updated_at.to_rfc3339()]
        ).map_err(storage)?;
        if previous_permissions.as_deref() != Some(current_permissions.as_str()) {
            transaction.execute("INSERT INTO permission_audit(workflow_id,changed_at,previous_json,current_json,reason) VALUES(?,?,?,?,?)",
                params![workflow.id, Utc::now().to_rfc3339(), previous_permissions, current_permissions, "Workflow permissions changed"]
            ).map_err(storage)?;
        }
        transaction.commit().map_err(storage)?;
        Ok(workflow)
    }

    pub fn get_workflow(&self, id: &str) -> Result<Option<Workflow>, EngineError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        let json: Option<String> = connection
            .query_row(
                "SELECT definition_json FROM workflows WHERE id=?",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage)?;
        json.map(|value| decode_workflow(&value)).transpose()
    }

    pub fn list_workflows(&self) -> Result<Vec<WorkflowSummary>, EngineError> {
        let workflows: Vec<Workflow> = {
            let connection = self
                .connection
                .lock()
                .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
            let mut statement = connection
                .prepare("SELECT definition_json FROM workflows ORDER BY updated_at DESC")
                .map_err(storage)?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(storage)?;
            rows.map(|row| decode_workflow(&row.map_err(storage)?))
                .collect::<Result<_, _>>()?
        };
        workflows
            .into_iter()
            .map(|workflow| {
                let last_execution = self
                    .list_executions(Some(&workflow.id), 1)?
                    .into_iter()
                    .next();
                let next_run_at = self.get_next_run(&workflow.id)?;
                Ok(WorkflowSummary {
                    workflow,
                    last_execution,
                    next_run_at,
                })
            })
            .collect()
    }

    pub fn delete_workflow(&self, id: &str) -> Result<(), EngineError> {
        self.connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?
            .execute("DELETE FROM workflows WHERE id=?", [id])
            .map_err(storage)?;
        Ok(())
    }

    pub fn save_execution(&self, record: &ExecutionRecord) -> Result<(), EngineError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        connection.execute(
            "INSERT INTO executions(id,workflow_id,workflow_version,trigger_json,status,started_at,completed_at,duration_ms,node_executions_json,error_json,skip_reason,recovered_after_crash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET status=excluded.status,completed_at=excluded.completed_at,duration_ms=excluded.duration_ms,node_executions_json=excluded.node_executions_json,error_json=excluded.error_json,skip_reason=excluded.skip_reason,recovered_after_crash=excluded.recovered_after_crash",
            params![record.id,record.workflow_id,record.workflow_version,serde_json::to_string(&record.trigger).map_err(storage)?,status_str(record.status),record.started_at.to_rfc3339(),record.completed_at.map(|v|v.to_rfc3339()),record.duration_ms,serde_json::to_string(&record.node_executions).map_err(storage)?,record.error.as_ref().map(serde_json::to_string).transpose().map_err(storage)?,record.skip_reason,record.recovered_after_crash]
        ).map_err(storage)?;
        Ok(())
    }

    pub fn get_execution(&self, id: &str) -> Result<Option<ExecutionRecord>, EngineError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        connection.query_row("SELECT id,workflow_id,workflow_version,trigger_json,status,started_at,completed_at,duration_ms,node_executions_json,error_json,skip_reason,recovered_after_crash FROM executions WHERE id=?", [id], parse_execution).optional().map_err(storage)
    }

    pub fn list_executions(
        &self,
        workflow_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<ExecutionRecord>, EngineError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        if let Some(id) = workflow_id {
            let mut statement = connection.prepare("SELECT id,workflow_id,workflow_version,trigger_json,status,started_at,completed_at,duration_ms,node_executions_json,error_json,skip_reason,recovered_after_crash FROM executions WHERE workflow_id=? ORDER BY started_at DESC LIMIT ?").map_err(storage)?;
            let values = statement
                .query_map(params![id, limit as i64], parse_execution)
                .map_err(storage)?
                .map(|v| v.map_err(storage))
                .collect();
            values
        } else {
            let mut statement = connection.prepare("SELECT id,workflow_id,workflow_version,trigger_json,status,started_at,completed_at,duration_ms,node_executions_json,error_json,skip_reason,recovered_after_crash FROM executions ORDER BY started_at DESC LIMIT ?").map_err(storage)?;
            let values = statement
                .query_map([limit as i64], parse_execution)
                .map_err(storage)?
                .map(|v| v.map_err(storage))
                .collect();
            values
        }
    }

    pub fn clear_old_executions(
        &self,
        keep: usize,
    ) -> Result<(usize, Vec<String>), EngineError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        let transaction = connection.transaction().map_err(storage)?;
        let paths = {
            let mut statement = transaction
                .prepare(
                    "SELECT screenshot_path,trace_path FROM browser_diagnostics WHERE execution_id IN (SELECT id FROM executions WHERE id NOT IN (SELECT id FROM executions ORDER BY started_at DESC LIMIT ?))",
                )
                .map_err(storage)?;
            let rows = statement
                .query_map([keep as i64], |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                })
                .map_err(storage)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(storage)?
                .into_iter()
                .flat_map(|(screenshot, trace)| screenshot.into_iter().chain(trace))
                .collect::<Vec<_>>();
            rows
        };
        let removed = transaction
            .execute(
                "DELETE FROM executions WHERE id NOT IN (SELECT id FROM executions ORDER BY started_at DESC LIMIT ?)",
                [keep as i64],
            )
            .map_err(storage)?;
        transaction.commit().map_err(storage)?;
        Ok((removed, paths))
    }

    pub fn recover_unfinished(&self) -> Result<usize, EngineError> {
        let error = serde_json::to_string(&ExecutionError {
            code: "runner_restarted".into(),
            message: "The local runner stopped before this execution completed.".into(),
            detail: None,
            suggestion: Some("Inspect the last completed node, then retry the workflow.".into()),
        })
        .unwrap();
        let connection = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        connection.execute("UPDATE executions SET status='failed',completed_at=?,error_json=?,recovered_after_crash=1 WHERE status IN ('queued','running')", params![Utc::now().to_rfc3339(), error]).map_err(storage)
    }

    pub fn set_next_run(
        &self,
        workflow_id: &str,
        next: Option<DateTime<Utc>>,
    ) -> Result<(), EngineError> {
        self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?.execute(
            "INSERT INTO schedule_state(workflow_id,next_run_at,last_checked_at) VALUES(?,?,?) ON CONFLICT(workflow_id) DO UPDATE SET next_run_at=excluded.next_run_at,last_checked_at=excluded.last_checked_at",
            params![workflow_id,next.map(|v|v.to_rfc3339()),Utc::now().to_rfc3339()]
        ).map_err(storage)?;
        Ok(())
    }

    pub fn get_next_run(&self, workflow_id: &str) -> Result<Option<DateTime<Utc>>, EngineError> {
        let value: Option<String> = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?
            .query_row(
                "SELECT next_run_at FROM schedule_state WHERE workflow_id=?",
                [workflow_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(storage)?
            .flatten();
        value
            .map(|v| {
                DateTime::parse_from_rfc3339(&v)
                    .map(|d| d.with_timezone(&Utc))
                    .map_err(storage)
            })
            .transpose()
    }

    pub fn save_browser_profile(&self, profile: &BrowserProfile) -> Result<(), EngineError> {
        self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?.execute(
            "INSERT INTO browser_profiles(id,name,persistent,data_path,settings_json,created_at,last_used_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,persistent=excluded.persistent,data_path=excluded.data_path,settings_json=excluded.settings_json,last_used_at=excluded.last_used_at",
            params![profile.id, profile.name, profile.persistent, profile.data_path, serde_json::to_string(&profile.settings).map_err(storage)?, profile.created_at.to_rfc3339(), profile.last_used_at.map(|value| value.to_rfc3339())]
        ).map_err(storage)?;
        Ok(())
    }

    pub fn list_browser_profiles(&self) -> Result<Vec<BrowserProfile>, EngineError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        let mut statement = connection.prepare("SELECT id,name,persistent,data_path,settings_json,created_at,last_used_at FROM browser_profiles ORDER BY name").map_err(storage)?;
        let rows = statement
            .query_map([], |row| {
                let settings: String = row.get(4)?;
                let created: String = row.get(5)?;
                let last_used: Option<String> = row.get(6)?;
                Ok(BrowserProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    persistent: row.get(2)?,
                    data_path: row.get(3)?,
                    settings: serde_json::from_str(&settings).unwrap_or_default(),
                    created_at: parse_time(&created),
                    last_used_at: last_used.as_deref().map(parse_time),
                })
            })
            .map_err(storage)?;
        let values = rows.map(|row| row.map_err(storage)).collect();
        values
    }

    pub fn get_browser_profile(&self, id: &str) -> Result<Option<BrowserProfile>, EngineError> {
        Ok(self
            .list_browser_profiles()?
            .into_iter()
            .find(|profile| profile.id == id))
    }

    pub fn delete_browser_profile(&self, id: &str) -> Result<(), EngineError> {
        self.connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?
            .execute("DELETE FROM browser_profiles WHERE id=?", [id])
            .map_err(storage)?;
        Ok(())
    }

    pub fn save_connection(&self, connection: &ConnectionMetadata) -> Result<(), EngineError> {
        self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?.execute(
            "INSERT INTO connections(id,provider,display_name,account_identifier,scopes_json,created_at,last_used_at,expires_at,status,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,display_name=excluded.display_name,account_identifier=excluded.account_identifier,scopes_json=excluded.scopes_json,last_used_at=excluded.last_used_at,expires_at=excluded.expires_at,status=excluded.status,metadata_json=excluded.metadata_json",
            params![connection.id, connection.provider, connection.display_name, connection.account_identifier, serde_json::to_string(&connection.scopes).map_err(storage)?, connection.created_at.to_rfc3339(), connection.last_used_at.map(|value|value.to_rfc3339()), connection.expires_at.map(|value|value.to_rfc3339()), connection_status_str(&connection.status), serde_json::to_string(&connection.metadata).map_err(storage)?]
        ).map_err(storage)?;
        Ok(())
    }

    pub fn list_connections(&self) -> Result<Vec<ConnectionMetadata>, EngineError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        let mut statement = connection.prepare("SELECT id,provider,display_name,account_identifier,scopes_json,created_at,last_used_at,expires_at,status,metadata_json FROM connections ORDER BY display_name").map_err(storage)?;
        let rows = statement.query_map([], parse_connection).map_err(storage)?;
        let values = rows.map(|row| row.map_err(storage)).collect();
        values
    }

    pub fn get_connection(&self, id: &str) -> Result<Option<ConnectionMetadata>, EngineError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        connection.query_row("SELECT id,provider,display_name,account_identifier,scopes_json,created_at,last_used_at,expires_at,status,metadata_json FROM connections WHERE id=?", [id], parse_connection).optional().map_err(storage)
    }

    pub fn delete_connection(&self, id: &str) -> Result<(), EngineError> {
        self.connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?
            .execute("DELETE FROM connections WHERE id=?", [id])
            .map_err(storage)?;
        Ok(())
    }

    pub fn save_pending_approval(&self, approval: &PendingApproval) -> Result<(), EngineError> {
        self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?.execute(
            "INSERT INTO pending_approvals(id,execution_id,workflow_id,node_id,action_json,status,created_at,expires_at,resolved_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,resolved_at=excluded.resolved_at",
            params![approval.id, approval.execution_id, approval.workflow_id, approval.node_id, serde_json::to_string(&approval.action).map_err(storage)?, approval.status, approval.created_at.to_rfc3339(), approval.expires_at.to_rfc3339(), approval.resolved_at.map(|value|value.to_rfc3339())]
        ).map_err(storage)?;
        Ok(())
    }

    pub fn list_pending_approvals(&self) -> Result<Vec<PendingApproval>, EngineError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        let mut statement = connection.prepare("SELECT id,execution_id,workflow_id,node_id,action_json,status,created_at,expires_at,resolved_at FROM pending_approvals WHERE status='pending' ORDER BY created_at DESC").map_err(storage)?;
        let rows = statement
            .query_map([], |row| {
                let action: String = row.get(4)?;
                let created: String = row.get(6)?;
                let expires: String = row.get(7)?;
                let resolved: Option<String> = row.get(8)?;
                Ok(PendingApproval {
                    id: row.get(0)?,
                    execution_id: row.get(1)?,
                    workflow_id: row.get(2)?,
                    node_id: row.get(3)?,
                    action: serde_json::from_str(&action).unwrap_or_default(),
                    status: row.get(5)?,
                    created_at: parse_time(&created),
                    expires_at: parse_time(&expires),
                    resolved_at: resolved.as_deref().map(parse_time),
                })
            })
            .map_err(storage)?;
        let values = rows.map(|row| row.map_err(storage)).collect();
        values
    }

    pub fn get_pending_approval(&self, id: &str) -> Result<Option<PendingApproval>, EngineError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        connection.query_row("SELECT id,execution_id,workflow_id,node_id,action_json,status,created_at,expires_at,resolved_at FROM pending_approvals WHERE id=?", [id], |row| {
            let action:String=row.get(4)?;let created:String=row.get(6)?;let expires:String=row.get(7)?;let resolved:Option<String>=row.get(8)?;
            Ok(PendingApproval{id:row.get(0)?,execution_id:row.get(1)?,workflow_id:row.get(2)?,node_id:row.get(3)?,action:serde_json::from_str(&action).unwrap_or_default(),status:row.get(5)?,created_at:parse_time(&created),expires_at:parse_time(&expires),resolved_at:resolved.as_deref().map(parse_time)})
        }).optional().map_err(storage)
    }

    pub fn resolve_pending_approval(&self, id: &str, status: &str) -> Result<bool, EngineError> {
        if !matches!(status, "approved" | "rejected") {
            return Err(EngineError::Validation(
                "Approval status must be approved or rejected.".into(),
            ));
        }
        let changed=self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?.execute(
            "UPDATE pending_approvals SET status=?,resolved_at=? WHERE id=? AND status='pending' AND expires_at>?",
            params![status,Utc::now().to_rfc3339(),id,Utc::now().to_rfc3339()]
        ).map_err(storage)?;
        Ok(changed == 1)
    }

    pub fn save_recording_draft(&self, draft: &RecordedWorkflowDraft) -> Result<(), EngineError> {
        self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?.execute(
            "INSERT INTO recorded_workflow_drafts(id,workflow_id,profile_id,status,steps_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET workflow_id=excluded.workflow_id,status=excluded.status,steps_json=excluded.steps_json,updated_at=excluded.updated_at",
            params![draft.id,draft.workflow_id,draft.profile_id,draft.status,serde_json::to_string(&draft.steps).map_err(storage)?,draft.created_at.to_rfc3339(),draft.updated_at.to_rfc3339()]
        ).map_err(storage)?;
        Ok(())
    }

    pub fn save_browser_diagnostic(
        &self,
        execution_id: &str,
        node_id: &str,
        diagnostic: &BrowserDiagnostics,
        expires_at: DateTime<Utc>,
    ) -> Result<(), EngineError> {
        self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?.execute(
            "INSERT INTO browser_diagnostics(id,execution_id,node_id,diagnostic_json,screenshot_path,trace_path,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
            params![uuid::Uuid::new_v4().to_string(),execution_id,node_id,serde_json::to_string(diagnostic).map_err(storage)?,diagnostic.screenshot_path,diagnostic.trace_path,Utc::now().to_rfc3339(),expires_at.to_rfc3339()]
        ).map_err(storage)?;
        Ok(())
    }

    pub fn take_expired_browser_artifacts(
        &self,
        now: DateTime<Utc>,
    ) -> Result<Vec<String>, EngineError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        let transaction = connection.transaction().map_err(storage)?;
        let paths = {
            let mut statement = transaction
                .prepare("SELECT screenshot_path,trace_path FROM browser_diagnostics WHERE expires_at<=?")
                .map_err(storage)?;
            let rows = statement
                .query_map([now.to_rfc3339()], |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                })
                .map_err(storage)?;
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .map_err(storage)?
                .into_iter()
                .flat_map(|(screenshot, trace)| screenshot.into_iter().chain(trace))
                .collect::<Vec<_>>()
        };
        transaction
            .execute(
                "DELETE FROM browser_diagnostics WHERE expires_at<=?",
                [now.to_rfc3339()],
            )
            .map_err(storage)?;
        transaction.commit().map_err(storage)?;
        Ok(paths)
    }

    pub fn gmail_message_processed(
        &self,
        workflow_id: &str,
        message_id: &str,
    ) -> Result<bool, EngineError> {
        let changed = self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?.execute(
            "INSERT OR IGNORE INTO gmail_poll_state(workflow_id,message_id,processed_at) VALUES(?,?,?)",
            params![workflow_id,message_id,Utc::now().to_rfc3339()]
        ).map_err(storage)?;
        Ok(changed == 0)
    }

    pub fn get_last_integration_poll(
        &self,
        workflow_id: &str,
    ) -> Result<Option<DateTime<Utc>>, EngineError> {
        let value: Option<String> = self
            .connection
            .lock()
            .map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?
            .query_row(
                "SELECT last_polled_at FROM integration_poll_state WHERE workflow_id=?",
                [workflow_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage)?;
        Ok(value.as_deref().map(parse_time))
    }

    pub fn set_last_integration_poll(
        &self,
        workflow_id: &str,
        value: DateTime<Utc>,
    ) -> Result<(), EngineError> {
        self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?.execute(
            "INSERT INTO integration_poll_state(workflow_id,last_polled_at) VALUES(?,?) ON CONFLICT(workflow_id) DO UPDATE SET last_polled_at=excluded.last_polled_at",
            params![workflow_id,value.to_rfc3339()]
        ).map_err(storage)?;
        Ok(())
    }

    pub fn workflows_using_reference(&self, key: &str) -> Result<Vec<String>, EngineError> {
        Ok(self
            .list_workflows()?
            .into_iter()
            .filter(|summary| {
                serde_json::to_string(&summary.workflow).is_ok_and(|json| json.contains(key))
            })
            .map(|summary| summary.workflow.id)
            .collect())
    }
}

fn dangerous_fingerprint(workflow: &Workflow) -> String {
    serde_json::to_string(
        &workflow
            .nodes
            .iter()
            .filter(|n| n.node_type == "run_command")
            .map(|n| (&n.id, &n.configuration))
            .collect::<Vec<_>>(),
    )
    .unwrap_or_default()
}
fn browser_fingerprint(workflow: &Workflow) -> String {
    serde_json::to_string(
        &workflow
            .nodes
            .iter()
            .filter(|node| is_browser_node(&node.node_type))
            .map(|node| (&node.id, &node.node_type, &node.configuration))
            .collect::<Vec<_>>(),
    )
    .unwrap_or_default()
}
fn communication_fingerprint(workflow: &Workflow) -> String {
    serde_json::to_string(
        &workflow
            .nodes
            .iter()
            .filter(|node| is_communication_node(&node.node_type))
            .map(|node| (&node.id, &node.node_type, &node.configuration))
            .collect::<Vec<_>>(),
    )
    .unwrap_or_default()
}
fn is_browser_node(node_type: &str) -> bool {
    matches!(
        node_type,
        "open_browser"
            | "navigate"
            | "click_element"
            | "fill_field"
            | "select_option"
            | "press_key"
            | "wait_for"
            | "extract_data"
            | "screenshot"
            | "download_file"
            | "upload_file"
            | "close_browser"
    )
}
fn is_communication_node(node_type: &str) -> bool {
    matches!(
        node_type,
        "gmail_create_draft"
            | "gmail_send_email"
            | "gmail_add_label"
            | "discord_webhook"
            | "discord_embed"
            | "slack_webhook"
    )
}
fn storage(error: impl std::fmt::Display) -> EngineError {
    EngineError::Storage(error.to_string())
}
fn status_str(status: ExecutionStatus) -> &'static str {
    match status {
        ExecutionStatus::Queued => "queued",
        ExecutionStatus::Running => "running",
        ExecutionStatus::Successful => "successful",
        ExecutionStatus::Failed => "failed",
        ExecutionStatus::Skipped => "skipped",
        ExecutionStatus::Cancelled => "cancelled",
    }
}
fn parse_status(value: &str) -> ExecutionStatus {
    match value {
        "queued" => ExecutionStatus::Queued,
        "running" => ExecutionStatus::Running,
        "successful" => ExecutionStatus::Successful,
        "skipped" => ExecutionStatus::Skipped,
        "cancelled" => ExecutionStatus::Cancelled,
        _ => ExecutionStatus::Failed,
    }
}
fn parse_execution(row: &rusqlite::Row) -> rusqlite::Result<ExecutionRecord> {
    let trigger: String = row.get(3)?;
    let status: String = row.get(4)?;
    let started: String = row.get(5)?;
    let completed: Option<String> = row.get(6)?;
    let nodes: String = row.get(8)?;
    let error: Option<String> = row.get(9)?;
    Ok(ExecutionRecord {
        id: row.get(0)?,
        workflow_id: row.get(1)?,
        workflow_version: row.get(2)?,
        trigger: serde_json::from_str(&trigger).unwrap_or_default(),
        status: parse_status(&status),
        started_at: DateTime::parse_from_rfc3339(&started)
            .unwrap()
            .with_timezone(&Utc),
        completed_at: completed.and_then(|v| {
            DateTime::parse_from_rfc3339(&v)
                .ok()
                .map(|v| v.with_timezone(&Utc))
        }),
        duration_ms: row.get(7)?,
        node_executions: serde_json::from_str(&nodes).unwrap_or_default(),
        error: error.and_then(|v| serde_json::from_str(&v).ok()),
        skip_reason: row.get(10)?,
        recovered_after_crash: row.get::<_, i64>(11)? != 0,
    })
}

fn parse_time(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn connection_status_str(status: &ConnectionStatus) -> &'static str {
    match status {
        ConnectionStatus::Connected => "connected",
        ConnectionStatus::Expired => "expired",
        ConnectionStatus::Revoked => "revoked",
        ConnectionStatus::Error => "error",
        ConnectionStatus::SetupRequired => "setup_required",
    }
}

fn parse_connection(row: &rusqlite::Row) -> rusqlite::Result<ConnectionMetadata> {
    let scopes: String = row.get(4)?;
    let created: String = row.get(5)?;
    let last: Option<String> = row.get(6)?;
    let expires: Option<String> = row.get(7)?;
    let status: String = row.get(8)?;
    let metadata: String = row.get(9)?;
    Ok(ConnectionMetadata {
        id: row.get(0)?,
        provider: row.get(1)?,
        display_name: row.get(2)?,
        account_identifier: row.get(3)?,
        scopes: serde_json::from_str(&scopes).unwrap_or_default(),
        created_at: parse_time(&created),
        last_used_at: last.as_deref().map(parse_time),
        expires_at: expires.as_deref().map(parse_time),
        status: match status.as_str() {
            "connected" => ConnectionStatus::Connected,
            "expired" => ConnectionStatus::Expired,
            "revoked" => ConnectionStatus::Revoked,
            "error" => ConnectionStatus::Error,
            _ => ConnectionStatus::SetupRequired,
        },
        metadata: serde_json::from_str(&metadata).unwrap_or_default(),
    })
}

fn migrate_workflow(mut workflow: Workflow) -> Result<Workflow, EngineError> {
    match workflow.schema_version {
        crate::model::CURRENT_SCHEMA_VERSION => Ok(workflow),
        1 => {
            workflow.schema_version = crate::model::CURRENT_SCHEMA_VERSION;
            Ok(workflow)
        }
        version if version > crate::model::CURRENT_SCHEMA_VERSION => Err(EngineError::Validation(
            format!("Workflow schema {version} was created by a newer version of Sandbox."),
        )),
        version => Err(EngineError::Validation(format!(
            "Workflow schema {version} is not supported."
        ))),
    }
}

fn decode_workflow(json: &str) -> Result<Workflow, EngineError> {
    migrate_workflow(serde_json::from_str(json).map_err(storage)?)
}

fn migrate_saved_workflows(connection: &Connection) -> Result<(), EngineError> {
    let rows: Vec<(String, String)> = {
        let mut statement = connection
            .prepare("SELECT id, definition_json FROM workflows WHERE schema_version < ?")
            .map_err(storage)?;
        let values = statement
            .query_map([crate::model::CURRENT_SCHEMA_VERSION], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(storage)?;
        values.collect::<Result<_, _>>().map_err(storage)?
    };
    for (id, json) in rows {
        let workflow = decode_workflow(&json)?;
        connection
            .execute(
                "UPDATE workflows SET schema_version=?, definition_json=? WHERE id=?",
                params![
                    workflow.schema_version,
                    serde_json::to_string(&workflow).map_err(storage)?,
                    id
                ],
            )
            .map_err(storage)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Position, WorkflowNode, WorkflowSettings};
    use serde_json::json;
    fn workflow() -> Workflow {
        let now = Utc::now();
        Workflow {
            id: "w".into(),
            schema_version: 1,
            name: "Saved".into(),
            description: "".into(),
            enabled: true,
            trigger_node_id: "t".into(),
            nodes: vec![WorkflowNode {
                id: "t".into(),
                node_type: "manual_trigger".into(),
                version: 1,
                name: "Manual".into(),
                position: Position { x: 0., y: 0. },
                configuration: json!({}),
                disabled: false,
            }],
            edges: vec![],
            settings: WorkflowSettings::default(),
            created_at: now,
            updated_at: now,
        }
    }
    #[test]
    fn migrations_and_persistence_work() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sandbox.db");
        {
            let db = Database::open(&path).unwrap();
            assert_eq!(db.schema_version().unwrap(), 4);
            db.save_workflow(workflow()).unwrap();
        }
        let reopened = Database::open(&path).unwrap();
        let saved = reopened.get_workflow("w").unwrap().unwrap();
        assert_eq!(saved.name, "Saved");
        assert_eq!(saved.schema_version, crate::model::CURRENT_SCHEMA_VERSION);
        assert!(!saved.settings.permissions.browser_automation_permitted);
    }
    #[test]
    fn recovers_running_records() {
        let db = Database::in_memory().unwrap();
        db.save_workflow(workflow()).unwrap();
        let now = Utc::now();
        let record = ExecutionRecord {
            id: "e".into(),
            workflow_id: "w".into(),
            workflow_version: 1,
            trigger: json!({}),
            status: ExecutionStatus::Running,
            started_at: now,
            completed_at: None,
            duration_ms: None,
            node_executions: vec![],
            error: None,
            skip_reason: None,
            recovered_after_crash: false,
        };
        db.save_execution(&record).unwrap();
        assert_eq!(db.recover_unfinished().unwrap(), 1);
        assert!(
            db.get_execution("e")
                .unwrap()
                .unwrap()
                .recovered_after_crash
        );
    }

    #[test]
    fn expires_browser_diagnostics_and_returns_owned_artifacts() {
        let db = Database::in_memory().unwrap();
        db.save_workflow(workflow()).unwrap();
        let now = Utc::now();
        let record = ExecutionRecord {
            id: "browser-run".into(),
            workflow_id: "w".into(),
            workflow_version: 2,
            trigger: json!({}),
            status: ExecutionStatus::Failed,
            started_at: now,
            completed_at: Some(now),
            duration_ms: Some(1),
            node_executions: vec![],
            error: None,
            skip_reason: None,
            recovered_after_crash: false,
        };
        db.save_execution(&record).unwrap();
        let diagnostic = BrowserDiagnostics {
            screenshot_path: Some("C:/app/artifacts/failure.png".into()),
            trace_path: Some("C:/app/artifacts/trace.zip".into()),
            ..BrowserDiagnostics::default()
        };
        db.save_browser_diagnostic(
            "browser-run",
            "browser",
            &diagnostic,
            now - chrono::Duration::seconds(1),
        )
        .unwrap();
        let paths = db.take_expired_browser_artifacts(now).unwrap();
        assert_eq!(paths.len(), 2);
        assert!(paths.iter().any(|path| path.ends_with("failure.png")));
        assert!(db.take_expired_browser_artifacts(now).unwrap().is_empty());
    }

    #[test]
    fn clearing_history_returns_artifacts_for_removed_executions_only() {
        let db = Database::in_memory().unwrap();
        db.save_workflow(workflow()).unwrap();
        let now = Utc::now();
        for (id, started_at) in [
            ("old-browser-run", now - chrono::Duration::minutes(1)),
            ("latest-browser-run", now),
        ] {
            db.save_execution(&ExecutionRecord {
                id: id.into(),
                workflow_id: "w".into(),
                workflow_version: 2,
                trigger: json!({}),
                status: ExecutionStatus::Successful,
                started_at,
                completed_at: Some(started_at),
                duration_ms: Some(1),
                node_executions: vec![],
                error: None,
                skip_reason: None,
                recovered_after_crash: false,
            })
            .unwrap();
            db.save_browser_diagnostic(
                id,
                "browser",
                &BrowserDiagnostics {
                    screenshot_path: Some(format!("C:/app/artifacts/{id}.png")),
                    ..BrowserDiagnostics::default()
                },
                now + chrono::Duration::days(1),
            )
            .unwrap();
        }

        let (removed, paths) = db.clear_old_executions(1).unwrap();

        assert_eq!(removed, 1);
        assert_eq!(paths, ["C:/app/artifacts/old-browser-run.png"]);
        assert!(db.get_execution("old-browser-run").unwrap().is_none());
        assert!(db.get_execution("latest-browser-run").unwrap().is_some());
    }
}
