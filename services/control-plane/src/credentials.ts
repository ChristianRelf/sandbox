import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { permissions, type Permission } from "@sandbox/contracts";
import type { Pool, PoolClient } from "pg";
import type { AuthenticatedSession, SessionVerifier } from "./types.js";
import { DomainError } from "./types.js";

export interface CredentialRestrictions {
  organisationId:string;
  workspaceIds:string[];
  environmentIds:string[];
}
export interface IssueTokenInput extends CredentialRestrictions { name:string; scopes:Permission[]; expiresAt:Date }
export interface IssuedToken { id:string; name:string; prefix:string; token:string; scopes:Permission[]; organisationId:string; workspaceIds:string[]; environmentIds:string[]; createdAt:string; expiresAt:string }
export interface TokenSummary extends Omit<IssuedToken,"token"> { kind:"personal"|"service_account"; lastUsedAt:string|null; revokedAt:string|null }
export interface ServiceAccountRecord { id:string; organisationId:string; workspaceId:string|null; name:string; description:string; ownerAccountIds:string[]; roleId:string; environmentIds:string[]; expiryPolicyDays:number; status:"active"|"suspended"|"revoked"; createdAt:string; lastUsedAt:string|null }
export interface ServiceAccountAssignment { workspaceId:string; roleId:string; environmentIds:string[] }
export interface OrganisationServiceAccountRecord { id:string;organisationId:string;name:string;description:string;ownerAccountIds:string[];assignments:ServiceAccountAssignment[];expiryPolicyDays:number;status:"active"|"suspended"|"revoked";createdAt:string;lastUsedAt:string|null }
export interface CreateServiceAccountInput { workspaceId:string; name:string; description:string; roleId:string; environmentIds:string[]; expiryPolicyDays:number }
export interface CreateOrganisationServiceAccountInput { organisationId:string;name:string;description:string;assignments:ServiceAccountAssignment[];expiryPolicyDays:number }
export interface CredentialAdministration {
  createServiceAccount(actor:AuthenticatedSession,input:CreateServiceAccountInput,correlationId:string):Promise<ServiceAccountRecord>;
  listServiceAccounts(actor:AuthenticatedSession,workspaceId:string):Promise<ServiceAccountRecord[]>;
  createOrganisationServiceAccount(actor:AuthenticatedSession,input:CreateOrganisationServiceAccountInput,correlationId:string):Promise<OrganisationServiceAccountRecord>;
  issuePersonalToken(actor:AuthenticatedSession,input:IssueTokenInput,correlationId:string):Promise<IssuedToken>;
  issueServiceAccountToken(actor:AuthenticatedSession,serviceAccountId:string,input:IssueTokenInput,correlationId:string):Promise<IssuedToken>;
  listPersonalTokens(actor:AuthenticatedSession):Promise<TokenSummary[]>;
  revokeToken(actor:AuthenticatedSession,tokenId:string,reason:string,correlationId:string,workspaceId?:string):Promise<boolean>;
}
export interface InteractiveAccountValidator { assertInteractiveAccount(accountId:string):Promise<void> }

export class PostgresCredentialService implements SessionVerifier,CredentialAdministration,InteractiveAccountValidator {
  constructor(private readonly pool:Pool,private readonly pepper:Buffer) {
    if (pepper.length<32) throw new Error("Access-token pepper must contain at least 32 bytes.");
  }

