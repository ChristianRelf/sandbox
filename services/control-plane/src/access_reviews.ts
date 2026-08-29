import { randomUUID } from "node:crypto";
import type { Pool,PoolClient } from "pg";
import type { AuthenticatedSession } from "./types.js";
import { DomainError } from "./types.js";

export interface ServiceAccountAccessReview {id:string;serviceAccountId:string;organisationId:string;serviceAccountName:string;workspaceIds:string[];openedAt:string;dueAt:string;status:"pending"|"overdue"|"retained"|"revoked";accessSnapshot:Record<string,unknown>;decidedBy:string|null;decidedAt:string|null;rationale:string|null}
export interface AccessReviewSweepResult {opened:number;overdue:number;revokedCredentials:number}
export interface ServiceAccountAccessReviewAdministration {
  list(actor:AuthenticatedSession,workspaceId:string,status?:"pending"|"overdue"|"retained"|"revoked"):Promise<ServiceAccountAccessReview[]>;
  workspaceIds(actor:AuthenticatedSession,reviewId:string):Promise<string[]>;
  decide(actor:AuthenticatedSession,reviewId:string,decision:"retain"|"revoke",rationale:string,correlationId:string):Promise<ServiceAccountAccessReview>;
}

interface ReviewRow {id:string;service_account_id:string;organisation_id:string;service_account_name:string;workspace_ids:string[];opened_at:Date;due_at:Date;status:ServiceAccountAccessReview["status"];access_snapshot:Record<string,unknown>;decided_by:string|null;decided_at:Date|null;rationale:string|null}

export class PostgresServiceAccountAccessReviews implements ServiceAccountAccessReviewAdministration {
  constructor(private readonly pool:Pool){}

