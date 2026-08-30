"use client";

import { useActionState } from "react";
import { issueScimTokenAction, type ScimTokenActionState } from "./actions";

const initialState: ScimTokenActionState = { token: null, prefix: null, error: null };

export function ScimTokenForm({ organisationId }: { organisationId: string }) {
  const [state, action, pending] = useActionState(issueScimTokenAction, initialState);
  return <div className="scim-issuer">
    <form action={action} className="portal-form scim-form">
      <input type="hidden" name="organisationId" value={organisationId}/>
      <label>Name<input name="name" required maxLength={120} placeholder="Identity provider"/></label>
      <label>Expires<select name="expiresInDays" defaultValue="90"><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option><option value="365">365 days</option></select></label>
      <button className="portal-primary" disabled={pending}>{pending ? "Issuing…" : "Issue credential"}</button>
    </form>
    {state.error&&<p className="credential-error" role="alert">{state.error}</p>}
    {state.token&&<div className="one-time-credential"><strong>Copy this credential now</strong><p>It cannot be shown again after you leave this page.</p><textarea readOnly value={state.token} aria-label={`One-time SCIM credential ${state.prefix}`}/></div>}
  </div>;
}
