import { create } from "zustand";
import { api } from "./api";
import type { ExecutionRecord, Workflow, WorkflowSummary } from "./types";

export type View =
  "workflows" | "history" | "editor" | "settings" | "approvals" | "plugins" | "cloud";
interface AppStore {
  view: View;
  workflows: WorkflowSummary[];
  executions: ExecutionRecord[];
  activeWorkflow?: Workflow;
  selectedExecution?: ExecutionRecord;
  loading: boolean;
  error?: string;
  setView: (view: View) => void;
  load: () => Promise<void>;
  openWorkflow: (id: string) => Promise<void>;
  createWorkflow: (template?: string, name?: string) => Promise<void>;
  saveWorkflow: (workflow: Workflow) => Promise<Workflow>;
  deleteWorkflow: (id: string) => Promise<void>;
  loadExecutions: (workflowId?: string) => Promise<void>;
  selectExecution: (run?: ExecutionRecord) => void;
}
export const useAppStore = create<AppStore>((set, get) => ({
  view: "workflows",
  workflows: [],
  executions: [],
  loading: true,
  setView: (view) =>
    set({
      view,
      activeWorkflow: view === "editor" ? get().activeWorkflow : undefined,
    }),
  load: async () => {
    set({ loading: true, error: undefined });
    try {
      const workflows = await api.listWorkflows();
      set({ workflows, loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },
  openWorkflow: async (id) => {
    set({ loading: true });
    try {
      const activeWorkflow = await api.getWorkflow(id);
      if (!activeWorkflow) throw new Error("Workflow no longer exists.");
      set({ activeWorkflow, view: "editor", loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },
  createWorkflow: async (template, name) => {
    try {
      const activeWorkflow = await api.createWorkflow(template, name);
      await get().load();
      set({ activeWorkflow, view: "editor" });
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },
  saveWorkflow: async (workflow) => {
    const saved = await api.saveWorkflow(workflow);
    set({ activeWorkflow: saved });
    await get().load();
    return saved;
  },
  deleteWorkflow: async (id) => {
    await api.deleteWorkflow(id);
    await get().load();
  },
  loadExecutions: async (workflowId) => {
    try {
      const executions = await api.listExecutions(workflowId);
      set({ executions });
    } catch (error) {
      set({ error: String(error) });
    }
  },
  selectExecution: (selectedExecution) => set({ selectedExecution }),
}));
