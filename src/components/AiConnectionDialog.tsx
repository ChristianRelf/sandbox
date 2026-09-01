import { Bot, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { ConnectionMetadata } from "../types";
import { Dialog } from "./ui/Dialog";

export type AiProvider = "openai" | "anthropic" | "openai_compatible";

const defaults: Record<AiProvider, { name: string; model: string; baseUrl: string }> = {
  openai: { name: "OpenAI", model: "gpt-5-mini", baseUrl: "" },
  anthropic: { name: "Anthropic", model: "", baseUrl: "" },
  openai_compatible: { name: "Local AI", model: "", baseUrl: "http://localhost:11434/v1" },
};

export function AiConnectionDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: (connection: ConnectionMetadata) => void;
}) {
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [name, setName] = useState(defaults.openai.name);
  const [model, setModel] = useState(defaults.openai.model);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) {
      setApiKey("");
      setError(undefined);
    }
  }, [open]);

  const changeProvider = (next: AiProvider) => {
    setProvider(next);
    setName(defaults[next].name);
    setModel(defaults[next].model);
    setBaseUrl(defaults[next].baseUrl);
    setError(undefined);
  };
  const valid =
    name.trim() &&
    model.trim() &&
    apiKey.trim() &&
    (provider !== "openai_compatible" || validBaseUrl(baseUrl));
  const connect = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const connection = await api.createConnection(
        provider,
        name.trim(),
        { apiKey: apiKey.trim() },
        undefined,
        [],
        {
          model: model.trim(),
          ...(provider === "openai_compatible" ? { baseUrl: baseUrl.trim() } : {}),
        },
      );
      onConnected(connection);
      onOpenChange(false);
    } catch (value) {
      setError(String(value));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Connect your AI"
      description="Use your own provider and model to draft workflows. The API key stays write-only in your operating-system credential store."
      footer={
        <>
          <button className="button" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </button>
          <button className="button primary" onClick={() => void connect()} disabled={!valid || busy}>
            {busy ? "Connecting…" : "Connect AI"}
          </button>
        </>
      }
    >
      <div className="ai-connect-intro">
        <span><Bot size={17} /></span>
        <div>
          <b>Your model, your key</b>
          <small>sndbox sends the current workflow and your chat request only when you ask for a draft.</small>
        </div>
      </div>
      <div className="ai-connect-grid">
        <label className="field">
          <span>Provider</span>
          <select aria-label="AI provider" value={provider} onChange={(event) => changeProvider(event.target.value as AiProvider)}>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="openai_compatible">OpenAI-compatible</option>
          </select>
        </label>
        <label className="field">
          <span>Connection name</span>
          <input aria-label="Connection name" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field ai-connect-wide">
          <span>Model</span>
          <input
            aria-label="Model ID"
            value={model}
            placeholder="Enter the model ID available to your account"
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
        {provider === "openai_compatible" && (
          <label className="field ai-connect-wide">
            <span>Base URL</span>
            <input
              aria-label="Base URL"
              value={baseUrl}
              placeholder="https://provider.example/v1"
              onChange={(event) => setBaseUrl(event.target.value)}
            />
            {baseUrl && !validBaseUrl(baseUrl) && (
              <small className="field-error">Use HTTPS, or HTTP for localhost.</small>
            )}
          </label>
        )}
        <label className="field ai-connect-wide">
          <span>API key</span>
          <input
            aria-label="API key"
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder={provider === "openai_compatible" ? "API key (use any value if your local server requires none)" : "Stored securely after connecting"}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className="security-note">
        <ShieldCheck size={14} />
        <span>The model can only propose graph JSON. You review and apply it; sndbox never auto-runs an AI draft.</span>
      </div>
    </Dialog>
  );
}

function validBaseUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname));
  } catch {
    return false;
  }
}