  async runOnce(now=new Date(),limit=100):Promise<AccessReviewSweepResult>{return this.systemTransaction(async client=>{
    const due=await client.query<{id:string;organisation_id:string;name:string;access_review_interval_days:number}>(`SELECT id,organisation_id,name,access_review_interval_days FROM service_accounts WHERE status='active' AND next_access_review_at<=$1 AND NOT EXISTS(SELECT 1 FROM service_account_access_reviews review WHERE review.service_account_id=service_accounts.id AND review.status IN ('pending','overdue')) ORDER BY next_access_review_at FOR UPDATE SKIP LOCKED LIMIT $2`,[now,Math.min(Math.max(limit,1),1000)]);
    let opened=0;
    for(const service of due.rows){
      const assignments=await client.query<{workspace_id:string;role_id:string;environment_ids:string[]}>(`SELECT workspace_id,role_id,environment_ids FROM service_account_role_assignments WHERE service_account_id=$1 ORDER BY workspace_id`,[service.id]);
      const owners=await client.query<{account_id:string}>(`SELECT account_id FROM service_account_owners WHERE service_account_id=$1 ORDER BY account_id`,[service.id]);
      const credentials=await client.query<{id:string;token_prefix:string;scopes:string[];workspace_restrictions:string[];environment_restrictions:string[];expires_at:Date;last_used_at:Date|null}>(`SELECT id,token_prefix,scopes,workspace_restrictions,environment_restrictions,expires_at,last_used_at FROM access_tokens WHERE service_account_id=$1 AND revoked_at IS NULL AND expires_at>$2 ORDER BY created_at`,[service.id,now]);
      const snapshot={serviceAccountName:service.name,assignments:assignments.rows.map(row=>({workspaceId:row.workspace_id,roleId:row.role_id,environmentIds:row.environment_ids})),ownerAccountIds:owners.rows.map(row=>row.account_id),credentials:credentials.rows.map(row=>({id:row.id,prefix:row.token_prefix,scopes:row.scopes,workspaceIds:row.workspace_restrictions,environmentIds:row.environment_restrictions,expiresAt:row.expires_at.toISOString(),lastUsedAt:row.last_used_at?.toISOString()??null}))};
      const dueAt=new Date(now.getTime()+14*86_400_000);
      const inserted=await client.query(`INSERT INTO service_account_access_reviews(id,service_account_id,organisation_id,opened_at,due_at,access_snapshot) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[randomUUID(),service.id,service.organisation_id,now,dueAt,snapshot]);
      if(inserted.rowCount){opened++;await client.query(`UPDATE service_accounts SET next_access_review_at=$2::timestamptz+(access_review_interval_days||' days')::interval WHERE id=$1`,[service.id,now]);}
    }
    const overdue=await client.query<{id:string;service_account_id:string}>(`UPDATE service_account_access_reviews review SET status='overdue' WHERE id IN(SELECT id FROM service_account_access_reviews WHERE status='pending' AND due_at<=$1 ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT $2) RETURNING id,service_account_id`,[now,Math.min(Math.max(limit,1),1000)]);
    let revokedCredentials=0;
    for(const review of overdue.rows){
      await client.query(`UPDATE service_accounts SET status='suspended',suspension_reason='access_review_overdue' WHERE id=$1 AND status='active'`,[review.service_account_id]);
      const tokens=await client.query<{id:string}>(`UPDATE access_tokens SET revoked_at=$2,revocation_reason='access_review_overdue' WHERE service_account_id=$1 AND revoked_at IS NULL RETURNING id`,[review.service_account_id,now]);revokedCredentials+=tokens.rowCount??0;
      if(tokens.rowCount)await client.query(`UPDATE runner_commands SET status='expired',result_summary=jsonb_build_object('reason','access_review_overdue') WHERE authorization_context->>'credentialId'=ANY($1::text[]) AND status IN ('queued','delivered','accepted')`,[tokens.rows.map(row=>row.id)]);
    }
    return{opened,overdue:overdue.rowCount??0,revokedCredentials};
  });}

  async list(actor:AuthenticatedSession,workspaceId:string,status?:ServiceAccountAccessReview["status"]):Promise<ServiceAccountAccessReview[]>{return this.actorTransaction(actor,async client=>(await client.query<ReviewRow>(`${reviewSelect} WHERE $1=ANY(ARRAY(SELECT assignment.workspace_id FROM service_account_role_assignments assignment WHERE assignment.service_account_id=review.service_account_id)) AND ($2::text IS NULL OR review.status=$2) ORDER BY review.due_at,review.id`,[workspaceId,status??null])).rows.map(fromRow));}
  async workspaceIds(actor:AuthenticatedSession,reviewId:string):Promise<string[]>{const serviceAccountId=await this.actorTransaction(actor,async client=>(await client.query<{service_account_id:string}>(`SELECT service_account_id FROM service_account_access_reviews WHERE id=$1`,[reviewId])).rows[0]?.service_account_id??null);if(!serviceAccountId)throw new DomainError("access_review_not_found","Access review was not found.",404);return this.systemTransaction(async client=>(await client.query<{workspace_id:string}>(`SELECT workspace_id FROM service_account_role_assignments WHERE service_account_id=$1 ORDER BY workspace_id`,[serviceAccountId])).rows.map(row=>row.workspace_id));}
  async decide(actor:AuthenticatedSession,reviewId:string,decision:"retain"|"revoke",rationale:string,correlationId:string):Promise<ServiceAccountAccessReview>{return this.actorTransaction(actor,async client=>{
    const locked=await client.query<{service_account_id:string}>(`SELECT service_account_id FROM service_account_access_reviews WHERE id=$1 AND status IN ('pending','overdue') FOR UPDATE`,[reviewId]);if(!locked.rowCount)throw new DomainError("access_review_unavailable","Access review is unavailable or already decided.",409);
    const status=decision==="retain"?"retained":"revoked";await client.query(`UPDATE service_account_access_reviews SET status=$2,decided_by=$3,decided_at=now(),rationale=$4 WHERE id=$1`,[reviewId,status,actor.accountId,rationale]);
    if(decision==="retain")await client.query(`UPDATE service_accounts SET status='active',suspension_reason=NULL WHERE id=$1 AND status='suspended' AND suspension_reason='access_review_overdue'`,[locked.rows[0].service_account_id]);
    else{await client.query(`UPDATE service_accounts SET status='revoked',revoked_at=now(),suspension_reason=NULL WHERE id=$1`,[locked.rows[0].service_account_id]);const tokens=await client.query<{id:string}>(`UPDATE access_tokens SET revoked_at=now(),revocation_reason='access_review_revoked' WHERE service_account_id=$1 AND revoked_at IS NULL RETURNING id`,[locked.rows[0].service_account_id]);if(tokens.rowCount)await client.query(`UPDATE runner_commands SET status='expired',result_summary=jsonb_build_object('reason','access_review_revoked') WHERE authorization_context->>'credentialId'=ANY($1::text[]) AND status IN ('queued','delivered','accepted')`,[tokens.rows.map(row=>row.id)]);}
    const workspaces=await client.query<{workspace_id:string}>(`SELECT workspace_id FROM service_account_role_assignments WHERE service_account_id=$1`,[locked.rows[0].service_account_id]);for(const workspace of workspaces.rows)await client.query(`INSERT INTO audit_events(id,occurred_at,actor_account_id,workspace_id,action,resource_type,resource_id,after_summary,correlation_id) VALUES($1,now(),$2,$3,'service_account.access_review_decided','service_account_access_review',$4,$5,$6)`,[randomUUID(),actor.accountId,workspace.workspace_id,reviewId,{decision,rationale},correlationId]);
    return fromRow((await client.query<ReviewRow>(`${reviewSelect} WHERE review.id=$1`,[reviewId])).rows[0]);
  });}

  private async actorTransaction<T>(actor:AuthenticatedSession,operation:(client:PoolClient)=>Promise<T>):Promise<T>{const client=await this.pool.connect();try{await client.query('BEGIN');await client.query(`SELECT set_config('app.account_id',$1,true)`,[actor.accountId]);const result=await operation(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
  private async systemTransaction<T>(operation:(client:PoolClient)=>Promise<T>):Promise<T>{const client=await this.pool.connect();try{await client.query('BEGIN');await client.query(`SELECT set_config('app.system_role','service_account_access_review_worker',true)`);const result=await operation(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
}

const reviewSelect=`SELECT review.id,review.service_account_id,review.organisation_id,service.name service_account_name,ARRAY(SELECT assignment.workspace_id FROM service_account_role_assignments assignment WHERE assignment.service_account_id=service.id ORDER BY assignment.workspace_id) workspace_ids,review.opened_at,review.due_at,review.status,review.access_snapshot,review.decided_by,review.decided_at,review.rationale FROM service_account_access_reviews review JOIN service_accounts service ON service.id=review.service_account_id`;
function fromRow(row:ReviewRow):ServiceAccountAccessReview{return{id:row.id,serviceAccountId:row.service_account_id,organisationId:row.organisation_id,serviceAccountName:row.service_account_name,workspaceIds:row.workspace_ids,openedAt:row.opened_at.toISOString(),dueAt:row.due_at.toISOString(),status:row.status,accessSnapshot:row.access_snapshot,decidedBy:row.decided_by,decidedAt:row.decided_at?.toISOString()??null,rationale:row.rationale};}
