"use client";

import { AlertTriangle } from "lucide-react";
import { useActionState, useState } from "react";
import { deleteAccountAction, type AccountDeletionState } from "./actions";

const initialState: AccountDeletionState = { error: null };

export function AccountDangerZone() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(deleteAccountAction, initialState);

  return (
    <section className="settings-card danger-zone">
      <span className="settings-card-icon"><AlertTriangle aria-hidden="true" /></span>
      <div>
        <strong>Delete account</strong>
        <p>Permanently remove your personal account and revoke its sessions. Workspace records required for security and audit may follow their published retention period.</p>
        {!open ? (
          <button className="danger-button" type="button" onClick={() => setOpen(true)}>Delete account…</button>
        ) : (
          <form action={action}>
            <label>Type <strong>DELETE</strong> to confirm<input name="confirmation" autoFocus autoComplete="off" /></label>
            {state.error && <p className="form-error" role="alert">{state.error}</p>}
            <div><button type="button" onClick={() => setOpen(false)}>Cancel</button><button className="danger-button" disabled={pending}>{pending ? "Deleting…" : "Permanently delete"}</button></div>
          </form>
        )}
      </div>
    </section>
  );
}
