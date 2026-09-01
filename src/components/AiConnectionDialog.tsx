import { ArrowLeft, Check, ChevronDown, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SiClaude, SiOllama, SiOpenai } from "react-icons/si";
import { api } from "../api";
import type { ConnectionMetadata } from "../types";
import { Dialog } from "./ui/Dialog";

export type AiProvider = "openai" | "anthropic" | "openai_compatible";

interface ModelChoice {
  id: string;
  name: string;
  usage: 1 | 2 | 3 | 4 | 5;
  note: string;
}

const providers: Record<AiProvider, {
  name: string;
  company: string;
  description: string;
  baseUrl: string;
  icon: typeof SiOpenai;
  models: ModelChoice[];
}> = {
  openai: {
    name: "ChatGPT",
    company: "OpenAI",
    description: "GPT models for fast drafting and complex reasoning.",
    baseUrl: "",
    icon: SiOpenai,
    models: [
      { id: "gpt-5-mini", name: "GPT-5 mini", usage: 2, note: "Fast and efficient" },
      { id: "gpt-5", name: "GPT-5", usage: 4, note: "Advanced reasoning" },
      { id: "gpt-4.1", name: "GPT-4.1", usage: 3, note: "Strong instruction following" },
    ],
  },
  anthropic: {
    name: "Claude",
    company: "Anthropic",
    description: "Claude models for careful reasoning and long context.",
    baseUrl: "",
    icon: SiClaude,
    models: [
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", usage: 2, note: "Fastest responses" },
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", usage: 4, note: "Balanced intelligence" },
      { id: "claude-opus-4-1", name: "Claude Opus 4.1", usage: 5, note: "Deepest reasoning" },
    ],
  },
  openai_compatible: {
    name: "Local / custom",
    company: "OpenAI-compatible",
    description: "Ollama or another compatible endpoint you control.",
    baseUrl: "http://localhost:11434/v1",
    icon: SiOllama,
    models: [
      { id: "llama3.2", name: "Llama 3.2", usage: 2, note: "Common local default" },
      { id: "qwen2.5-coder", name: "Qwen 2.5 Coder", usage: 3, note: "Code-focused" },
    ],
  },
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
  const [step, setStep] = useState<"provider" | "details">("provider");
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [name, setName] = useState(providers.openai.name);
  const [model, setModel] = useState(providers.openai.models[0].id);
  const [customModel, setCustomModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const modelMenu = useRef<HTMLDivElement>(null);
  const selectedProvider = providers[provider];
  const SelectedProviderIcon = selectedProvider.icon;
  const selectedModel = selectedProvider.models.find((item) => item.id === model);
  const resolvedModel = model === "custom" ? customModel.trim() : model;

  useEffect(() => {
    if (!open) {
      setApiKey("");
      setError(undefined);
      setModelOpen(false);
      setStep("provider");
    }
  }, [open]);

  useEffect(() => {
    if (!modelOpen) return;
    const close = (event: PointerEvent) => {
      if (!modelMenu.current?.contains(event.target as globalThis.Node)) setModelOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [modelOpen]);

  const chooseProvider = (next: AiProvider) => {
    const choice = providers[next];
    setProvider(next);
    setName(choice.name);
    setModel(choice.models[0]?.id ?? "custom");
    setCustomModel("");
    setBaseUrl(choice.baseUrl);
    setError(undefined);
    setStep("details");
  };
  const valid =
    name.trim() &&
    resolvedModel &&
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
          model: resolvedModel,
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

  const footer = step === "details" ? (
    <>
      <button className="button" onClick={() => setStep("provider")} disabled={busy}>
        <ArrowLeft size={14} /> Back
      </button>
      <button className="button primary" onClick={() => void connect()} disabled={!valid || busy}>
        {busy ? "Connecting…" : `Connect ${selectedProvider.name}`}
      </button>
    </>
  ) : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={step === "provider" ? "Choose your AI" : `Connect ${selectedProvider.name}`}
      description={step === "provider" ? "Pick the model provider you want to use in workflow chat and AI nodes." : selectedProvider.description}
      footer={footer}
      width="large"
    >
      {step === "provider" ? (
        <div className="ai-provider-picker">
          {(Object.entries(providers) as Array<[AiProvider, typeof providers[AiProvider]]>).map(([id, item]) => {
            const Icon = item.icon;
            return (
              <button key={id} type="button" className={`ai-provider-card ai-provider-${id}`} onClick={() => chooseProvider(id)}>
                <span className="ai-provider-logo"><Icon aria-hidden="true" /></span>
                <span><b>{item.name}</b><small>{item.company}</small></span>
                <p>{item.description}</p>
                <span className="ai-provider-choose">Choose <span aria-hidden="true">→</span></span>
              </button>
            );
          })}
          <div className="ai-provider-security">
            <ShieldCheck size={15} />
            <span><b>Your key stays yours.</b> Credentials are stored write-only in your operating-system vault.</span>
          </div>
        </div>
      ) : (
        <div className="ai-connect-details">
          <div className="ai-selected-provider">
            <span className={`ai-provider-logo ai-provider-${provider}`}><SelectedProviderIcon aria-hidden="true" /></span>
            <span><b>{selectedProvider.name}</b><small>{selectedProvider.company}</small></span>
            <button type="button" onClick={() => setStep("provider")}>Change</button>
          </div>

          <div className="ai-connect-grid">
            <label className="field">
              <span>Connection name</span>
              <input aria-label="Connection name" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="field ai-model-field">
              <span>Model <small>Dots show relative token usage</small></span>
              <div className="ai-model-select" ref={modelMenu}>
                <button type="button" aria-haspopup="listbox" aria-expanded={modelOpen} onClick={() => setModelOpen((value) => !value)}>
                  <span>{selectedModel?.name ?? (customModel || "Custom model")}</span>
                  <UsageDots count={selectedModel?.usage ?? 3} />
                  <ChevronDown size={14} />
                </button>
                {modelOpen && (
                  <div className="ai-model-menu" role="listbox" aria-label="AI model">
                    {selectedProvider.models.map((item) => (
                      <button key={item.id} type="button" role="option" aria-selected={model === item.id} onClick={() => { setModel(item.id); setModelOpen(false); }}>
                        <span><b>{item.name}</b><small>{item.note}</small></span>
                        <UsageDots count={item.usage} />
                        {model === item.id && <Check size={14} />}
                      </button>
                    ))}
                    <button type="button" role="option" aria-selected={model === "custom"} onClick={() => { setModel("custom"); setModelOpen(false); }}>
                      <span><b>Custom model ID</b><small>Use any model available to your account</small></span>
                      <Sparkles size={14} />
                      {model === "custom" && <Check size={14} />}
                    </button>
                  </div>
                )}
              </div>
            </div>
            {model === "custom" && (
              <label className="field ai-connect-wide">
                <span>Custom model ID</span>
                <input autoFocus aria-label="Custom model ID" value={customModel} placeholder="Enter the exact provider model ID" onChange={(event) => setCustomModel(event.target.value)} />
              </label>
            )}
            {provider === "openai_compatible" && (
              <label className="field ai-connect-wide">
                <span>Base URL</span>
                <input aria-label="Base URL" value={baseUrl} placeholder="http://localhost:11434/v1" onChange={(event) => setBaseUrl(event.target.value)} />
                {baseUrl && !validBaseUrl(baseUrl) && <small className="field-error">Use HTTPS, or HTTP for localhost.</small>}
              </label>
            )}
            <label className="field ai-connect-wide">
              <span>API key <small>Encrypted by your operating system</small></span>
              <input aria-label="API key" type="password" autoComplete="off" value={apiKey} placeholder={provider === "openai_compatible" ? "Enter a key, or any value if your local server ignores it" : "Paste your provider API key"} onChange={(event) => setApiKey(event.target.value)} />
            </label>
          </div>
          {error && <div className="error-banner">{error}</div>}
          <div className="security-note">
            <ShieldCheck size={14} />
            <span>This connection can power workflow chat and AI nodes. Requests run only when you start a draft or workflow.</span>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function UsageDots({ count }: { count: number }) {
  const label = useMemo(() => `${count} of 5 relative token usage`, [count]);
  return (
    <span className="token-usage-dots" aria-label={label} title={label}>
      {[1, 2, 3, 4, 5].map((dot) => <i key={dot} className={dot <= count ? "filled" : ""} />)}
    </span>
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