  async createServiceAccount(actor:AuthenticatedSession,input:CreateServiceAccountInput,correlationId:string):Promise<ServiceAccountRecord> {
    return this.actorTransaction(actor,async client=>{
      const workspace=await client.query<{ organisation_id:string }>(`SELECT organisation_id FROM workspaces WHERE id=$1`,[input.workspaceId]);
      if(!workspace.rowCount) throw new DomainError("workspace_not_found","Workspace was not found or is not accessible.",404);
      const role=await client.query(`SELECT 1 FROM roles WHERE id=$1 AND organisation_id=$2`,[input.roleId,workspace.rows[0].organisation_id]);
      if(!role.rowCount) throw new DomainError("service_account_role_invalid","The service-account role must belong to the workspace organisation.",400);
      if(input.environmentIds.length){
        const environments=await client.query<{ id:string }>(`SELECT id FROM environments WHERE workspace_id=$1 AND id=ANY($2::uuid[])`,[input.workspaceId,input.environmentIds]);
        if(environments.rowCount!==new Set(input.environmentIds).size) throw new DomainError("service_account_environment_invalid","Every environment restriction must belong to the selected workspace.",400);
      }
      const id=randomUUID(),principalAccountId=randomUUID();
      await client.query(`INSERT INTO accounts(id,identity_subject,primary_email,email_verified,display_name,account_kind) VALUES($1,$2,$3,true,$4,'service_account')`,[principalAccountId,`service-account:${id}`,`${id}@service.invalid`,input.name]);
      const created=await client.query<{ created_at:Date }>(`INSERT INTO service_accounts(id,principal_account_id,organisation_id,workspace_id,name,description,expiry_policy_days,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING created_at`,[id,principalAccountId,workspace.rows[0].organisation_id,input.workspaceId,input.name,input.description,input.expiryPolicyDays,actor.accountId]);
      await client.query(`INSERT INTO service_account_owners(service_account_id,account_id,assigned_by) VALUES($1,$2,$2)`,[id,actor.accountId]);
      await client.query(`INSERT INTO service_account_role_assignments(service_account_id,workspace_id,role_id,environment_ids,assigned_by) VALUES($1,$2,$3,$4,$5)`,[id,input.workspaceId,input.roleId,input.environmentIds,actor.accountId]);
      await client.query(`INSERT INTO workspace_memberships(workspace_id,account_id,role_id) VALUES($1,$2,$3)`,[input.workspaceId,principalAccountId,input.roleId]);
      await audit(client,actor,input.workspaceId,"service_account.created","service_account",id,{name:input.name,roleId:input.roleId,environmentIds:input.environmentIds},correlationId);
      return {id,organisationId:workspace.rows[0].organisation_id,workspaceId:input.workspaceId,name:input.name,description:input.description,ownerAccountIds:[actor.accountId],roleId:input.roleId,environmentIds:input.environmentIds,expiryPolicyDays:input.expiryPolicyDays,status:"active",createdAt:created.rows[0].created_at.toISOString(),lastUsedAt:null};
    });
  }

  async listServiceAccounts(actor:AuthenticatedSession,workspaceId:string):Promise<ServiceAccountRecord[]> {
    return this.actorTransaction(actor,async client=>{
      const result=await client.query<ServiceAccountRow>(`SELECT service.id,service.organisation_id,service.workspace_id,service.name,service.description,service.expiry_policy_days,service.status,service.created_at,service.last_used_at,assignment.role_id,assignment.environment_ids,array_agg(owner.account_id ORDER BY owner.account_id) AS owner_account_ids FROM service_accounts service JOIN service_account_role_assignments assignment ON assignment.service_account_id=service.id AND assignment.workspace_id=$1 JOIN service_account_owners owner ON owner.service_account_id=service.id GROUP BY service.id,assignment.role_id,assignment.environment_ids ORDER BY service.name,service.id`,[workspaceId]);
      return result.rows.map(serviceAccountFromRow);
    });
  }

