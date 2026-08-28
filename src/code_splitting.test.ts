import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("desktop startup bundle boundaries", () => {
  it("keeps non-default views behind lazy navigation boundaries", () => {
    const app = read("src/App.tsx");
    for (const view of ["HistoryView", "WorkflowEditor", "SettingsView", "PendingApprovalsView", "InstalledPluginsView", "MarketplaceView", "ApprovalRequest"]) {
      expect(app, view).toContain(`const ${view} = lazy(`);
      expect(app, view).not.toMatch(new RegExp(`import \\{ ${view} \\} from`));
    }
    expect(app).toContain('role="status">Loading view…');
  });

  it("loads React Flow styles with the editor and enforces byte budgets", () => {
    expect(read("src/main.tsx")).not.toContain("@xyflow/react/dist/style.css");
    expect(read("src/components/WorkflowEditor.tsx")).toContain('import "@xyflow/react/dist/style.css"');
    const config = read("vite.config.ts");
    expect(config).toContain("ENTRY_CHUNK_BUDGET_BYTES = 400_000");
    expect(config).toContain("ASYNC_CHUNK_BUDGET_BYTES = 300_000");
    expect(config).toContain("enforceBundleBudgets()");
  });
});
