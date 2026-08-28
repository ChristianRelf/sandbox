import { createHmac, createPublicKey, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { permissions, type Permission } from "@sandbox/contracts";
import type { Pool, PoolClient } from "pg";
import { decodeJwt,decodeProtectedHeader,importSPKI,jwtVerify } from "jose";
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
export interface ServiceAccountAssertionKey { serviceAccountId:string;workspaceId:string;keyId:string;algorithm:"EdDSA";createdAt:string;revokedAt:string|null }
export interface CredentialAdministration {
  createServiceAccount(actor:AuthenticatedSession,input:CreateServiceAccountInput,correlationId:string):Promise<ServiceAccountRecord>;
  listServiceAccounts(actor:AuthenticatedSession,workspaceId:string):Promise<ServiceAccountRecord[]>;
  createOrganisationServiceAccount(actor:AuthenticatedSession,input:CreateOrganisationServiceAccountInput,correlationId:string):Promise<OrganisationServiceAccountRecord>;
  issuePersonalToken(actor:AuthenticatedSession,input:IssueTokenInput,correlationId:string):Promise<IssuedToken>;
  issueServiceAccountToken(actor:AuthenticatedSession,serviceAccountId:string,input:IssueTokenInput,correlationId:string):Promise<IssuedToken>;
  listPersonalTokens(actor:AuthenticatedSession):Promise<TokenSummary[]>;
  revokeToken(actor:AuthenticatedSession,tokenId:string,reason:string,correlationId:string,workspaceId?:string):Promise<boolean>;
  registerServiceAccountAssertionKey(actor:AuthenticatedSession,serviceAccountId:string,workspaceId:string,keyId:string,publicKeyDerBase64:string,correlationId:string):Promise<ServiceAccountAssertionKey>;
  revokeServiceAccountAssertionKey(actor:AuthenticatedSession,serviceAccountId:string,workspaceId:string,keyId:string,reason:string,correlationId:string):Promise<boolean>;
  exchangeServiceAccountAssertion(assertion:string):Promise<IssuedToken>;
}
export interface InteractiveAccountValidator { assertInteractiveAccount(accountId:string):Promise<void> }

export class PostgresCredentialService implements SessionVerifier,CredentialAdministration,InteractiveAccountValidator {
  constructor(private readonly pool:Pool,private readonly pepper:Buffer,private readonly assertionAudience?:string) {
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
      if(allowedEnvironments.size&&input.environmentIds.length===0)throw new DomainError("credential_environment_required","Credentials for an environment-restricted service account must select at least one assigned environment.",400);
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

  async registerServiceAccountAssertionKey(actor:AuthenticatedSession,serviceAccountId:string,workspaceId:string,keyId:string,publicKeyDerBase64:string,correlationId:string):Promise<ServiceAccountAssertionKey>{
    const publicKeyDer=Buffer.from(publicKeyDerBase64,"base64");
    try{const key=createPublicKey({key:publicKeyDer,format:"der",type:"spki"});if(key.asymmetricKeyType!=="ed25519")throw new Error("not Ed25519");}catch{throw new DomainError("assertion_key_invalid","Assertion keys must be Ed25519 SubjectPublicKeyInfo DER values.",400);}
    return this.actorTransaction(actor,async client=>{
      const assignment=await client.query(`SELECT 1 FROM service_account_role_assignments assignment JOIN service_accounts service ON service.id=assignment.service_account_id WHERE assignment.service_account_id=$1 AND assignment.workspace_id=$2 AND service.status='active'`,[serviceAccountId,workspaceId]);
      if(!assignment.rowCount)throw new DomainError("service_account_unavailable","Service account assignment is unavailable.",404);
      const createdAt=new Date();
      try{await client.query(`INSERT INTO service_account_assertion_keys(service_account_id,workspace_id,key_id,public_key_der,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6)`,[serviceAccountId,workspaceId,keyId,publicKeyDer,actor.accountId,createdAt]);}catch(error){if((error as {code?:string}).code==="23505")throw new DomainError("assertion_key_exists","An assertion key with this ID already exists in the workspace.",409);throw error;}
      await audit(client,actor,workspaceId,"service_account.assertion_key_registered","service_account",serviceAccountId,{keyId,algorithm:"EdDSA"},correlationId);
      return{serviceAccountId,workspaceId,keyId,algorithm:"EdDSA",createdAt:createdAt.toISOString(),revokedAt:null};
    });
  }

  async revokeServiceAccountAssertionKey(actor:AuthenticatedSession,serviceAccountId:string,workspaceId:string,keyId:string,reason:string,correlationId:string):Promise<boolean>{
    return this.actorTransaction(actor,async client=>{
      const result=await client.query(`UPDATE service_account_assertion_keys SET revoked_at=now(),revocation_reason=$4 WHERE service_account_id=$1 AND workspace_id=$2 AND key_id=$3 AND revoked_at IS NULL`,[serviceAccountId,workspaceId,keyId,reason]);
      if(result.rowCount){const tokens=await client.query<{id:string}>(`UPDATE access_tokens SET revoked_at=now(),revocation_reason='assertion_key_revoked' WHERE service_account_id=$1 AND assertion_workspace_id=$2 AND assertion_key_id=$3 AND revoked_at IS NULL RETURNING id`,[serviceAccountId,workspaceId,keyId]);if(tokens.rowCount)await client.query(`UPDATE runner_commands SET status='expired',result_summary=jsonb_build_object('reason','assertion_key_revoked') WHERE authorization_context->>'credentialId'=ANY($1::text[]) AND status IN ('queued','delivered','accepted')`,[tokens.rows.map(row=>row.id)]);await audit(client,actor,workspaceId,"service_account.assertion_key_revoked","service_account",serviceAccountId,{keyId,reason,revokedCredentialCount:tokens.rowCount??0},correlationId);}
      return Boolean(result.rowCount);
    });
  }

  async exchangeServiceAccountAssertion(assertion:string):Promise<IssuedToken>{
    if(!this.assertionAudience)throw new DomainError("assertion_authentication_unavailable","Service-account assertion authentication is not configured.",503);
    let unverified:ReturnType<typeof decodeJwt>,header:ReturnType<typeof decodeProtectedHeader>;
    try{unverified=decodeJwt(assertion);header=decodeProtectedHeader(assertion);}catch{throw new DomainError("client_assertion_invalid","Client assertion is malformed.",401);}
    const serviceAccountId=typeof unverified.iss==="string"?unverified.iss:"",keyId=typeof header.kid==="string"?header.kid:"",unverifiedWorkspaceIds=claimStrings(unverified.sandbox_workspace_ids);
    if(!uuidPattern.test(serviceAccountId)||!keyIdPattern.test(keyId)||unverifiedWorkspaceIds.length!==1||!uuidPattern.test(unverifiedWorkspaceIds[0]))throw new DomainError("client_assertion_invalid","Client assertion issuer, key ID, and workspace are required.",401);
    const key=await this.systemTransaction(async client=>(await client.query<{workspace_id:string;public_key_der:Buffer}>(`SELECT workspace_id,public_key_der FROM service_account_assertion_keys WHERE service_account_id=$1 AND workspace_id=$2 AND key_id=$3 AND revoked_at IS NULL`,[serviceAccountId,unverifiedWorkspaceIds[0],keyId])).rows[0]??null);
    if(!key)throw new DomainError("client_assertion_invalid","Client assertion key is unavailable.",401);
    let payload:Awaited<ReturnType<typeof jwtVerify>>["payload"];
    try{
      const pem=createPublicKey({key:key.public_key_der,format:"der",type:"spki"}).export({format:"pem",type:"spki"}).toString();
      payload=(await jwtVerify(assertion,await importSPKI(pem,"EdDSA"),{algorithms:["EdDSA"],issuer:serviceAccountId,subject:serviceAccountId,audience:this.assertionAudience,maxTokenAge:"5 minutes",clockTolerance:5,requiredClaims:["iat","exp","jti"]})).payload;
    }catch{throw new DomainError("client_assertion_invalid","Client assertion signature, audience, or lifetime is invalid.",401);}
    const assertionId=typeof payload.jti==="string"?payload.jti:"",scopes=claimPermissions(payload.sandbox_scopes),workspaceIds=claimStrings(payload.sandbox_workspace_ids),environmentIds=claimStrings(payload.sandbox_environment_ids);
    if(assertionId.length<16||assertionId.length>200||workspaceIds.length!==1||workspaceIds[0]!==key.workspace_id||typeof payload.iat!=="number"||typeof payload.exp!=="number"||payload.exp-payload.iat>300)throw new DomainError("client_assertion_invalid","Client assertion ID, lifetime, and workspace restriction are invalid.",401);
    const expiresAt=new Date(Date.now()+15*60_000);
    return this.systemTransaction(async client=>{
      const activeKey=await client.query(`SELECT 1 FROM service_account_assertion_keys WHERE service_account_id=$1 AND workspace_id=$2 AND key_id=$3 AND revoked_at IS NULL FOR SHARE`,[serviceAccountId,key.workspace_id,keyId]);
      if(!activeKey.rowCount)throw new DomainError("client_assertion_invalid","Client assertion key is unavailable.",401);
      await client.query(`DELETE FROM service_account_assertion_replays WHERE ctid IN(SELECT ctid FROM service_account_assertion_replays WHERE expires_at<=now() ORDER BY expires_at LIMIT 1000)`);
      try{await client.query(`INSERT INTO service_account_assertion_replays(service_account_id,workspace_id,key_id,assertion_id,expires_at) VALUES($1,$2,$3,$4,to_timestamp($5))`,[serviceAccountId,key.workspace_id,keyId,assertionId,payload.exp]);}catch(error){if((error as {code?:string}).code==="23505")throw new DomainError("client_assertion_replayed","Client assertion has already been used.",401);throw error;}
      const service=await client.query<{organisation_id:string;principal_account_id:string;primary_email:string;environment_ids:string[];permission:string|null}>(`SELECT service.organisation_id,service.principal_account_id,account.primary_email,assignment.environment_ids,permission.permission FROM service_accounts service JOIN accounts account ON account.id=service.principal_account_id JOIN service_account_role_assignments assignment ON assignment.service_account_id=service.id AND assignment.workspace_id=$2 LEFT JOIN role_permissions permission ON permission.role_id=assignment.role_id WHERE service.id=$1 AND service.status='active'`,[serviceAccountId,key.workspace_id]);
      if(!service.rowCount)throw new DomainError("service_account_unavailable","Service account is unavailable.",401);
      const allowedPermissions=new Set(service.rows.map(row=>row.permission).filter((value):value is string=>value!==null));
      if(!scopes.length||scopes.some(scope=>!allowedPermissions.has(scope)))throw new DomainError("credential_scope_denied","Assertion scopes must be a subset of the service-account role.",403);
      const allowedEnvironments=new Set(service.rows[0].environment_ids);
      if(allowedEnvironments.size&&environmentIds.length===0)throw new DomainError("credential_environment_required","Assertions for an environment-restricted service account must select at least one assigned environment.",403);
      if(environmentIds.some(id=>!allowedEnvironments.has(id)))throw new DomainError("credential_environment_restricted","Assertion contains an environment not assigned to the service account.",403);
      const actor:AuthenticatedSession={accountId:service.rows[0].principal_account_id,sessionId:assertionId,subject:`service_account_assertion:${serviceAccountId}`,email:service.rows[0].primary_email,issuedAt:new Date((payload.iat??Math.floor(Date.now()/1000))*1000),expiresAt:new Date((payload.exp??0)*1000),authenticationMethods:["private_key_jwt"],platformPermissions:[],principalType:"service_account",principalId:serviceAccountId};
      return insertToken(client,this.pepper,"service_account",null,serviceAccountId,actor,{name:`assertion:${keyId}`,scopes,organisationId:service.rows[0].organisation_id,workspaceIds,environmentIds,expiresAt},false,{workspaceId:key.workspace_id,keyId});
    });
  }

  async verify(token:string):Promise<AuthenticatedSession> {
    const parsed=/^(sbx_(?:pat|sa)_[A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if(!parsed) throw new DomainError("invalid_session","Access token is malformed.",401);
    const result=await this.pool.query<TokenLookupRow>(`SELECT token.*,account.id AS principal_account_id,account.primary_email,service.status AS service_status,assertion_key.revoked_at AS assertion_key_revoked_at,array_remove(array_agg(DISTINCT permission.permission),NULL) AS principal_permissions FROM access_tokens token LEFT JOIN service_accounts service ON service.id=token.service_account_id LEFT JOIN service_account_assertion_keys assertion_key ON assertion_key.service_account_id=token.service_account_id AND assertion_key.workspace_id=token.assertion_workspace_id AND assertion_key.key_id=token.assertion_key_id JOIN accounts account ON account.id=COALESCE(token.owner_account_id,service.principal_account_id) LEFT JOIN service_account_role_assignments assignment ON assignment.service_account_id=service.id LEFT JOIN role_permissions permission ON permission.role_id=assignment.role_id WHERE token.token_prefix=$1 GROUP BY token.id,account.id,service.status,assertion_key.revoked_at`,[parsed[1]]);
    if(!result.rowCount) throw new DomainError("invalid_session","Access token is invalid or expired.",401);
    const row=result.rows[0],candidate=tokenDigest(this.pepper,token);
    if(row.token_hash.length!==candidate.length||!timingSafeEqual(row.token_hash,candidate)||row.revoked_at||row.assertion_key_revoked_at||row.expires_at<=new Date()||(row.token_kind==="service_account"&&row.service_status!=="active")) throw new DomainError("invalid_session","Access token is invalid, expired, or revoked.",401);
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
  private async systemTransaction<T>(operation:(client:PoolClient)=>Promise<T>):Promise<T>{const client=await this.pool.connect();try{await client.query('BEGIN');await client.query(`SELECT set_config('app.system_role','service_assertion_verifier',true)`);const value=await operation(client);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
}

export class CompositeSessionVerifier implements SessionVerifier {
  constructor(private readonly oidc:SessionVerifier,private readonly credentials:SessionVerifier&InteractiveAccountValidator){}
  async verify(token:string):Promise<AuthenticatedSession>{
    if(token.startsWith("sbx_"))return this.credentials.verify(token);
    const session=await this.oidc.verify(token);await this.credentials.assertInteractiveAccount(session.accountId);
    return{...session,principalType:"user",principalId:session.accountId};
  }
}

async function insertToken(client:PoolClient,pepper:Buffer,kind:"personal"|"service_account",ownerAccountId:string|null,serviceAccountId:string|null,actor:AuthenticatedSession,input:IssueTokenInput,expiryNotificationEnabled=true,assertionKey?:{workspaceId:string;keyId:string}):Promise<IssuedToken>{
  const id=randomUUID(),publicId=randomBytes(9).toString("base64url"),prefix=`sbx_${kind==="personal"?"pat":"sa"}_${publicId}`,secret=randomBytes(32).toString("base64url"),token=`${prefix}.${secret}`,createdAt=new Date();
  await client.query(`INSERT INTO access_tokens(id,token_kind,token_prefix,token_hash,name,owner_account_id,service_account_id,organisation_id,scopes,workspace_restrictions,environment_restrictions,created_by,created_at,expires_at,expiry_notification_enabled,assertion_workspace_id,assertion_key_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,[id,kind,prefix,tokenDigest(pepper,token),input.name,ownerAccountId,serviceAccountId,input.organisationId,input.scopes,input.workspaceIds,input.environmentIds,actor.accountId,createdAt,input.expiresAt,expiryNotificationEnabled,assertionKey?.workspaceId??null,assertionKey?.keyId??null]);
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
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyIdPattern=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function claimStrings(value:unknown):string[]{if(!Array.isArray(value)||value.length>100||value.some(item=>typeof item!=="string"))throw new DomainError("client_assertion_invalid","Client assertion restrictions must be bounded string arrays.",401);return [...new Set(value)];}
function claimPermissions(value:unknown):Permission[]{const values=claimStrings(value);if(values.some(item=>!permissions.includes(item as Permission)))throw new DomainError("client_assertion_invalid","Client assertion contains an unsupported scope.",401);return values as Permission[];}
function tokenRows(result:{rows:Array<Record<string,unknown>>}):TokenSummary[]{return result.rows.map(row=>({id:String(row.id),kind:row.token_kind as "personal"|"service_account",name:String(row.name),prefix:String(row.token_prefix),scopes:row.scopes as Permission[],organisationId:String(row.organisation_id),workspaceIds:row.workspace_restrictions as string[],environmentIds:row.environment_restrictions as string[],createdAt:(row.created_at as Date).toISOString(),expiresAt:(row.expires_at as Date).toISOString(),lastUsedAt:row.last_used_at?(row.last_used_at as Date).toISOString():null,revokedAt:row.revoked_at?(row.revoked_at as Date).toISOString():null}));}
async function audit(client:PoolClient,actor:AuthenticatedSession,workspaceId:string|undefined,action:string,resourceType:string,resourceId:string,after:unknown,correlationId:string):Promise<void>{if(!workspaceId)return;await client.query(`INSERT INTO audit_events(id,occurred_at,actor_account_id,workspace_id,action,resource_type,resource_id,after_summary,correlation_id) VALUES($1,now(),$2,$3,$4,$5,$6,$7,$8)`,[randomUUID(),actor.accountId,workspaceId,action,resourceType,resourceId,after,correlationId]);}

interface TokenLookupRow { id:string;token_kind:"personal"|"service_account";token_hash:Buffer;owner_account_id:string|null;service_account_id:string|null;organisation_id:string;scopes:Permission[];workspace_restrictions:string[];environment_restrictions:string[];created_at:Date;expires_at:Date;revoked_at:Date|null;principal_account_id:string;primary_email:string;service_status:string|null;assertion_key_revoked_at:Date|null;principal_permissions:Permission[] }
interface ServiceAccountRow { id:string;organisation_id:string;workspace_id:string|null;name:string;description:string;owner_account_ids:string[];role_id:string;environment_ids:string[];expiry_policy_days:number;status:"active"|"suspended"|"revoked";created_at:Date;last_used_at:Date|null }
function serviceAccountFromRow(row:ServiceAccountRow):ServiceAccountRecord{return{id:row.id,organisationId:row.organisation_id,workspaceId:row.workspace_id,name:row.name,description:row.description,ownerAccountIds:row.owner_account_ids,roleId:row.role_id,environmentIds:row.environment_ids,expiryPolicyDays:row.expiry_policy_days,status:row.status,createdAt:row.created_at.toISOString(),lastUsedAt:row.last_used_at?.toISOString()??null};}
