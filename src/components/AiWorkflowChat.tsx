import { listen } from "@tauri-apps/api/event";
import { Bot, Check, Plus, Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AiWorkflowActivity, AiWorkflowProposal, ConnectionMetadata, Workflow } from "../types";
import { AiActivityStatus } from "./AiActivityStatus";
import { AiConnectionDialog } from "./AiConnectionDialog";
import { CustomSelect } from "./ui/CustomSelect";

const AI_PROVIDERS = new Set(["openai", "anthropic", "openai_compatible"]);
interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  proposal?: AiWorkflowProposal;
}

export interface AiWorkflowChatContext {
  key: string;
  label: string;
  prompt: string;
}

export function AiWorkflowChat({
  id,
  open,
  workflow,
  context,
  onOpenChange,
  onApply,
}: {
  id?: string;
  open: boolean;
  workflow: Workflow;
  context?: AiWorkflowChatContext;
  onOpenChange: (open: boolean) => void;
  onApply: (workflow: Workflow, message: string) => void;
}) {
  const [connections, setConnections] = useState<ConnectionMetadata[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [connectOpen, setConnectOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [activities, setActivities] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "hello",
      role: "assistant",
      text: "Tell me what you want this workflow to do. I’ll draft the graph, then you can review it before applying anything.",
    },
  ]);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const loadConnections = () =>
    api.listConnections().then((items) => {
      const ai = items.filter((item) => AI_PROVIDERS.has(item.provider) && item.status === "connected");
      setConnections(ai);
      setConnectionId((current) => ai.some((item) => item.id === current) ? current : (ai[0]?.id ?? ""));
    });
  useEffect(() => {
    if (open) void loadConnections();
  }, [open]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);
  useEffect(() => {
    if (!open || !context) return;
    setDraft(context.prompt);
    const frame = window.requestAnimationFrame(() => composerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, context]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !connectionId || busy) return;
    setDraft("");
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text }]);
    setBusy(true);
    setActivities(["Preparing the workflow and request context"]);
    const requestId = crypto.randomUUID();
    let stopListening: (() => void) | undefined;
    try {
      stopListening = await listen<AiWorkflowActivity>("ai-workflow-activity", (event) => {
        if (event.payload.requestId !== requestId) return;
        setActivities((current) => {
          const next = event.payload.message;
          return current.at(-1) === next ? current : [...current, next];
        });
      });
      const proposal = await api.buildWorkflowWithAi(connectionId, text, workflow, requestId);
      setActivities((current) => [...current, "Re-checking the returned draft in the editor"]);
      const issues = await api.validateWorkflow(proposal.workflow);
      if (issues.length) {
        throw new Error(`The returned workflow failed the editor's validation: ${issues[0].message}`);
      }
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text: proposal.message, proposal: { ...proposal, issues } },
      ]);
    } catch (value) {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text: `I couldn’t create that draft. ${String(value)}` },
      ]);
    } finally {
      stopListening?.();
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <aside id={id} className="ai-chat-panel" aria-label="AI workflow builder">
      <header>
        <div className="ai-chat-title">
          <span><Sparkles size={15} /></span>
          <div><b>AI builder</b><small>Draft with your model</small></div>
        </div>
        <button className="icon-button" onClick={() => onOpenChange(false)} aria-label="Close AI builder">
          <X size={15} />
        </button>
      </header>
      {connections.length ? (
        <div className="ai-provider-bar">
          <label>
            <Bot size={13} />
            <CustomSelect aria-label="AI connection" value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.displayName} · {String(connection.metadata.model ?? "model")}
                </option>
              ))}
            </CustomSelect>
          </label>
          <button className="icon-button" onClick={() => setConnectOpen(true)} aria-label="Connect another AI">
            <Plus size={14} />
          </button>
        </div>
      ) : (
        <div className="ai-empty">
          <span className="ai-empty-mark"><Sparkles size={20} /></span>
          <h3>Bring your own AI</h3>
          <p>Connect a model to describe workflows in plain language and refine them in chat.</p>
          <button className="button primary" onClick={() => setConnectOpen(true)}>
            <Plus size={13} /> Connect your AI
          </button>
          <small>Keys stay in the OS credential vault.</small>
        </div>
      )}
      {connections.length > 0 && (
        <>
          <div className="ai-chat-messages" aria-live="polite">
            {messages.map((message) => (
              <div className={`ai-message ai-message-${message.role}`} key={message.id}>
                {message.role === "assistant" && <span className="ai-avatar"><Sparkles size={12} /></span>}
                <div>
                  <p>{message.text}</p>
                  {message.proposal && (
                    <div className="ai-proposal">
                      <div>
                        <b>{message.proposal.workflow.name}</b>
                        <small>
                          {message.proposal.workflow.nodes.length} nodes · {message.proposal.workflow.edges.length} connections
                        </small>
                      </div>
                      <span className="ai-proposal-verified">
                        <ShieldCheck size={12} /> Tested · no validation errors
                        {message.proposal.validationAttempts > 1 ? ` · repaired in ${message.proposal.validationAttempts} passes` : ""}
                      </span>
                      <button
                        className="button primary"
                        onClick={() => {
                          onApply(message.proposal!.workflow, message.text);
                          setMessages((current) => current.map((item) => item.id === message.id ? { ...item, proposal: undefined, text: `${item.text} Applied to the canvas.` } : item));
                        }}
                      >
                        <Check size={13} /> Apply tested workflow
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="ai-message ai-message-assistant">
                <span className="ai-avatar"><Sparkles size={12} /></span>
                <AiActivityStatus active activities={activities} />
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form className="ai-chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <textarea
              ref={composerRef}
              aria-label="Message AI builder"
              value={draft}
              placeholder="e.g. Every morning, check my site and alert me if it’s down"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div>
              <small>AI drafts never run automatically.</small>
              <button className="ai-send" disabled={!draft.trim() || busy} aria-label="Send message">
                <Send size={14} />
              </button>
            </div>
          </form>
        </>
      )}
      <AiConnectionDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={(connection) => {
          setConnections((current) => [...current, connection]);
          setConnectionId(connection.id);
        }}
      />
    </aside>
  );
}
