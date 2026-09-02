"use client";

import type { AccountOrganisation } from "@sandbox/api-client";
import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { useActionState, useState } from "react";
import {
  issuePersonalTokenAction,
  type PersonalTokenActionState,
} from "./actions";

const initialState: PersonalTokenActionState = { token: null, prefix: null, error: null };

export function PersonalTokenIssuer({ organisations }: { organisations: AccountOrganisation[] }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [state, action, pending] = useActionState(issuePersonalTokenAction, initialState);
  const workspaces = organisations.flatMap((organisation) =>
    organisation.workspaces.map((workspace) => ({ organisation, workspace })),
  );

  if (!open && !state.token) {
    return (
      <button className="portal-primary" type="button" onClick={() => setOpen(true)} disabled={!workspaces.length}>
        <Plus aria-hidden="true" /> New API key
      </button>
    );
  }

  return (
    <section className="token-issuer" aria-label="Create personal API key">
      <header>
        <span><KeyRound aria-hidden="true" /><span><strong>Create an API key</strong><small>Keys are shown once and expire automatically.</small></span></span>
        {!state.token && <button type="button" onClick={() => setOpen(false)}>Cancel</button>}
      </header>
      {state.token ? (
        <div className="one-time-token">
          <span><Check aria-hidden="true" /><strong>API key created</strong></span>
          <p>Copy it now. For your security, this value will not be shown again.</p>
          <div><code>{state.token}</code><button type="button" onClick={async () => { await navigator.clipboard.writeText(state.token!); setCopied(true); }}><Copy aria-hidden="true" /> {copied ? "Copied" : "Copy"}</button></div>
        </div>
      ) : (
        <form action={action} className="token-form">
          <label><span>Key name</span><input name="name" required maxLength={120} placeholder="Deploy from laptop" /></label>
          <label><span>Workspace</span><select name="target" required defaultValue=""><option value="" disabled>Choose a workspace</option>{workspaces.map(({ organisation, workspace }) => <option key={workspace.id} value={`${organisation.id}:${workspace.id}`}>{organisation.name} / {workspace.name}</option>)}</select></label>
          <fieldset><legend>Permissions</legend>
            <label><input type="checkbox" name="scope" value="workflows.view" defaultChecked /><span><strong>View workflows</strong><small>Read workflow metadata and status.</small></span></label>
            <label><input type="checkbox" name="scope" value="workflows.run" /><span><strong>Run workflows</strong><small>Start runs in the selected workspace.</small></span></label>
            <label><input type="checkbox" name="scope" value="executions.view_summary" /><span><strong>View run summaries</strong><small>Inspect outcomes without detailed payloads.</small></span></label>
          </fieldset>
          <label><span>Expires</span><select name="expiresInDays" defaultValue="30"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select></label>
          {state.error && <p className="form-error" role="alert">{state.error}</p>}
          <button className="portal-primary" disabled={pending}>{pending ? "Creating…" : "Create API key"}</button>
        </form>
      )}
    </section>
  );
}
