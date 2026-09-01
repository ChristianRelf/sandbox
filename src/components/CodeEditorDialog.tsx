import { AlertCircle, Braces, Check, CheckCircle2, Code2, FileCode2, LoaderCircle, Palette, Sparkles, TriangleAlert, X } from "lucide-react";
import Prism from "prismjs";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-python";
import { useDeferredValue, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import Editor from "react-simple-code-editor";
import { api } from "../api";
import { diagnoseCode } from "../codeDiagnostics";
import type { ConnectionMetadata } from "../types";
import { Dialog } from "./ui/Dialog";

export type CodeLanguage = "python" | "html" | "javascript" | "css";

const languages: Array<{
  id: CodeLanguage;
  label: string;
  extension: string;
  icon: typeof Code2;
}> = [
  { id: "python", label: "Python", extension: ".py", icon: Code2 },
  { id: "html", label: "HTML", extension: ".html", icon: FileCode2 },
  { id: "javascript", label: "JavaScript", extension: ".js", icon: Braces },
  { id: "css", label: "CSS", extension: ".css", icon: Palette },
];

export function CodeEditorDialog({
  open,
  language,
  value,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  language: CodeLanguage;
  value: string;
  onOpenChange: (open: boolean) => void;
  onSave: (language: CodeLanguage, value: string) => void;
}) {
  const [draftLanguage, setDraftLanguage] = useState(language);
  const [draft, setDraft] = useState(value);
  const [connections, setConnections] = useState<ConnectionMetadata[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string>();
  useEffect(() => {
    if (!open) return;
    setDraftLanguage(language);
    setDraft(value);
    setAiError(undefined);
  }, [language, open, value]);
  useEffect(() => {
    if (!open) return;
    void api.listConnections().then((items) => {
      const ai = items.filter((item) => ["openai", "anthropic", "openai_compatible"].includes(item.provider) && item.status === "connected");
      setConnections(ai);
      setConnectionId((current) => ai.some((item) => item.id === current) ? current : (ai[0]?.id ?? ""));
    });
  }, [open]);
  const selected = languages.find((item) => item.id === draftLanguage)!;
  const deferredDraft = useDeferredValue(draft);
  const diagnostics = useMemo(
    () => diagnoseCode(draftLanguage, deferredDraft),
    [deferredDraft, draftLanguage],
  );
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;
  const grammar = useMemo(
    () => Prism.languages[draftLanguage === "html" ? "markup" : draftLanguage],
    [draftLanguage],
  );
  const save = () => {
    onSave(draftLanguage, draft);
    onOpenChange(false);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save();
    }
  };
  const writeWithAi = async () => {
    const instruction = aiPrompt.trim();
    if (!connectionId || !instruction || aiBusy) return;
    setAiBusy(true);
    setAiError(undefined);
    try {
      const result = await api.generateCodeWithAi(connectionId, draftLanguage, instruction, draft);
      setDraft(result.code);
      setAiPrompt("");
      setAiOpen(false);
    } catch (error) {
      setAiError(String(error));
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit code"
      description={`Editing main${selected.extension} · changes are applied only when you save.`}
      width="large"
      footer={
        <>
          <button className="button" type="button" onClick={() => onOpenChange(false)}>Cancel</button>
          <button
            className="button primary"
            type="button"
            onClick={save}
          >
            <Check size={14} /> Save code
          </button>
        </>
      }
    >
      <div className="code-editor-dialog">
        <div className="code-language-tabs" role="tablist" aria-label="Code language">
          {languages.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={draftLanguage === item.id}
                onClick={() => setDraftLanguage(item.id)}
              >
                <Icon size={14} /> {item.label}
              </button>
            );
          })}
          <button className="code-ai-button" type="button" onClick={() => setAiOpen((value) => !value)} aria-expanded={aiOpen}>
            <Sparkles size={13} /> Write with AI
          </button>
          <span className={diagnostics.length ? "code-check-has-problems" : "code-check-clean"}>
            {diagnostics.length ? <TriangleAlert size={12} /> : <CheckCircle2 size={12} />}
            {diagnostics.length ? `${diagnostics.length} problem${diagnostics.length === 1 ? "" : "s"}` : "Types look good"}
          </span>
        </div>
        {aiOpen && (
          <section className="code-ai-panel" aria-label="Write code with AI">
            <header>
              <span><Sparkles size={14} /><b>Write with AI</b><small>Uses the current file as context</small></span>
              <button className="icon-button" type="button" aria-label="Close AI code writer" onClick={() => setAiOpen(false)}><X size={14} /></button>
            </header>
            {connections.length ? (
              <div className="code-ai-form">
                <select aria-label="AI connection for code" value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
                  {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.displayName} · {String(connection.metadata.model ?? "model")}</option>)}
                </select>
                <textarea
                  autoFocus
                  rows={2}
                  aria-label="Describe the code to write"
                  value={aiPrompt}
                  placeholder={`Describe the ${selected.label} you want, or ask AI to change the current code…`}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                      event.preventDefault();
                      void writeWithAi();
                    }
                  }}
                />
                <button className="button primary" type="button" disabled={!aiPrompt.trim() || aiBusy} onClick={() => void writeWithAi()}>
                  {aiBusy ? <LoaderCircle className="spin" size={13} /> : <Sparkles size={13} />}
                  {aiBusy ? "Writing…" : "Generate & replace"}
                </button>
              </div>
            ) : (
              <p className="code-ai-empty">Connect ChatGPT, Claude, or a local AI in Settings → Connections to write this block.</p>
            )}
            {aiError && <div className="code-ai-error">{aiError}</div>}
            <small className="code-ai-note">AI output replaces the editor draft. It is checked immediately and saved only when you choose Save code.</small>
          </section>
        )}
        <div className="code-editor-scroll">
          <div className="code-line-numbers" aria-hidden="true">
            {draft.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}
          </div>
          <Editor
            value={draft}
            onValueChange={setDraft}
            highlight={(code) => Prism.highlight(code, grammar, draftLanguage)}
            padding={14}
            tabSize={2}
            insertSpaces
            textareaClassName="code-editor-textarea"
            preClassName="code-editor-highlight"
            onKeyDown={handleKeyDown}
            aria-label={`${selected.label} code editor`}
            style={{
              minHeight: "min(60vh, 620px)",
              fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
              fontSize: 12,
              lineHeight: 1.65,
              flex: 1,
            }}
          />
        </div>
        <section className="code-problems" aria-label="Code problems" aria-live="polite">
          <header>
            <span><AlertCircle size={13} /> Problems <b>{diagnostics.length}</b></span>
            <small>Live syntax and type checking · code is never executed</small>
          </header>
          <div className="code-problem-list">
            {diagnostics.length ? diagnostics.map((diagnostic, index) => (
              <div className={`code-problem code-problem-${diagnostic.severity}`} key={`${diagnostic.line}:${diagnostic.column}:${diagnostic.message}:${index}`}>
                <span>{diagnostic.severity === "error" ? <AlertCircle size={13} /> : <TriangleAlert size={13} />}</span>
                <p>{diagnostic.message}</p>
                <code>Ln {diagnostic.line}, Col {diagnostic.column}</code>
              </div>
            )) : (
              <div className="code-problems-empty"><CheckCircle2 size={14} /><span><b>No problems found</b><small>{draft.trim() ? "The live checker found no syntax or basic type errors." : "Start typing to check this file."}</small></span></div>
            )}
          </div>
          {errorCount > 0 && <p className="code-error-summary">Fix {errorCount} error{errorCount === 1 ? "" : "s"} before running this code node.</p>}
        </section>
      </div>
    </Dialog>
  );
}