  async createOrganisationServiceAccount(actor:AuthenticatedSession,input:CreateOrganisationServiceAccountInput,correlationId:string):Promise<OrganisationServiceAccountRecord>{
    if(!input.assignments.length||new Set(input.assignments.map(item=>item.workspaceId)).size!==input.assignments.length)throw new DomainError("service_account_assignments_invalid","Organisation service accounts require unique workspace assignments.",400);
    return this.actorTransaction(actor,async client=>{
      const workspaceIds=input.assignments.map(item=>item.workspaceId);
      const workspaces=await client.query<{id:string}>(`SELECT id FROM workspaces WHERE organisation_id=$1 AND id=ANY($2::uuid[])`,[input.organisationId,workspaceIds]);
      if(workspaces.rowCount!==workspaceIds.length)throw new DomainError("service_account_workspace_invalid","Every assignment must belong to the selected organisation.",400);
      for(const assignment of input.assignments){
        const role=await client.query(`SELECT 1 FROM roles WHERE id=$1 AND organisation_id=$2`,[assignment.roleId,input.organisationId]);
        if(!role.rowCount)throw new DomainError("service_account_role_invalid","Every assigned role must belong to the selected organisation.",400);
        if(assignment.environmentIds.length){const environments=await client.query(`SELECT id FROM environments WHERE workspace_id=$1 AND id=ANY($2::uuid[])`,[assignment.workspaceId,assignment.environmentIds]);if(environments.rowCount!==new Set(assignment.environmentIds).size)throw new DomainError("service_account_environment_invalid","Every environment restriction must belong to its assigned workspace.",400);}
      }
      const id=randomUUID(),principalAccountId=randomUUID(),createdAt=new Date();
      await client.query(`INSERT INTO accounts(id,identity_subject,primary_email,email_verified,display_name,account_kind) VALUES($1,$2,$3,true,$4,'service_account')`,[principalAccountId,`service-account:${id}`,`${id}@service.invalid`,input.name]);
      await client.query(`INSERT INTO service_accounts(id,principal_account_id,organisation_id,workspace_id,name,description,expiry_policy_days,created_by,created_at) VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8)`,[id,principalAccountId,input.organisationId,input.name,input.description,input.expiryPolicyDays,actor.accountId,createdAt]);
      for(const assignment of input.assignments){
        await client.query(`INSERT INTO service_account_role_assignments(service_account_id,workspace_id,role_id,environment_ids,assigned_by) VALUES($1,$2,$3,$4,$5)`,[id,assignment.workspaceId,assignment.roleId,assignment.environmentIds,actor.accountId]);
        await client.query(`INSERT INTO workspace_memberships(workspace_id,account_id,role_id) VALUES($1,$2,$3)`,[assignment.workspaceId,principalAccountId,assignment.roleId]);
        await audit(client,actor,assignment.workspaceId,"service_account.assigned","service_account",id,{organisationId:input.organisationId,roleId:assignment.roleId,environmentIds:assignment.environmentIds},correlationId);
      }
      await client.query(`INSERT INTO service_account_owners(service_account_id,account_id,assigned_by) VALUES($1,$2,$2)`,[id,actor.accountId]);
      return{id,organisationId:input.organisationId,name:input.name,description:input.description,ownerAccountIds:[actor.accountId],assignments:input.assignments,expiryPolicyDays:input.expiryPolicyDays,status:"active",createdAt:createdAt.toISOString(),lastUsedAt:null};
    });
  }

  async issuePersonalToken(actor:AuthenticatedSession,input:IssueTokenInput,correlationId:string):Promise<IssuedToken> {
    validateIssue(input,90);
    return this.actorTransaction(actor,async client=>{
      await validateRestrictions(client,actor.accountId,input);
      const issued=await insertToken(client,this.pepper,"personal",actor.accountId,null,actor,input);
      await audit(client,actor,input.workspaceIds[0],"access_token.created","personal_access_token",issued.id,{name:input.name,prefix:issued.prefix,scopes:input.scopes,expiresAt:input.expiresAt.toISOString()},correlationId);
      return issued;
    });
  }

