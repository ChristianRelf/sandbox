import { listen } from "@tauri-apps/api/event";
import {
  Cable,
  CheckCircle2,
  ExternalLink,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import type { ConnectionMetadata } from "../types";
import { ConfirmDialog, Dialog, FocusDialog } from "./ui/Dialog";

type Provider = "gmail" | "discord" | "slack";

export function ConnectionsSettings() {
  const [connections, setConnections] = useState<ConnectionMetadata[]>([]);
  const [adding, setAdding] = useState<Provider>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "error" | "success";
    text: string;
  }>();
  const [renaming, setRenaming] = useState<ConnectionMetadata>();
  const [renameName, setRenameName] = useState("");
  const [revoking, setRevoking] = useState<{
    connection: ConnectionMetadata;
    workflows: string[];
  }>();
  const load = () =>
    api
      .listConnections()
      .then(setConnections)
      .catch((value) => setNotice({ kind: "error", text: String(value) }));
  useEffect(() => {
    void load();
    if (!api.isDesktop) return;
    const stops: Array<() => void> = [];
    void listen<ConnectionMetadata>("connection-updated", (event) => {
      setNotice({
        kind: "success",
        text: `${event.payload.displayName} connected securely.`,
      });
      void load();
    }).then((stop) => stops.push(stop));
    void listen<string>("connection-error", (event) =>
      setNotice({ kind: "error", text: event.payload }),
    ).then((stop) => stops.push(stop));
    return () => stops.forEach((stop) => stop());
  }, []);

  const connectGmail = async () => {
    setBusy(true);
    setNotice(undefined);
    try {
      await api.startGmailOAuth();
      setNotice({
        kind: "success",
        text: "Gmail authorization opened in your default browser. This screen updates after the callback is verified.",
      });
    } catch (value) {
      setNotice({ kind: "error", text: String(value) });
    } finally {
      setBusy(false);
    }
  };
  const act = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
      await load();
      if (success) setNotice({ kind: "success", text: success });
    } catch (value) {
      setNotice({ kind: "error", text: String(value) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section">
      <div className="settings-heading">
        <div>
          <h2>Connections</h2>
          <p>
            Account metadata is stored in SQLite. Tokens and webhook URLs stay
            in your operating-system credential store.
          </p>
        </div>
        <div className="connection-add-actions">
          <button className="button" onClick={connectGmail} disabled={busy}>
            <Mail size={13} />
            Connect Gmail
          </button>
          <button
            className="button primary"
            onClick={() => setAdding("discord")}
          >
            <Plus size={13} />
            Add webhook
          </button>
        </div>
      </div>
      {notice && (
        <div
          className={`${notice.kind === "error" ? "error-banner" : "success-banner"}`}
        >
          {notice.kind === "success" && <CheckCircle2 size={13} />}
          <span>{notice.text}</span>
        </div>
      )}
      {connections.length ? (
        <div className="connection-list">
          {connections.map((connection) => (
            <div className="connection-row" key={connection.id}>
              <ProviderIcon provider={connection.provider} />
              <div className="connection-identity">
                <b>{connection.displayName}</b>
                <small>
                  {connection.accountIdentifier ??
                    providerName(connection.provider)}{" "}
                  ·{" "}
                  {connection.scopes.length
                    ? `${connection.scopes.length} granted scope${connection.scopes.length === 1 ? "" : "s"}`
                    : "Credential stored securely"}
                </small>
              </div>
              <span className={`connection-state ${connection.status}`}>
                <i />
                {connection.status.replace("_", " ")}
              </span>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  act(
                    () => api.testConnection(connection.id),
                    `${connection.displayName} is available in the OS credential store.`,
                  )
                }
              >
                <RefreshCcw size={12} />
                Test
              </button>
              <button
                className="icon-button"
                title="Rename"
                aria-label={`Rename ${connection.displayName}`}
                onClick={() => {
                  setRenaming(connection);
                  setRenameName(connection.displayName);
                }}
              >
                <MoreHorizontal size={14} />
              </button>
              <button
                className="icon-button danger-text"
                title="Revoke and delete secret"
                aria-label={`Revoke and delete ${connection.displayName}`}
                onClick={() =>
                  void api
                    .workflowsUsingConnection(connection.id)
                    .then((workflows) => setRevoking({ connection, workflows }))
                    .catch((value) =>
                      setNotice({ kind: "error", text: String(value) }),
                    )
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="connections-empty">
          <Cable size={20} />
          <div>
            <b>No connections</b>
            <span>
              Connect Gmail with PKCE or store an incoming webhook securely.
            </span>
          </div>
        </div>
      )}
      <div className="vault-assurance">
        <ShieldCheck size={14} />
        <span>
          Workflow JSON contains only a credential ID. Exported workflows
          replace it with an unresolved connection requirement.
        </span>
      </div>
      {adding && (
        <WebhookModal
          initialProvider={adding === "gmail" ? "discord" : adding}
          busy={busy}
          onClose={() => setAdding(undefined)}
          onSave={(provider, name, url) =>
            act(
              () => api.createConnection(provider, name, { webhookUrl: url }),
              `${name} was stored in the OS credential store.`,
            ).then(() => setAdding(undefined))
          }
        />
      )}
      <Dialog
        open={Boolean(renaming)}
        onOpenChange={(open) => !open && setRenaming(undefined)}
        title="Rename connection"
        description="Only the display label changes. The credential remains write-only in the operating-system vault."
        footer={
          <>
            <button className="button" onClick={() => setRenaming(undefined)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={!renameName.trim() || busy}
              onClick={() => {
                if (renaming)
                  void act(
                    () => api.renameConnection(renaming.id, renameName.trim()),
                    "Connection renamed.",
                  ).then(() => setRenaming(undefined));
              }}
            >
              Rename
            </button>
          </>
        }
      >
        <label className="field">
          <span>Display name</span>
          <input
            autoFocus
            value={renameName}
            onChange={(event) => setRenameName(event.target.value)}
          />
        </label>
      </Dialog>
      <ConfirmDialog
        open={Boolean(revoking)}
        onOpenChange={(open) => !open && setRevoking(undefined)}
        title="Revoke connection?"
        description="The credential will be deleted from the operating-system vault. Affected workflows will require reconnection."
        confirmLabel="Revoke connection"
        dangerous
        busy={busy}
        onConfirm={() => {
          if (revoking)
            void act(
              () => api.revokeConnection(revoking.connection.id),
              `${revoking.connection.displayName} was revoked.`,
            ).then(() => setRevoking(undefined));
        }}
      >
        {revoking && (
          <div className="affected-workflows">
            <b>
              {revoking.workflows.length} affected workflow
              {revoking.workflows.length === 1 ? "" : "s"}
            </b>
            {revoking.workflows.length ? (
              <ul>
                {revoking.workflows.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            ) : (
              <p>No workflow currently references this connection.</p>
            )}
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
}

function WebhookModal({
  initialProvider,
  busy,
  onClose,
  onSave,
}: {
  initialProvider: "discord" | "slack";
  busy: boolean;
  onClose: () => void;
  onSave: (provider: "discord" | "slack", name: string, url: string) => void;
}) {
  const [provider, setProvider] = useState(initialProvider);
  const [name, setName] = useState(
    initialProvider === "discord" ? "Discord alerts" : "Slack alerts",
  );
  const [url, setUrl] = useState("");
  const valid = validWebhook(provider, url);
  return (
    <FocusDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Add incoming webhook"
      description="The complete URL is written directly to the operating-system credential store."
    >
      <div className="settings-modal connection-modal">
        <header>
          <div>
            <h2>Add incoming webhook</h2>
            <p>
              The complete URL is written directly to the operating-system
              credential store.
            </p>
          </div>
        </header>
        <section>
          <Field label="Provider">
            <select
              value={provider}
              onChange={(event) => {
                const next = event.target.value as "discord" | "slack";
                setProvider(next);
                setName(next === "discord" ? "Discord alerts" : "Slack alerts");
              }}
            >
              <option value="discord">Discord</option>
              <option value="slack">Slack</option>
            </select>
          </Field>
          <Field label="Display name">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Webhook URL">
            <input
              type="password"
              autoComplete="off"
              placeholder={
                provider === "discord"
                  ? "https://discord.com/api/webhooks/…"
                  : "https://hooks.slack.com/services/…"
              }
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </Field>
          {url && !valid && (
            <div className="field-error">
              Enter an HTTPS {providerName(provider)} incoming webhook URL from
              the expected provider domain.
            </div>
          )}
          <div className="security-note">
            <ShieldCheck size={14} />
            <span>
              This value cannot be inspected after saving. Reconnection replaces
              it.
            </span>
          </div>
        </section>
        <footer>
          <span />
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !name.trim() || !valid}
            onClick={() => onSave(provider, name, url)}
          >
            {busy ? "Saving…" : "Store securely"}
          </button>
        </footer>
      </div>
    </FocusDialog>
  );
}

function ProviderIcon({ provider }: { provider: string }) {
  return (
    <span className="connection-provider">
      {provider === "gmail" ? (
        <Mail size={15} />
      ) : provider === "discord" ? (
        <MessageSquare size={15} />
      ) : (
        <ExternalLink size={15} />
      )}
    </span>
  );
}
function providerName(provider: string) {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
function validWebhook(provider: "discord" | "slack", value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (provider === "discord"
        ? ["discord.com", "discordapp.com"].includes(url.hostname) &&
          url.pathname.startsWith("/api/webhooks/")
        : url.hostname === "hooks.slack.com" &&
          url.pathname.startsWith("/services/"))
    );
  } catch {
    return false;
  }
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
