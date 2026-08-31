import { listen } from "@tauri-apps/api/event";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Accessibility,
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Command,
  History,
  LayoutGrid,
  MoreHorizontal,
  Play,
  Save,
  ShieldCheck,
  TestTube2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { api } from "../api";
import {
  createNode,
  createPluginNode,
  definitionFor,
  enabledPluginNodes,
  isTrigger,
  type PluginNodeChoice,
} from "../catalogue";
import { usePreferences } from "../preferences";
import { useAppStore } from "../store";
import type {
  BrowserProfile,
  ExecutionRecord,
  InstalledPlugin,
  NodeStatus,
  NodeType,
  PermissionSummary,
  RecordedStep,
  ValidationIssue,
  Workflow,
  WorkflowRevisionSummary,
} from "../types";
import { BrowserRecorder } from "./BrowserRecorder";
import { AccessibleWorkflowEditor } from "./AccessibleWorkflowEditor";
import { CommandPalette } from "./CommandPalette";
import { ExecutionInspector } from "./ExecutionInspector";
import { NodeInspector } from "./NodeInspector";
import { WorkflowNodeCard, type WorkflowNodeData } from "./WorkflowNodeCard";
import { ConfirmDialog, Dialog, FocusDialog } from "./ui/Dialog";
import { useToast } from "./ui/Toast";
import { Tooltip } from "./ui/Tooltip";

