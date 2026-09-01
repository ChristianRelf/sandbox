import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { CodeEditorDialog } from "./CodeEditorDialog";

describe("CodeEditorDialog AI chat", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(api, "listConnections").mockResolvedValue([
      {
        id: "ai-1",
        provider: "openai",
        displayName: "OpenAI",
        scopes: [],
        createdAt: "2026-09-01T00:00:00Z",
        status: "connected",
        metadata: { model: "test-model" },
      },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens a right-side chat, reports activity, and keeps generated code unsaved", async () => {
    let finish: ((value: { code: string; model: string; usage: Record<string, unknown> }) => void) | undefined;
    vi.spyOn(api, "generateCodeWithAi").mockImplementation(() => new Promise((resolve) => {
      finish = resolve;
    }));
    const onSave = vi.fn();

    render(
      <CodeEditorDialog
        open
        language="javascript"
        value="const ready = false;"
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Code with AI" }));
    expect(screen.getByRole("complementary", { name: "AI coding assistant" })).toBeInTheDocument();

    const composer = await screen.findByRole("textbox", { name: "Message AI coding assistant" });
    fireEvent.change(composer, { target: { value: "Make it ready" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(screen.getByText("Planning Draft")).toBeInTheDocument();
    expect(screen.getByText("Investigating current code")).toBeInTheDocument();
    expect(screen.getByText("Writing Code")).toBeInTheDocument();
    expect(api.generateCodeWithAi).toHaveBeenCalledWith(
      "ai-1",
      "javascript",
      "Make it ready",
      "const ready = false;",
    );

    finish?.({ code: "const ready = true;", model: "test-model", usage: {} });
    await waitFor(() => expect(document.querySelector(".code-editor-textarea")).toHaveValue("const ready = true;"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Review the changes in the editor/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    expect(onSave).toHaveBeenCalledWith("javascript", "const ready = true;");
  });
});
