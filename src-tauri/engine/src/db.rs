use crate::{EngineError, ExecutionError, ExecutionRecord, ExecutionStatus, Workflow, WorkflowSummary};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::{path::Path, sync::{Arc, Mutex}};

#[derive(Clone)]
pub struct Database { connection: Arc<Mutex<Connection>> }

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, EngineError> {
        let connection = Connection::open(path).map_err(storage)?;
        connection.pragma_update(None, "foreign_keys", "ON").map_err(storage)?;
        connection.pragma_update(None, "journal_mode", "WAL").map_err(storage)?;
        let db = Self { connection: Arc::new(Mutex::new(connection)) };
        db.migrate()?;
        Ok(db)
    }

    pub fn in_memory() -> Result<Self, EngineError> {
        let connection = Connection::open_in_memory().map_err(storage)?;
        connection.pragma_update(None, "foreign_keys", "ON").map_err(storage)?;
        let db = Self { connection: Arc::new(Mutex::new(connection)) };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<(), EngineError> {
        let connection = self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(storage)?;
        if version < 1 { connection.execute_batch(include_str!("../migrations/001_initial.sql")).map_err(storage)?; }
        if version < 2 { connection.execute_batch(include_str!("../migrations/002_schedule_state.sql")).map_err(storage)?; }
        Ok(())
    }

    pub fn schema_version(&self) -> Result<i64, EngineError> {
        self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?
            .query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(storage)
    }

    pub fn save_workflow(&self, mut workflow: Workflow) -> Result<Workflow, EngineError> {
        let previous = self.get_workflow(&workflow.id)?;
        if let Some(old) = &previous {
            if dangerous_fingerprint(old) != dangerous_fingerprint(&workflow) {
                workflow.settings.permissions.command_execution_permitted = false;
                workflow.settings.permissions.approval_revision = None;
            }
        } else if workflow.nodes.iter().any(|n| n.node_type == "run_command") {
            workflow.settings.permissions.command_execution_permitted = false;
            workflow.settings.permissions.approval_revision = None;
        }
        workflow.updated_at = Utc::now();
        let trigger_type = workflow.nodes.iter().find(|n| n.id == workflow.trigger_node_id).map(|n| n.node_type.as_str()).unwrap_or("unknown");
        let json = serde_json::to_string(&workflow).map_err(storage)?;
        let previous_permissions = previous.as_ref().map(|w| serde_json::to_string(&w.settings.permissions).unwrap());
        let current_permissions = serde_json::to_string(&workflow.settings.permissions).map_err(storage)?;
        let mut connection = self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
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
        let connection = self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        let json: Option<String> = connection.query_row("SELECT definition_json FROM workflows WHERE id=?", [id], |row| row.get(0)).optional().map_err(storage)?;
        json.map(|value| serde_json::from_str(&value).map_err(storage)).transpose()
    }

    pub fn list_workflows(&self) -> Result<Vec<WorkflowSummary>, EngineError> {
        let workflows: Vec<Workflow> = {
            let connection = self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
            let mut statement = connection.prepare("SELECT definition_json FROM workflows ORDER BY updated_at DESC").map_err(storage)?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0)).map_err(storage)?;
            rows.map(|row| serde_json::from_str(&row.map_err(storage)?).map_err(storage)).collect::<Result<_,_>>()?
        };
        workflows.into_iter().map(|workflow| {
            let last_execution = self.list_executions(Some(&workflow.id), 1)?.into_iter().next();
            let next_run_at = self.get_next_run(&workflow.id)?;
            Ok(WorkflowSummary { workflow, last_execution, next_run_at })
        }).collect()
    }

    pub fn delete_workflow(&self, id: &str) -> Result<(), EngineError> {
        self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?
            .execute("DELETE FROM workflows WHERE id=?", [id]).map_err(storage)?;
        Ok(())
    }

    pub fn save_execution(&self, record: &ExecutionRecord) -> Result<(), EngineError> {
        let connection = self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        connection.execute(
            "INSERT INTO executions(id,workflow_id,workflow_version,trigger_json,status,started_at,completed_at,duration_ms,node_executions_json,error_json,skip_reason,recovered_after_crash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET status=excluded.status,completed_at=excluded.completed_at,duration_ms=excluded.duration_ms,node_executions_json=excluded.node_executions_json,error_json=excluded.error_json,skip_reason=excluded.skip_reason,recovered_after_crash=excluded.recovered_after_crash",
            params![record.id,record.workflow_id,record.workflow_version,serde_json::to_string(&record.trigger).map_err(storage)?,status_str(record.status),record.started_at.to_rfc3339(),record.completed_at.map(|v|v.to_rfc3339()),record.duration_ms,serde_json::to_string(&record.node_executions).map_err(storage)?,record.error.as_ref().map(serde_json::to_string).transpose().map_err(storage)?,record.skip_reason,record.recovered_after_crash]
        ).map_err(storage)?;
        Ok(())
    }

    pub fn get_execution(&self, id: &str) -> Result<Option<ExecutionRecord>, EngineError> {
        let connection = self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        connection.query_row("SELECT id,workflow_id,workflow_version,trigger_json,status,started_at,completed_at,duration_ms,node_executions_json,error_json,skip_reason,recovered_after_crash FROM executions WHERE id=?", [id], parse_execution).optional().map_err(storage)
    }

    pub fn list_executions(&self, workflow_id: Option<&str>, limit: usize) -> Result<Vec<ExecutionRecord>, EngineError> {
        let connection = self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        if let Some(id) = workflow_id {
            let mut statement = connection.prepare("SELECT id,workflow_id,workflow_version,trigger_json,status,started_at,completed_at,duration_ms,node_executions_json,error_json,skip_reason,recovered_after_crash FROM executions WHERE workflow_id=? ORDER BY started_at DESC LIMIT ?").map_err(storage)?;
            let values = statement.query_map(params![id, limit as i64], parse_execution).map_err(storage)?.map(|v| v.map_err(storage)).collect();
            values
        } else {
            let mut statement = connection.prepare("SELECT id,workflow_id,workflow_version,trigger_json,status,started_at,completed_at,duration_ms,node_executions_json,error_json,skip_reason,recovered_after_crash FROM executions ORDER BY started_at DESC LIMIT ?").map_err(storage)?;
            let values = statement.query_map([limit as i64], parse_execution).map_err(storage)?.map(|v| v.map_err(storage)).collect();
            values
        }
    }

    pub fn clear_old_executions(&self, keep: usize) -> Result<usize, EngineError> {
        self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?
            .execute("DELETE FROM executions WHERE id NOT IN (SELECT id FROM executions ORDER BY started_at DESC LIMIT ?)", [keep as i64]).map_err(storage)
    }

    pub fn recover_unfinished(&self) -> Result<usize, EngineError> {
        let error = serde_json::to_string(&ExecutionError { code:"runner_restarted".into(), message:"The local runner stopped before this execution completed.".into(), detail:None, suggestion:Some("Inspect the last completed node, then retry the workflow.".into()) }).unwrap();
        let connection = self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?;
        connection.execute("UPDATE executions SET status='failed',completed_at=?,error_json=?,recovered_after_crash=1 WHERE status IN ('queued','running')", params![Utc::now().to_rfc3339(), error]).map_err(storage)
    }

    pub fn set_next_run(&self, workflow_id: &str, next: Option<DateTime<Utc>>) -> Result<(), EngineError> {
        self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?.execute(
            "INSERT INTO schedule_state(workflow_id,next_run_at,last_checked_at) VALUES(?,?,?) ON CONFLICT(workflow_id) DO UPDATE SET next_run_at=excluded.next_run_at,last_checked_at=excluded.last_checked_at",
            params![workflow_id,next.map(|v|v.to_rfc3339()),Utc::now().to_rfc3339()]
        ).map_err(storage)?;
        Ok(())
    }

    pub fn get_next_run(&self, workflow_id: &str) -> Result<Option<DateTime<Utc>>, EngineError> {
        let value: Option<String> = self.connection.lock().map_err(|_| EngineError::Storage("Database lock was poisoned.".into()))?
            .query_row("SELECT next_run_at FROM schedule_state WHERE workflow_id=?", [workflow_id], |r| r.get(0)).optional().map_err(storage)?.flatten();
        value.map(|v| DateTime::parse_from_rfc3339(&v).map(|d| d.with_timezone(&Utc)).map_err(storage)).transpose()
    }
}