  async issueServiceAccountToken(actor:AuthenticatedSession,serviceAccountId:string,input:IssueTokenInput,correlationId:string):Promise<IssuedToken> {
    return this.actorTransaction(actor,async client=>{
      const service=await client.query<{ organisation_id:string;workspace_id:string|null;expiry_policy_days:number;status:string }>(`SELECT organisation_id,workspace_id,expiry_policy_days,status FROM service_accounts WHERE id=$1`,[serviceAccountId]);
      if(!service.rowCount||service.rows[0].status!=="active") throw new DomainError("service_account_unavailable","Service account is unavailable.",404);
      validateIssue(input,service.rows[0].expiry_policy_days);
      if(input.organisationId!==service.rows[0].organisation_id) throw new DomainError("credential_organisation_restricted","Credential organisation does not match the service account.",400);
      if(service.rows[0].workspace_id && (input.workspaceIds.length!==1||input.workspaceIds[0]!==service.rows[0].workspace_id)) throw new DomainError("credential_workspace_restricted","Credential must remain restricted to the service account workspace.",400);
      const assignment=await client.query<{ workspace_id:string;environment_ids:string[];permission:string|null }>(`SELECT assignment.workspace_id,assignment.environment_ids,permission.permission FROM service_account_role_assignments assignment LEFT JOIN role_permissions permission ON permission.role_id=assignment.role_id WHERE assignment.service_account_id=$1`,[serviceAccountId]);
      const allowedWorkspaces=new Set(assignment.rows.map(row=>row.workspace_id));
      if(input.workspaceIds.some(id=>!allowedWorkspaces.has(id))) throw new DomainError("credential_workspace_restricted","Credential contains a workspace not assigned to the service account.",400);
      const allowedEnvironments=new Set(assignment.rows.flatMap(row=>row.environment_ids));
      if(input.environmentIds.some(id=>!allowedEnvironments.has(id))) throw new DomainError("credential_environment_restricted","Credential contains an environment not assigned to the service account.",400);
      const allowedPermissions=new Set(assignment.rows.map(row=>row.permission).filter((value):value is string=>value!==null));
      if(input.scopes.some(scope=>!allowedPermissions.has(scope))) throw new DomainError("credential_scope_denied","Credential scopes must be a subset of the service account role.",400);
      const issued=await insertToken(client,this.pepper,"service_account",null,serviceAccountId,actor,input);
      await audit(client,actor,input.workspaceIds[0],"access_token.created","service_account_token",issued.id,{serviceAccountId,name:input.name,prefix:issued.prefix,scopes:input.scopes,expiresAt:input.expiresAt.toISOString()},correlationId);
      return issued;
    });
  }

  async listPersonalTokens(actor:AuthenticatedSession):Promise<TokenSummary[]> {
    return this.actorTransaction(actor,async client=>tokenRows(await client.query(`SELECT * FROM access_tokens WHERE token_kind='personal' AND owner_account_id=$1 ORDER BY created_at DESC`,[actor.accountId])));
  }

  async revokeToken(actor:AuthenticatedSession,tokenId:string,reason:string,correlationId:string,workspaceId?:string):Promise<boolean> {
    return this.actorTransaction(actor,async client=>{
      const token=await client.query<{ workspace_restrictions:string[];owner_account_id:string|null;service_account_id:string|null }>(`SELECT workspace_restrictions,owner_account_id,service_account_id FROM access_tokens WHERE id=$1 AND revoked_at IS NULL FOR UPDATE`,[tokenId]);
      if(!token.rowCount) return false;
      if(token.rows[0].owner_account_id && token.rows[0].owner_account_id!==actor.accountId) throw new DomainError("credential_owner_required","Only the token owner can revoke this personal token.",403);
      if(workspaceId&&(!token.rows[0].service_account_id||!token.rows[0].workspace_restrictions.includes(workspaceId)))return false;
      await client.query(`UPDATE access_tokens SET revoked_at=now(),revocation_reason=$2 WHERE id=$1`,[tokenId,reason]);
      await client.query(`UPDATE runner_commands SET status='expired',result_summary=jsonb_build_object('reason','issuing_credential_revoked') WHERE authorization_context->>'credentialId'=$1 AND status IN ('queued','delivered','accepted')`,[tokenId]);
      const auditWorkspaceId=token.rows[0].workspace_restrictions[0];
      if(auditWorkspaceId) await audit(client,actor,auditWorkspaceId,"access_token.revoked","access_token",tokenId,null,correlationId);
      return true;
    });
  }