const nodeTypes = { workflow: WorkflowNodeCard };
export function WorkflowEditor() {
  const toast = useToast();
  const { activeWorkflow, setView, saveWorkflow } = useAppStore();
  const [workflow, setWorkflow] = useState(() =>
    structuredClone(activeWorkflow!),
  );
  const [initialViewport] = useState(() => {
    try {
      return (
        JSON.parse(
          localStorage.getItem(
            `sandbox.workflow-viewport.v1.${activeWorkflow!.id}`,
          ) ?? "null",
        ) ?? { x: 80, y: 80, zoom: 0.9 }
      );
    } catch {
      return { x: 80, y: 80, zoom: 0.9 };
    }
  });
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(activeWorkflow),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [auxiliaryTab, setAuxiliaryTab] = useState<"accessible" | "inspector">(
    "inspector",
  );
  const [picker, setPicker] = useState<{
    open: boolean;
    sourceId?: string;
    position: { x: number; y: number };
  }>({ open: false, position: { x: 360, y: 220 } });
  const [instance, setInstance] =
    useState<ReactFlowInstance<Node<WorkflowNodeData>, Edge>>();
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [runningNode, setRunningNode] = useState<string>();
  const [run, setRun] = useState<ExecutionRecord>();
  const [bottomOpen, setBottomOpen] = useState(false);
  const [saveState, setSaveState] = useState<
    "saved" | "unsaved" | "saving" | "failed"
  >("saved");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [pendingDeleteNodeId, setPendingDeleteNodeId] = useState<string>();
  const [running, setRunning] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisions, setRevisions] = useState<WorkflowRevisionSummary[]>([]);
  const [pendingRevisionId, setPendingRevisionId] = useState<string>();
  const [pendingSideEffectTest, setPendingSideEffectTest] = useState(false);
  const [testingNode, setTestingNode] = useState(false);
  const [accessibleEditorOpen, setAccessibleEditorOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [browserProfiles, setBrowserProfiles] = useState<BrowserProfile[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>(
    [],
  );
  const past = useRef<Workflow[]>([]);
  const future = useRef<Workflow[]>([]);
  const validationRequest = useRef(0);
  const dirty = JSON.stringify(workflow) !== baseline;
  const selectedNode = workflow.nodes.find((n) => n.id === selectedNodeId);
  useEffect(() => {
    if (selectedNodeId) setAuxiliaryTab("inspector");
  }, [selectedNodeId]);
  const {
    accessibleEditorDefault,
    showMinimap,
    confirmBeforeLeaving,
    snapToGrid,
    gridSize,
    showCanvasHints,
    confirmNodeDeletion,
    editorInspectorWidth,
    update: updatePreferences,
  } = usePreferences();
  const resizeInspector = (event: ReactPointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = editorInspectorWidth;
    const move = (next: PointerEvent) =>
      updatePreferences({
        editorInspectorWidth: startWidth - (next.clientX - startX),
      });
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const commit = useCallback(
    (next: Workflow) => {
      past.current.push(structuredClone(workflow));
      if (past.current.length > 50) past.current.shift();
      future.current = [];
      setWorkflow(next);
    },
    [workflow],
  );
  const patchWorkflow = useCallback(
    (patch: Partial<Workflow>) => commit({ ...workflow, ...patch }),
    [workflow, commit],
  );
  const goBack = () =>
    dirty && confirmBeforeLeaving ? setLeaveOpen(true) : setView("workflows");
  useEffect(() => {
    if (accessibleEditorDefault) setAccessibleEditorOpen(true);
  }, [accessibleEditorDefault]);
  useEffect(() => {
    try {
      const key = "sandbox.editor.focus-node.v1";
      const target = JSON.parse(localStorage.getItem(key) ?? "null") as {
        workflowId?: string;
        nodeId?: string;
      } | null;
      if (target?.workflowId === workflow.id && target.nodeId) {
        setSelectedNodeId(target.nodeId);
        localStorage.removeItem(key);
      }
    } catch {
      /* ignore invalid local UI state */
    }
  }, [workflow.id]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  useEffect(() => {
    (window as Window & { __sandboxUnsaved?: boolean }).__sandboxUnsaved =
      dirty;
    return () => {
      (window as Window & { __sandboxUnsaved?: boolean }).__sandboxUnsaved =
        false;
    };
  }, [dirty]);
  useEffect(() => {
    const openPicker = () =>
      setPicker({ open: true, position: { x: 360, y: 220 } });
    window.addEventListener("sandbox:open-node-picker", openPicker);
    return () =>
      window.removeEventListener("sandbox:open-node-picker", openPicker);
  }, []);
  useEffect(() => {
    if (accessibleEditorOpen)
      requestAnimationFrame(() =>
        document.getElementById("accessible-workflow-editor")?.focus(),
      );
  }, [accessibleEditorOpen]);
  useEffect(() => {
    void api.listBrowserProfiles().then(setBrowserProfiles);
  }, []);
  useEffect(() => {
    const owner = workflow.owner ?? {
      ownerType: "personal" as const,
      ownerId: "local",
    };
    void api
      .listInstalledPlugins(owner.ownerType, owner.ownerId)
      .then(setInstalledPlugins);
  }, [workflow.owner?.ownerType, workflow.owner?.ownerId]);
  useEffect(() => {
    if (!api.isDesktop) return;
    let stop: undefined | (() => void);
    listen<{ type: string; node_id?: string; record?: ExecutionRecord }>(
      "runner-event",
      (event) => {
        if (event.payload.type === "node_started")
          setRunningNode(event.payload.node_id);
        if (
          event.payload.type === "execution_updated" &&
          event.payload.record?.workflowId === workflow.id
        ) {
          setRun(event.payload.record);
          setBottomOpen(true);
          if (event.payload.record.status !== "running")
            setRunningNode(undefined);
        }
      },
    ).then((fn) => (stop = fn));
    return () => stop?.();
  }, [workflow.id]);
  const doSave = useCallback(async (): Promise<boolean> => {
    setSaveState("saving");
    try {
      const saved = await saveWorkflow(workflow);
      setWorkflow(saved);
      setBaseline(JSON.stringify(saved));
      setSaveState("saved");
      toast.push("Workflow saved.", "success");
      return true;
    } catch (error) {
      setSaveState("failed");
      setIssues((current) => [
        {
          code: "save_failed",
          message: String(error),
          severity: "error",
          suggestion: "Retry saving before you run the workflow.",
        },
        ...current.filter((issue) => issue.code !== "save_failed"),
      ]);
      setBottomOpen(true);
      toast.push(
        "Save failed. Your changes are still available to retry.",
        "error",
      );
      return false;
    }
  }, [workflow, saveWorkflow, toast]);
  const test = useCallback(async () => {
    const result = await api.validateWorkflow(workflow);
    setIssues(result);
    if (result.length) setBottomOpen(true);
    return result;
  }, [workflow]);
  const loadRevisions = useCallback(async () => {
    const history = await api.listWorkflowRevisions(workflow.id);
    setRevisions(history);
    return history;
  }, [workflow.id]);
  const openRevisionHistory = useCallback(async () => {
    if (dirty && !(await doSave())) return;
    try {
      await loadRevisions();
      setRevisionOpen(true);
    } catch (error) {
      toast.push(`Revision history could not be loaded: ${String(error)}`, "error");
    }
  }, [dirty, doSave, loadRevisions, toast]);
  const testSelectedNode = useCallback(async (allowSideEffects = false) => {
    if (!selectedNode || testingNode) return;
    if (definitionFor(selectedNode.type).sideEffect && !allowSideEffects) {
      setPendingSideEffectTest(true);
      return;
    }
    setTestingNode(true);
    setBottomOpen(true);
    try {
      const execution = await api.testWorkflowNode(
        workflow,
        selectedNode.id,
        {},
        run?.id,
        allowSideEffects,
      );
      setRun(execution);
      setIssues([]);
      toast.push(`${selectedNode.name} test completed.`, "success");
    } catch (error) {
      setIssues([{code:"node_test_failed",message:String(error),severity:"error",nodeId:selectedNode.id}]);
    } finally {
      setTestingNode(false);
      setPendingSideEffectTest(false);
    }
  }, [run?.id, selectedNode, testingNode, toast, workflow]);
  useEffect(() => {
    const request = ++validationRequest.current;
    const timer = window.setTimeout(() => {
      void api
        .validateWorkflow(workflow)
        .then((result) => {
          if (request === validationRequest.current)
            setIssues((current) => [
              ...current.filter((issue) => issue.code === "save_failed"),
              ...result,
            ]);
        })
        .catch((error) => {
          if (request === validationRequest.current)
            setIssues([
              {
                code: "validation_unavailable",
                message: String(error),
                severity: "warning",
                suggestion: "Try Validate again.",
              },
            ]);
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [workflow]);
  const doRun = useCallback(async () => {
    if (!(await doSave())) return;
    const result = await test();
    if (result.some((issue) => issue.severity === "error")) return;
    setRunning(true);
    setBottomOpen(true);
    try {
      const execution = await api.runWorkflow(workflow.id);
      setRun(execution);
    } catch (error) {
      setIssues([
        { code: "runner_error", message: String(error), severity: "error" },
      ]);
    } finally {
      setRunning(false);
      setRunningNode(undefined);
    }
  }, [doSave, test, workflow.id]);
  const retryNode = useCallback(
    async (nodeId: string) => {
      if (!run) return;
      setRunning(true);
      try {
        setRun(await api.retryFailedNode(run.id, nodeId));
        setIssues([]);
      } catch (error) {
        setIssues([
          { code: "runner_error", message: String(error), severity: "error" },
        ]);
      } finally {
        setRunning(false);
      }
    },
    [run],
  );
  const retryHeaded = useCallback(async () => {
    if (!run) return;
    setRunning(true);
    try {
      setRun(await api.retryBrowserExecutionHeaded(run.id));
      setIssues([]);
    } catch (error) {
      setIssues([
        { code: "runner_error", message: String(error), severity: "error" },
      ]);
    } finally {
      setRunning(false);
    }
  }, [run]);
  const removeNode = useCallback(
    (id: string, confirmed = false) => {
      const node = workflow.nodes.find((n) => n.id === id);
      if (!node) return;
      const configured =
        Object.keys(node.configuration).length > 0 &&
        Object.values(node.configuration).some((v) => v !== "" && v != null);
      if (confirmNodeDeletion && configured && !confirmed) {
        setPendingDeleteNodeId(id);
        return;
      }
      commit({
        ...workflow,
        nodes: workflow.nodes.filter((n) => n.id !== id),
        edges: workflow.edges.filter(
          (e) => e.sourceNodeId !== id && e.targetNodeId !== id,
        ),
      });
      setSelectedNodeId(undefined);
    },
    [workflow, commit, confirmNodeDeletion],
  );
  const duplicate = useCallback(
    (id: string) => {
      const original = workflow.nodes.find((n) => n.id === id);
      if (!original || isTrigger(original.type)) return;
      const copy = {
        ...structuredClone(original),
        id: `${original.type}_${crypto.randomUUID().slice(0, 8)}`,
        name: `${original.name} copy`,
        position: { x: original.position.x + 32, y: original.position.y + 96 },
      };
      commit({ ...workflow, nodes: [...workflow.nodes, copy] });
      setSelectedNodeId(copy.id);
    },
    [workflow, commit],
  );
  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (previous) {
      future.current.push(structuredClone(workflow));
      setWorkflow(previous);
    }
  }, [workflow]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next) {
      past.current.push(structuredClone(workflow));
      setWorkflow(next);
    }
  }, [workflow]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable=true]")) {
        if (e.key === "Escape") (target as HTMLElement).blur();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        doSave();
      } else if (mod && e.key === "Enter") {
        e.preventDefault();
        doRun();
      } else if (mod && e.key.toLowerCase() === "d" && selectedNodeId) {
        e.preventDefault();
        duplicate(selectedNodeId);
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedNodeId
      ) {
        e.preventDefault();
        removeNode(selectedNodeId);
      } else if (e.key === "Escape") {
        setSelectedNodeId(undefined);
        setPicker((p) => ({ ...p, open: false }));
      } else if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPicker({ open: true, position: { x: 360, y: 220 } });
      } else if (e.key.toLowerCase() === "a" && !mod) {
        setPicker({ open: true, position: { x: 360, y: 220 } });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [doSave, doRun, duplicate, redo, removeNode, selectedNodeId, undo]);
  const addNode = (type: NodeType) => {
    if (isTrigger(type) && workflow.nodes.some((n) => isTrigger(n.type))) {
      setIssues([
        {
          code: "trigger_count",
          message:
            "A workflow can contain only one trigger. Replace the existing trigger instead.",
          severity: "error",
        },
      ]);
      setBottomOpen(true);
      return;
    }
    const node = createNode(type, picker.position);
    let edges = workflow.edges;
    if (picker.sourceId)
      edges = [
        ...edges,
        {
          id: `edge_${crypto.randomUUID().slice(0, 8)}`,
          sourceNodeId: picker.sourceId,
          sourceHandle:
            workflow.nodes.find((n) => n.id === picker.sourceId)?.type ===
            "condition"
              ? "true"
              : "output",
          targetNodeId: node.id,
          targetHandle: "input",
        },
      ];
    commit({ ...workflow, nodes: [...workflow.nodes, node], edges });
    setSelectedNodeId(node.id);
  };
  const addPluginNode = (choice: PluginNodeChoice) => {
    const node = createPluginNode(choice, picker.position);
    let edges = workflow.edges;
    if (picker.sourceId)
      edges = [
        ...edges,
        {
          id: `edge_${crypto.randomUUID().slice(0, 8)}`,
          sourceNodeId: picker.sourceId,
          sourceHandle:
            workflow.nodes.find((n) => n.id === picker.sourceId)?.type ===
            "condition"
              ? "true"
              : "output",
          targetNodeId: node.id,
          targetHandle: "input",
        },
      ];
    commit({ ...workflow, nodes: [...workflow.nodes, node], edges });
    setSelectedNodeId(node.id);
  };
  const applyRecording = (profileId: string, steps: RecordedStep[]) => {
    const outgoing = new Set(workflow.edges.map((edge) => edge.sourceNodeId));
    const source =
      [...workflow.nodes]
        .filter((node) => !outgoing.has(node.id))
        .sort((a, b) => b.position.x - a.position.x)[0] ??
      workflow.nodes.find((node) => node.id === workflow.triggerNodeId);
    let x = (source?.position.x ?? 60) + 280;
    const y = source?.position.y ?? 160;
    const openNode = {
      ...createNode("open_browser", { x, y }),
      configuration: {
        ...createNode("open_browser", { x, y }).configuration,
        profileId,
        headed: true,
      },
    };
    const supported = new Set<NodeType>([
      "navigate",
      "click_element",
      "fill_field",
      "select_option",
      "press_key",
      "download_file",
      "upload_file",
    ]);
    const recorded = steps
      .filter((step) => supported.has(step.action as NodeType))
      .map((step, index) => ({
        ...createNode(step.action as NodeType, { x: x + (index + 1) * 280, y }),
        name: step.name,
        configuration: {
          ...createNode(step.action as NodeType, { x: 0, y: 0 }).configuration,
          ...step.configuration,
        },
      }));
    const added = [openNode, ...recorded];
    const edges = [...workflow.edges];
    if (source)
      edges.push({
        id: `edge_${crypto.randomUUID().slice(0, 8)}`,
        sourceNodeId: source.id,
        sourceHandle: source.type === "condition" ? "true" : "output",
        targetNodeId: openNode.id,
        targetHandle: "input",
      });
    for (let index = 1; index < added.length; index++)
      edges.push({
        id: `edge_${crypto.randomUUID().slice(0, 8)}`,
        sourceNodeId: added[index - 1].id,
        sourceHandle: "output",
        targetNodeId: added[index].id,
        targetHandle: "input",
      });
    commit({
      ...workflow,
      nodes: [...workflow.nodes, ...added],
      edges,
      settings: {
        ...workflow.settings,
        permissions: {
          ...workflow.settings.permissions,
          browserAutomationPermitted: false,
          approvedBrowserProfileIds:
            workflow.settings.permissions.approvedBrowserProfileIds.filter(
              (id) => id !== profileId,
            ),
        },
      },
    });
    setSelectedNodeId(openNode.id);
  };
  const tidy = () => {
    const levels = new Map<string, number>([[workflow.triggerNodeId, 0]]);
    for (let i = 0; i < workflow.nodes.length; i++)
      for (const edge of workflow.edges) {
        const source = levels.get(edge.sourceNodeId);
        if (source != null)
          levels.set(
            edge.targetNodeId,
            Math.max(levels.get(edge.targetNodeId) ?? 0, source + 1),
          );
      }
    const counts = new Map<number, number>();
    patchWorkflow({
      nodes: workflow.nodes.map((n) => {
        const level = levels.get(n.id) ?? 0;
        const count = counts.get(level) ?? 0;
        counts.set(level, count + 1);
        return {
          ...n,
          position: { x: 60 + level * 280, y: 160 + count * 180 },
        };
      }),
    });
  };
  const nodeWarnings = new Map(
    issues.filter((i) => i.nodeId).map((i) => [i.nodeId!, i.message]),
  );
  const flowNodes: Node<WorkflowNodeData>[] = workflow.nodes.map((node) => ({
    id: node.id,
    type: "workflow",
    position: node.position,
    selected: node.id === selectedNodeId,
    ariaLabel: `${node.name}, ${node.type.replaceAll("_", " ")}, position x ${Math.round(node.position.x)}, y ${Math.round(node.position.y)}`,
    data: {
      node,
      status: (runningNode === node.id
        ? "running"
        : (run?.nodeExecutions.find((e) => e.nodeId === node.id)?.status ??
          "idle")) as NodeStatus,
      warning: nodeWarnings.get(node.id),
      onAdd: (sourceId: string) => {
        const source = workflow.nodes.find((n) => n.id === sourceId)!;
        setPicker({
          open: true,
          sourceId,
          position: { x: source.position.x + 280, y: source.position.y },
        });
      },
    },
  }));
  const [displayNodes, setDisplayNodes, onDisplayNodesChange] =
    useNodesState<Node<WorkflowNodeData>>(flowNodes);
  useEffect(() => {
    setDisplayNodes((current) =>
      flowNodes.map((node) => {
        const existing = current.find((item) => item.id === node.id);
        return existing ? { ...existing, ...node } : node;
      }),
    );
  }, [
    workflow.nodes,
    selectedNodeId,
    runningNode,
    run,
    issues,
    setDisplayNodes,
  ]);
  const flowEdges: Edge[] = workflow.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: "smoothstep",
    animated: Boolean(runningNode && edge.sourceNodeId === runningNode),
    className:
      run?.nodeExecutions.find((n) => n.nodeId === edge.sourceNodeId)
        ?.status === "successful"
        ? "edge-success"
        : "",
  }));
  const onNodesChange = (changes: NodeChange<Node<WorkflowNodeData>>[]) => {
    onDisplayNodesChange(changes);
    let changed = false;
    const nodes = workflow.nodes.map((node) => {
      const change = changes.find((c) => "id" in c && c.id === node.id);
      if (change?.type === "position" && change.position) {
        changed = true;
        return { ...node, position: change.position };
      }
      if (change?.type === "select" && change.selected)
        setSelectedNodeId(node.id);
      return node;
    });
    if (changed) setWorkflow({ ...workflow, nodes });
  };
  const onConnect = (connection: Connection) => {
    if (
      !connection.source ||
      !connection.target ||
      connection.source === connection.target
    )
      return;
    const target = workflow.nodes.find((n) => n.id === connection.target);
    if (target && isTrigger(target.type)) return;
    const exists = workflow.edges.some(
      (e) =>
        e.sourceNodeId === connection.source &&
        e.targetNodeId === connection.target &&
        e.sourceHandle === (connection.sourceHandle ?? "output"),
    );
    if (exists) return;
    commit({
      ...workflow,
      edges: [
        ...workflow.edges,
        {
          id: `edge_${crypto.randomUUID().slice(0, 8)}`,
          sourceNodeId: connection.source,
          sourceHandle: connection.sourceHandle ?? "output",
          targetNodeId: connection.target,
          targetHandle: connection.targetHandle ?? "input",
        },
      ],
    });
  };
  return (
    <main
      className="editor"
      style={
        { "--inspector-width": `${editorInspectorWidth}px` } as CSSProperties
      }
    >
      <header className="editor-topbar">
        <Tooltip content="Back to workflows">
          <button
            className="icon-button"
            onClick={goBack}
            aria-label="Back to workflows"
          >
            <ArrowLeft size={16} />
          </button>
        </Tooltip>
        <input
          className="workflow-title-input"
          aria-label="Workflow name"
          value={workflow.name}
          onChange={(e) => setWorkflow({ ...workflow, name: e.target.value })}
        />
        {dirty && <span className="unsaved-dot" title="Unsaved changes" />}
        <label className="enabled-toggle">
          <input
            type="checkbox"
            aria-label="Workflow enabled"
            checked={workflow.enabled}
            onChange={(e) =>
              setWorkflow({ ...workflow, enabled: e.target.checked })
            }
          />
          <span />
          {workflow.enabled ? "Enabled" : "Disabled"}
        </label>
        <div className="topbar-spacer" />
        <span className="browser-recorder-wrap">
          <BrowserRecorder
            profiles={browserProfiles}
            onProfileCreated={(profile) =>
              setBrowserProfiles((current) => [...current, profile])
            }
            onApply={applyRecording}
          />
        </span>
        <button
          className="button toolbar-secondary"
          aria-expanded={accessibleEditorOpen}
          aria-controls="accessible-workflow-editor"
          onClick={() =>
            setAccessibleEditorOpen((value) => {
              if (!value) setAuxiliaryTab("accessible");
              return !value;
            })
          }
        >
          <Accessibility size={14} />
          Accessible editor
        </button>
        <button className="button toolbar-secondary" onClick={tidy}>
          <LayoutGrid size={14} />
          Tidy
        </button>
        <button
          className="button toolbar-secondary"
          onClick={() => setPermissionOpen(true)}
        >
          <ShieldCheck size={14} />
          Permissions
        </button>
        <button className="button toolbar-secondary" onClick={() => void openRevisionHistory()}>
          <History size={14}/>
          Revisions
        </button>
        <button className="button toolbar-secondary" onClick={test}>
          <TestTube2 size={14} />
          Validate
        </button>
        <button className="button toolbar-secondary" disabled={!selectedNode || testingNode} onClick={()=>void testSelectedNode()}>
          <TestTube2 size={14}/>
          {testingNode ? "Testing…" : "Test step"}
        </button>
        <span
          className={`save-state save-state-${dirty && saveState === "saved" ? "unsaved" : saveState}`}
          role="status"
        >
          {saveState === "saving"
            ? "Saving…"
            : saveState === "failed"
              ? "Save failed"
              : dirty
                ? "Unsaved"
                : "Saved"}
        </span>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="button toolbar-overflow"
              aria-label="More editor actions"
              title="More editor actions"
            >
              <MoreHorizontal size={15} />
              <span>More</span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu" align="end">
              <DropdownMenu.Label className="menu-label">
                Editor actions
              </DropdownMenu.Label>
              <DropdownMenu.Item
                onSelect={() =>
                  document
                    .querySelector<HTMLElement>(".browser-recorder-wrap>button")
                    ?.click()
                }
              >
                Record browser actions
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() =>
                  setAccessibleEditorOpen((value) => {
                    if (!value) setAuxiliaryTab("accessible");
                    return !value;
                  })
                }
              >
                Accessible editor
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={tidy}>
                Tidy workflow
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => setPermissionOpen(true)}>
                Review permissions
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => void openRevisionHistory()}>
                Revision history
              </DropdownMenu.Item>
              <DropdownMenu.Item disabled={!selectedNode} onSelect={() => void testSelectedNode()}>
                Test selected step
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => void test()}>
                Validate workflow <kbd>Ctrl Shift V</kbd>
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                disabled={!past.current.length}
                onSelect={undo}
              >
                Undo <kbd>Ctrl Z</kbd>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled={!future.current.length}
                onSelect={redo}
              >
                Redo <kbd>Ctrl Shift Z</kbd>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Tooltip content="Save workflow (Ctrl+S)">
          <span className="tooltip-control-wrap">
            <button
              className="button"
              aria-label="Save workflow"
              disabled={!dirty || saveState === "saving"}
              onClick={doSave}
            >
              <Save size={14} />
              {saveState === "saving"
                ? "Saving…"
                : saveState === "failed"
                  ? "Retry save"
                  : "Save"}
            </button>
          </span>
        </Tooltip>
        <button
          className="button primary"
          disabled={running || saveState === "failed"}
          onClick={doRun}
        >
          <Play size={14} fill="currentColor" />
          {running ? "Running…" : "Run"}
        </button>
      </header>
      <div
        className={`editor-body ${selectedNode ? "with-inspector" : ""} ${accessibleEditorOpen ? "with-accessible-editor" : ""}`}
        data-auxiliary-tab={auxiliaryTab}
      >
        <div
          className="canvas-wrap"
          onDoubleClick={(event) => {
            if (
              !(event.target as HTMLElement).classList.contains(
                "react-flow__pane",
              )
            )
              return;
            const position = instance?.screenToFlowPosition({
              x: event.clientX,
              y: event.clientY,
            }) ?? { x: 360, y: 220 };
            setPicker({ open: true, position });
          }}
        >
          <ReactFlow<Node<WorkflowNodeData>, Edge>
            nodes={displayNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onInit={setInstance}
            onMoveEnd={(_, viewport) =>
              localStorage.setItem(
                `sandbox.workflow-viewport.v1.${workflow.id}`,
                JSON.stringify(viewport),
              )
            }
            onNodesChange={onNodesChange}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(undefined)}
            onConnect={onConnect}
            isValidConnection={(connection) => {
              const target = workflow.nodes.find(
                (n) => n.id === connection.target,
              );
              return (
                connection.source !== connection.target &&
                !Boolean(target && isTrigger(target.type))
              );
            }}
            snapToGrid={snapToGrid}
            snapGrid={[gridSize, gridSize]}
            minZoom={0.45}
            maxZoom={1.8}
            defaultViewport={initialViewport}
            deleteKeyCode={null}
            multiSelectionKeyCode="Shift"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={gridSize}
              size={1}
              color="var(--border-strong)"
            />
            <Controls showInteractive={false} />
            {showMinimap && (
              <MiniMap
                pannable
                zoomable
                nodeColor="var(--border-strong)"
                maskColor="var(--overlay)"
              />
            )}
          </ReactFlow>
          {showCanvasHints && (
            <div className="canvas-hint">
              <Command size={13} />
              Double-click canvas or press A to add a node
            </div>
          )}
        </div>
        {accessibleEditorOpen && selectedNode && (
          <div
            className="auxiliary-tabs"
            role="tablist"
            aria-label="Editor auxiliary panel"
          >
            <button
              role="tab"
              aria-selected={auxiliaryTab === "accessible"}
              onClick={() => setAuxiliaryTab("accessible")}
            >
              <Accessibility size={13} />
              Accessible graph
            </button>
            <button
              role="tab"
              aria-selected={auxiliaryTab === "inspector"}
              onClick={() => setAuxiliaryTab("inspector")}
            >
              <ShieldCheck size={13} />
              Inspector
            </button>
          </div>
        )}
        {accessibleEditorOpen && (
          <AccessibleWorkflowEditor
            workflow={workflow}
            selectedNodeId={selectedNodeId}
            onSelect={setSelectedNodeId}
            onAddNode={() =>
              setPicker({ open: true, position: { x: 360, y: 220 } })
            }
            onChange={(next, message) => {
              if (next !== workflow) commit(next);
              setAnnouncement(message);
            }}
          />
        )}
        {selectedNode && (
          <>
            <div
              className="inspector-resize"
              role="separator"
              aria-label="Resize inspector"
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={resizeInspector}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft")
                  updatePreferences({
                    editorInspectorWidth: editorInspectorWidth + 10,
                  });
                if (event.key === "ArrowRight")
                  updatePreferences({
                    editorInspectorWidth: editorInspectorWidth - 10,
                  });
              }}
            />
            <NodeInspector
              workflow={workflow}
              node={selectedNode}
              issues={issues.filter(
                (issue) => issue.nodeId === selectedNode.id,
              )}
              onChange={(node, workflowPatch) => {
                const next = {
                  ...workflow,
                  ...workflowPatch,
                  nodes: workflow.nodes.map((n) =>
                    n.id === node.id ? node : n,
                  ),
                };
                commit(next);
              }}
              onDelete={() => removeNode(selectedNode.id)}
            />
          </>
        )}
      </div>
      <section className={`execution-drawer ${bottomOpen ? "open" : ""}`}>
        <button
          className="drawer-handle"
          onClick={() => setBottomOpen((v) => !v)}
        >
          <History size={14} />
          <span>Execution & data</span>
          {run && (
            <span className={`drawer-status status-${run.status}`}>
              {run.status}
            </span>
          )}
          {issues.length > 0 && (
            <span className="warning-count">
              <AlertTriangle size={13} />
              {issues.length} issue{issues.length === 1 ? "" : "s"}
            </span>
          )}
          <span className="topbar-spacer" />
          {bottomOpen ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
        {bottomOpen && (
          <div className="drawer-content">
            {issues.length > 0 ? (
              <div className="validation-list">
                <h3>Workflow needs attention</h3>
                {issues.map((issue, i) => (
                  <button
                    key={i}
                    onClick={() =>
                      issue.nodeId && setSelectedNodeId(issue.nodeId)
                    }
                  >
                    <AlertTriangle size={14} />
                    <span>
                      <b>{issue.message}</b>
                      <small>
                        {issue.nodeId
                          ? workflow.nodes.find((n) => n.id === issue.nodeId)
                              ?.name
                          : "Workflow"}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            ) : run ? (
              <ExecutionInspector
                compact
                run={run}
                workflow={workflow}
                onRetry={doRun}
                onRetryNode={retryNode}
                onRetryHeaded={retryHeaded}
                onEditNode={(nodeId) => {
                  setSelectedNodeId(nodeId);
                  setBottomOpen(false);
                }}
              />
            ) : (
              <div className="drawer-empty">
                <TestTube2 size={18} />
                <b>No execution selected</b>
                <span>
                  Validate the workflow or run it to inspect live data.
                </span>
              </div>
            )}
          </div>
        )}
      </section>
      <CommandPalette
        open={picker.open}
        onClose={() => setPicker((p) => ({ ...p, open: false }))}
        onAdd={addNode}
        onAddPlugin={addPluginNode}
        pluginNodes={enabledPluginNodes(installedPlugins)}
        unavailablePluginNodes={installedPlugins
          .filter((plugin) => plugin.state !== "enabled")
          .flatMap((plugin) =>
            plugin.manifest.nodes.map((node) => ({ plugin, node })),
          )}
        sourceType={
          workflow.nodes.find((node) => node.id === picker.sourceId)?.type
        }
        hasTrigger={workflow.nodes.some((node) => isTrigger(node.type))}
        actions={[
          {
            id: "editor-run",
            group: "Editor",
            name: "Run workflow",
            description: "Save, validate, and start a manual run.",
            action: () => void doRun(),
          },
          {
            id: "editor-save",
            group: "Editor",
            name: "Save workflow",
            description: "Persist the current workflow explicitly.",
            action: () => void doSave(),
          },
          {
            id: "editor-validate",
            group: "Editor",
            name: "Validate workflow",
            description: "Check configuration without executing.",
            action: () => void test(),
          },
          {
            id: "editor-undo",
            group: "Edit",
            name: "Undo",
            description: "Undo the most recent editor change.",
            action: undo,
          },
          {
            id: "editor-redo",
            group: "Edit",
            name: "Redo",
            description: "Redo the most recently undone change.",
            action: redo,
          },
          {
            id: "editor-tidy",
            group: "Edit",
            name: "Tidy workflow",
            description: "Arrange nodes into a readable layout.",
            action: tidy,
          },
          {
            id: "editor-permissions",
            group: "Editor",
            name: "Review permissions",
            description: "Inspect local workflow capabilities.",
            action: () => setPermissionOpen(true),
          },
          {
            id: "editor-back",
            group: "Navigation",
            name: "Back to workflows",
            description: "Return to workflow management.",
            action: goBack,
          },
          ...(selectedNode
            ? [
                {
                  id: "editor-duplicate-node",
                  group: "Selected node",
                  name: "Duplicate selected node",
                  description: selectedNode.name,
                  action: () => duplicate(selectedNode.id),
                },
              ]
            : []),
        ]}
      />
      {permissionOpen && (
        <PermissionReview
          workflow={workflow}
          onClose={() => setPermissionOpen(false)}
          onApply={(permissions) => {
            setWorkflow({
              ...workflow,
              settings: { ...workflow.settings, permissions },
            });
            setPermissionOpen(false);
          }}
        />
      )}
      <Dialog
        open={revisionOpen}
        onOpenChange={setRevisionOpen}
        title="Revision history"
        description="Every content-changing save is immutable. Restoring creates a new revision and keeps this history intact."
        width="large"
      >
        <div className="revision-list">
          {revisions.map((revision) => (
            <div className="revision-row" key={revision.revisionId}>
              <div>
                <b>{revision.changeSummary}</b>
                <small>{new Date(revision.createdAt).toLocaleString()} · {revision.contentHash.slice(0,20)}</small>
              </div>
              {revision.current ? <span className="revision-current">Current</span> : <button className="button" onClick={()=>setPendingRevisionId(revision.revisionId)}>Restore</button>}
            </div>
          ))}
          {!revisions.length && <div className="drawer-empty"><History size={18}/><b>No saved revisions</b></div>}
        </div>
      </Dialog>
      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Leave unsaved workflow?"
        description="Your local changes have not been saved and will be lost."
        confirmLabel="Leave workflow"
        dangerous
        onConfirm={() => setView("workflows")}
      />
      <ConfirmDialog
        open={Boolean(pendingRevisionId)}
        onOpenChange={(open)=>!open&&setPendingRevisionId(undefined)}
        title="Restore this revision?"
        description="The selected snapshot becomes a new current revision. Existing revisions and executions remain unchanged."
        confirmLabel="Restore revision"
        onConfirm={()=>{
          if (!pendingRevisionId) return;
          void api.restoreWorkflowRevision(workflow.id,pendingRevisionId).then(async restored=>{
            setWorkflow(restored);
            setBaseline(JSON.stringify(restored));
            setPendingRevisionId(undefined);
            await loadRevisions();
            toast.push("Revision restored as a new head.","success");
          }).catch(error=>toast.push(String(error),"error"));
        }}
      />
      <ConfirmDialog
        open={pendingSideEffectTest}
        onOpenChange={setPendingSideEffectTest}
        title="Run a side-effecting step test?"
        description="This selected step can change files, send data, notify someone, or update workflow state. Upstream and downstream steps will not run."
        confirmLabel="Run step test"
        dangerous
        onConfirm={()=>void testSelectedNode(true)}
      />
      <ConfirmDialog
        open={Boolean(pendingDeleteNodeId)}
        onOpenChange={(open) => !open && setPendingDeleteNodeId(undefined)}
        title="Delete configured node?"
        description="This node contains configuration. Deleting it also removes its incoming and outgoing connections."
        confirmLabel="Delete node"
        dangerous
        onConfirm={() => {
          if (pendingDeleteNodeId) removeNode(pendingDeleteNodeId, true);
          setPendingDeleteNodeId(undefined);
        }}
      />
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>
    </main>
  );
}

function PermissionReview({
  workflow,
  onClose,
  onApply,
}: {
  workflow: Workflow;
  onClose: () => void;
  onApply: (permissions: PermissionSummary) => void;
}) {
  const [permissions, setPermissions] = useState(workflow.settings.permissions);
  const domains = workflow.nodes
    .filter((node) => node.type === "http_request")
    .map((node) => {
      try {
        return new URL(String(node.configuration.url)).hostname;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  const commandNodes = workflow.nodes.filter(
    (node) => node.type === "run_command",
  );
  const browserProfiles = [
    ...new Set(
      workflow.nodes
        .filter((node) => node.type === "open_browser")
        .map((node) => String(node.configuration.profileId ?? ""))
        .filter(Boolean),
    ),
  ];
  const communicationNodes = workflow.nodes.filter((node) =>
    [
      "gmail_create_draft",
      "gmail_send_email",
      "discord_webhook",
      "discord_embed",
      "slack_webhook",
    ].includes(node.type),
  );
  const sendNodes = workflow.nodes.filter(
    (node) => node.type === "gmail_send_email",
  );
  return (
    <FocusDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Workflow permissions"
      description="Review exactly what this workflow may access and send."
    >
      <div className="permission-modal">
        <header>
          <span className="permission-icon">
            <ShieldCheck size={18} />
          </span>
          <div>
            <h2>Workflow permissions</h2>
            <p>Review exactly what this workflow may access and send.</p>
          </div>
        </header>
        <section>
          <label>Approved network domains</label>
          {domains.length ? (
            domains.map((domain) => (
              <div className="permission-row" key={domain}>
                <span>↗</span>
                <b>{domain}</b>
                <em>Required by HTTP Request</em>
              </div>
            ))
          ) : (
            <div className="permission-empty">
              No direct network domains requested.
            </div>
          )}
          <label>Approved folders</label>
          {permissions.approvedFolders.length ? (
            permissions.approvedFolders.map((folder) => (
              <div className="permission-row" key={folder}>
                <span>⌁</span>
                <b>{folder}</b>
              </div>
            ))
          ) : (
            <div className="permission-empty">No folder access approved.</div>
          )}
          {browserProfiles.length > 0 && (
            <>
              <label>Managed browser profiles</label>
              {browserProfiles.map((profileId) => (
                <div className="permission-row" key={profileId}>
                  <span>◎</span>
                  <b>{profileId}</b>
                  <em>Isolated application profile</em>
                </div>
              ))}
              <label className="toggle-row">
                <span>
                  <b>Permit browser automation</b>
                  <small>
                    Changing any browser action revokes this approval.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={permissions.browserAutomationPermitted}
                  onChange={(event) =>
                    setPermissions({
                      ...permissions,
                      browserAutomationPermitted: event.target.checked,
                    })
                  }
                />
              </label>
            </>
          )}
          {communicationNodes.length > 0 && (
            <>
              <label>External communication</label>
              {communicationNodes.map((node) => (
                <div className="command-review" key={node.id}>
                  <AlertTriangle size={15} />
                  <div>
                    <b>{node.name}</b>
                    <code>
                      {node.type === "gmail_send_email"
                        ? `${String(node.configuration.credentialId || "No connection")} → ${String(node.configuration.to || "No recipient")}${String(node.configuration.to || "").includes("{{") ? " (dynamic)" : " (static)"}`
                        : String(
                            node.configuration.credentialId ||
                              "Connection not configured",
                          )}
                    </code>
                  </div>
                </div>
              ))}
              <label className="toggle-row">
                <span>
                  <b>Permit external communication</b>
                  <small>
                    Connection or message logic changes revoke approval.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={permissions.externalCommunicationPermitted}
                  onChange={(event) =>
                    setPermissions({
                      ...permissions,
                      externalCommunicationPermitted: event.target.checked,
                      communicationApprovalRevision:
                        event.target.checked && sendNodes.length
                          ? crypto.randomUUID()
                          : null,
                    })
                  }
                />
              </label>
            </>
          )}
          {commandNodes.length > 0 && (
            <>
              <label>Command execution</label>
              {commandNodes.map((node) => (
                <div className="command-review" key={node.id}>
                  <AlertTriangle size={15} />
                  <div>
                    <b>
                      {String(
                        node.configuration.executable ||
                          "Executable not configured",
                      )}
                    </b>
                    <code>
                      {((node.configuration.arguments as string[]) ?? []).join(
                        " ",
                      ) || "No arguments"}
                    </code>
                  </div>
                </div>
              ))}
              <label className="toggle-row">
                <span>
                  <b>Permit command execution</b>
                  <small>Changing a command revokes this approval.</small>
                </span>
                <input
                  type="checkbox"
                  checked={permissions.commandExecutionPermitted}
                  onChange={(event) =>
                    setPermissions({
                      ...permissions,
                      commandExecutionPermitted: event.target.checked,
                      approvalRevision: event.target.checked
                        ? crypto.randomUUID()
                        : null,
                    })
                  }
                />
              </label>
            </>
          )}
          <label className="toggle-row">
            <span>
              <b>Permit background execution</b>
              <small>
                Required for schedules, email polling, and file watches while in
                the tray.
              </small>
            </span>
            <input
              type="checkbox"
              checked={permissions.backgroundExecutionPermitted}
              onChange={(event) =>
                setPermissions({
                  ...permissions,
                  backgroundExecutionPermitted: event.target.checked,
                })
              }
            />
          </label>
          <div className="quit-note">
            Local schedules and polling stop when sndbox is fully quit.
          </div>
        </section>
        <footer>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            onClick={() =>
              onApply({
                ...permissions,
                approvedNetworkDomains: [
                  ...new Set([
                    ...permissions.approvedNetworkDomains,
                    ...domains,
                  ]),
                ],
                approvedBrowserProfileIds: [
                  ...new Set([
                    ...permissions.approvedBrowserProfileIds,
                    ...browserProfiles,
                  ]),
                ],
              })
            }
          >
            Apply permissions
          </button>
        </footer>
      </div>
    </FocusDialog>
  );
}
