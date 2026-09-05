"use client";

import type { AccountOrganisation } from "@sandbox/api-client";
import { Check, Copy, Server, Terminal, X } from "lucide-react";
import { useActionState, useState } from "react";
import { issueRunnerPairingTokenAction, type RunnerPairingActionState } from "./actions";

const initialState: RunnerPairingActionState = { token: null, prefix: null, error: null };

export function RunnerPairing({
  organisations,
  selectedWorkspaceId,
}: {
  organisations: AccountOrganisation[];
  selectedWorkspaceId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"token" | "command" | null>(null);
  const [state, action, pending] = useActionState(issueRunnerPairingTokenAction, initialState);
  const workspaces = organisations.flatMap((organisation) =>
    organisation.workspaces.map((workspace) => ({ organisation, workspace })),
  );
  const selected = workspaces.find(({ workspace }) => workspace.id === selectedWorkspaceId) ?? workspaces[0];
  const command = "sudo -u sandbox-runner /usr/local/bin/sandbox-runner pair";

  if (!open && !state.token) {
    return <button className="portal-primary" type="button" disabled={!workspaces.length} onClick={() => setOpen(true)}><Server /> Add Linux runner</button>;
  }

  return (
    <section className="runner-pairing-card">
      <header>
        <div><span className="settings-card-icon"><Terminal /></span><span><strong>Pair a self-hosted machine</strong></span></div>
        {!state.token && <button type="button" aria-label="Close runner setup" onClick={() => setOpen(false)}><X /></button>}
      </header>
      {state.token ? (
        <div className="runner-token-result">
          <span className="pairing-success"><Check /> Pairing token ready</span>
          <h3>Run this once on your Linux host.</h3>
          <p>First download the Linux runner archive, run <code>sudo ./install.sh</code>, and complete <code>sudo sandbox-runner setup</code>. The token expires within 24 hours and is restricted to runner management in the selected workspace. <a href="https://docs.sndbox.app/linux" target="_blank" rel="noreferrer">Linux guide</a></p>
          <div className="command-copy"><code>{state.token}</code><button type="button" onClick={async () => { await navigator.clipboard.writeText(state.token ?? ""); setCopied("token"); }}><Copy /> {copied === "token" ? "Copied" : "Copy token"}</button></div>
          <h3>Then run this and paste the token into the hidden prompt.</h3>
          <div className="command-copy"><code>{command}</code><button type="button" onClick={async () => { await navigator.clipboard.writeText(command); setCopied("command"); }}><Copy /> {copied === "command" ? "Copied" : "Copy command"}</button></div>
          <aside><strong>Next</strong><span>Confirm the printed fingerprint out of band, then start the service. The runner will appear in the fleet below after its first heartbeat.</span></aside>
        </div>
      ) : (
        <form action={action} className="runner-pairing-form">
          <label><span>Runner name</span><input name="runnerName" required minLength={2} maxLength={100} placeholder="Production runner 01" /></label>
          <label><span>Workspace</span><select name="target" required defaultValue={selected ? `${selected.organisation.id}:${selected.workspace.id}` : ""}>{workspaces.map(({ organisation, workspace }) => <option key={workspace.id} value={`${organisation.id}:${workspace.id}`}>{organisation.name} / {workspace.name}</option>)}</select></label>
          <div className="pairing-notes"><span><Check /> One workspace only</span><span><Check /> Runner management scope</span><span><Check /> 24-hour expiry</span></div>
          {state.error && <p className="form-error" role="alert">{state.error}</p>}
          <button className="portal-primary" disabled={pending}>{pending ? "Creating token…" : "Create pairing token"}</button>
        </form>
      )}
    </section>
  );
}