  async verify(token:string):Promise<AuthenticatedSession> {
    const parsed=/^(sbx_(?:pat|sa)_[A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if(!parsed) throw new DomainError("invalid_session","Access token is malformed.",401);
    const result=await this.pool.query<TokenLookupRow>(`SELECT token.*,account.id AS principal_account_id,account.primary_email,service.status AS service_status,array_remove(array_agg(DISTINCT permission.permission),NULL) AS principal_permissions FROM access_tokens token LEFT JOIN service_accounts service ON service.id=token.service_account_id JOIN accounts account ON account.id=COALESCE(token.owner_account_id,service.principal_account_id) LEFT JOIN service_account_role_assignments assignment ON assignment.service_account_id=service.id LEFT JOIN role_permissions permission ON permission.role_id=assignment.role_id WHERE token.token_prefix=$1 GROUP BY token.id,account.id,service.status`,[parsed[1]]);
    if(!result.rowCount) throw new DomainError("invalid_session","Access token is invalid or expired.",401);
    const row=result.rows[0],candidate=tokenDigest(this.pepper,token);
    if(row.token_hash.length!==candidate.length||!timingSafeEqual(row.token_hash,candidate)||row.revoked_at||row.expires_at<=new Date()||(row.token_kind==="service_account"&&row.service_status!=="active")) throw new DomainError("invalid_session","Access token is invalid, expired, or revoked.",401);
    await this.pool.query(`UPDATE access_tokens SET last_used_at=now() WHERE id=$1`,[row.id]);
    if(row.service_account_id) await this.pool.query(`UPDATE service_accounts SET last_used_at=now() WHERE id=$1`,[row.service_account_id]);
    return {accountId:row.principal_account_id,sessionId:row.id,subject:`${row.token_kind}:${row.id}`,email:row.primary_email,issuedAt:row.created_at,expiresAt:row.expires_at,authenticationMethods:["access_token"],platformPermissions:[],principalType:row.token_kind==="personal"?"personal_access_token":"service_account",principalId:row.service_account_id??row.owner_account_id!,credentialScopes:row.scopes,principalPermissions:row.token_kind==="service_account"?row.principal_permissions:undefined,organisationRestriction:row.organisation_id,workspaceRestrictions:row.workspace_restrictions,environmentRestrictions:row.environment_restrictions};
  }

  async assertInteractiveAccount(accountId:string):Promise<void>{
    const result=await this.pool.query<{ account_kind:string }>(`SELECT account_kind FROM accounts WHERE id=$1 AND deleted_at IS NULL`,[accountId]);
    if(!result.rowCount||result.rows[0].account_kind!=="human")throw new DomainError("interactive_login_forbidden","Interactive login is not available for this principal.",403);
  }

  private async actorTransaction<T>(actor:AuthenticatedSession,operation:(client:PoolClient)=>Promise<T>):Promise<T>{
    const client=await this.pool.connect();
    try{await client.query('BEGIN');await client.query(`SELECT set_config('app.account_id',$1,true)`,[actor.accountId]);const value=await operation(client);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}

export class CompositeSessionVerifier implements SessionVerifier {
  constructor(private readonly oidc:SessionVerifier,private readonly credentials:SessionVerifier&InteractiveAccountValidator){}
  async verify(token:string):Promise<AuthenticatedSession>{
    if(token.startsWith("sbx_"))return this.credentials.verify(token);
    const session=await this.oidc.verify(token);await this.credentials.assertInteractiveAccount(session.accountId);
    return{...session,principalType:"user",principalId:session.accountId};
  }
}

async function insertToken(client:PoolClient,pepper:Buffer,kind:"personal"|"service_account",ownerAccountId:string|null,serviceAccountId:string|null,actor:AuthenticatedSession,input:IssueTokenInput):Promise<IssuedToken>{
  const id=randomUUID(),publicId=randomBytes(9).toString("base64url"),prefix=`sbx_${kind==="personal"?"pat":"sa"}_${publicId}`,secret=randomBytes(32).toString("base64url"),token=`${prefix}.${secret}`,createdAt=new Date();
  await client.query(`INSERT INTO access_tokens(id,token_kind,token_prefix,token_hash,name,owner_account_id,service_account_id,organisation_id,scopes,workspace_restrictions,environment_restrictions,created_by,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[id,kind,prefix,tokenDigest(pepper,token),input.name,ownerAccountId,serviceAccountId,input.organisationId,input.scopes,input.workspaceIds,input.environmentIds,actor.accountId,createdAt,input.expiresAt]);
  return{id,name:input.name,prefix,token,scopes:input.scopes,organisationId:input.organisationId,workspaceIds:input.workspaceIds,environmentIds:input.environmentIds,createdAt:createdAt.toISOString(),expiresAt:input.expiresAt.toISOString()};
}

function validateIssue(input:IssueTokenInput,maxDays:number):void{
  if(!input.name.trim()||input.name.length>120) throw new DomainError("credential_name_invalid","Credential name is required and cannot exceed 120 characters.");
  if(!input.scopes.length||input.scopes.some(scope=>!permissions.includes(scope))) throw new DomainError("credential_scope_invalid","Credential requires supported, non-empty scopes.");
  if(!input.workspaceIds.length) throw new DomainError("credential_workspace_required","Credential must be restricted to at least one workspace.");
  const maximum=Date.now()+maxDays*86_400_000;
  if(input.expiresAt<=new Date()||input.expiresAt.getTime()>maximum+60_000) throw new DomainError("credential_expiry_invalid",`Credential expiry must be within ${maxDays} days.`);
}
async function validateRestrictions(client:PoolClient,accountId:string,input:IssueTokenInput):Promise<void>{
  const workspaces=await client.query<{ id:string }>(`SELECT workspace.id FROM workspaces workspace JOIN workspace_memberships membership ON membership.workspace_id=workspace.id WHERE workspace.organisation_id=$1 AND membership.account_id=$2 AND workspace.id=ANY($3::uuid[])`,[input.organisationId,accountId,input.workspaceIds]);
  if(workspaces.rowCount!==new Set(input.workspaceIds).size) throw new DomainError("credential_workspace_restricted","Every workspace restriction must be accessible and belong to the selected organisation.",400);
  if(input.environmentIds.length){const environments=await client.query(`SELECT id FROM environments WHERE workspace_id=ANY($1::uuid[]) AND id=ANY($2::uuid[])`,[input.workspaceIds,input.environmentIds]);if(environments.rowCount!==new Set(input.environmentIds).size) throw new DomainError("credential_environment_restricted","Every environment restriction must belong to a selected workspace.",400);}
}
function tokenDigest(pepper:Buffer,token:string):Buffer{return createHmac("sha256",pepper).update(token,"utf8").digest();}
function tokenRows(result:{rows:Array<Record<string,unknown>>}):TokenSummary[]{return result.rows.map(row=>({id:String(row.id),kind:row.token_kind as "personal"|"service_account",name:String(row.name),prefix:String(row.token_prefix),scopes:row.scopes as Permission[],organisationId:String(row.organisation_id),workspaceIds:row.workspace_restrictions as string[],environmentIds:row.environment_restrictions as string[],createdAt:(row.created_at as Date).toISOString(),expiresAt:(row.expires_at as Date).toISOString(),lastUsedAt:row.last_used_at?(row.last_used_at as Date).toISOString():null,revokedAt:row.revoked_at?(row.revoked_at as Date).toISOString():null}));}
async function audit(client:PoolClient,actor:AuthenticatedSession,workspaceId:string|undefined,action:string,resourceType:string,resourceId:string,after:unknown,correlationId:string):Promise<void>{if(!workspaceId)return;await client.query(`INSERT INTO audit_events(id,occurred_at,actor_account_id,workspace_id,action,resource_type,resource_id,after_summary,correlation_id) VALUES($1,now(),$2,$3,$4,$5,$6,$7,$8)`,[randomUUID(),actor.accountId,workspaceId,action,resourceType,resourceId,after,correlationId]);}

interface TokenLookupRow { id:string;token_kind:"personal"|"service_account";token_hash:Buffer;owner_account_id:string|null;service_account_id:string|null;organisation_id:string;scopes:Permission[];workspace_restrictions:string[];environment_restrictions:string[];created_at:Date;expires_at:Date;revoked_at:Date|null;principal_account_id:string;primary_email:string;service_status:string|null;principal_permissions:Permission[] }
interface ServiceAccountRow { id:string;organisation_id:string;workspace_id:string|null;name:string;description:string;owner_account_ids:string[];role_id:string;environment_ids:string[];expiry_policy_days:number;status:"active"|"suspended"|"revoked";created_at:Date;last_used_at:Date|null }
function serviceAccountFromRow(row:ServiceAccountRow):ServiceAccountRecord{return{id:row.id,organisationId:row.organisation_id,workspaceId:row.workspace_id,name:row.name,description:row.description,ownerAccountIds:row.owner_account_ids,roleId:row.role_id,environmentIds:row.environment_ids,expiryPolicyDays:row.expiry_policy_days,status:row.status,createdAt:row.created_at.toISOString(),lastUsedAt:row.last_used_at?.toISOString()??null};}