fn dangerous_fingerprint(workflow: &Workflow) -> String {
    serde_json::to_string(&workflow.nodes.iter().filter(|n| n.node_type == "run_command").map(|n| (&n.id, &n.configuration)).collect::<Vec<_>>()).unwrap_or_default()
}
fn storage(error: impl std::fmt::Display) -> EngineError { EngineError::Storage(error.to_string()) }
fn status_str(status: ExecutionStatus) -> &'static str { match status { ExecutionStatus::Queued=>"queued",ExecutionStatus::Running=>"running",ExecutionStatus::Successful=>"successful",ExecutionStatus::Failed=>"failed",ExecutionStatus::Skipped=>"skipped",ExecutionStatus::Cancelled=>"cancelled" } }
fn parse_status(value: &str) -> ExecutionStatus { match value { "queued"=>ExecutionStatus::Queued,"running"=>ExecutionStatus::Running,"successful"=>ExecutionStatus::Successful,"skipped"=>ExecutionStatus::Skipped,"cancelled"=>ExecutionStatus::Cancelled,_=>ExecutionStatus::Failed } }
fn parse_execution(row: &rusqlite::Row) -> rusqlite::Result<ExecutionRecord> {
    let trigger: String = row.get(3)?; let status: String = row.get(4)?; let started: String = row.get(5)?; let completed: Option<String> = row.get(6)?; let nodes: String = row.get(8)?; let error: Option<String> = row.get(9)?;
    Ok(ExecutionRecord { id:row.get(0)?,workflow_id:row.get(1)?,workflow_version:row.get(2)?,trigger:serde_json::from_str(&trigger).unwrap_or_default(),status:parse_status(&status),started_at:DateTime::parse_from_rfc3339(&started).unwrap().with_timezone(&Utc),completed_at:completed.and_then(|v|DateTime::parse_from_rfc3339(&v).ok().map(|v|v.with_timezone(&Utc))),duration_ms:row.get(7)?,node_executions:serde_json::from_str(&nodes).unwrap_or_default(),error:error.and_then(|v|serde_json::from_str(&v).ok()),skip_reason:row.get(10)?,recovered_after_crash:row.get::<_,i64>(11)? != 0 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Position, WorkflowNode, WorkflowSettings};
    use serde_json::json;
    fn workflow() -> Workflow { let now=Utc::now(); Workflow{id:"w".into(),schema_version:1,name:"Saved".into(),description:"".into(),enabled:true,trigger_node_id:"t".into(),nodes:vec![WorkflowNode{id:"t".into(),node_type:"manual_trigger".into(),version:1,name:"Manual".into(),position:Position{x:0.,y:0.},configuration:json!({}),disabled:false}],edges:vec![],settings:WorkflowSettings::default(),created_at:now,updated_at:now} }
    #[test] fn migrations_and_persistence_work() { let db=Database::in_memory().unwrap(); assert_eq!(db.schema_version().unwrap(),2); db.save_workflow(workflow()).unwrap(); assert_eq!(db.get_workflow("w").unwrap().unwrap().name,"Saved"); }
    #[test] fn recovers_running_records() { let db=Database::in_memory().unwrap(); db.save_workflow(workflow()).unwrap(); let now=Utc::now(); let record=ExecutionRecord{id:"e".into(),workflow_id:"w".into(),workflow_version:1,trigger:json!({}),status:ExecutionStatus::Running,started_at:now,completed_at:None,duration_ms:None,node_executions:vec![],error:None,skip_reason:None,recovered_after_crash:false}; db.save_execution(&record).unwrap(); assert_eq!(db.recover_unfinished().unwrap(),1); assert!(db.get_execution("e").unwrap().unwrap().recovered_after_crash); }
}
