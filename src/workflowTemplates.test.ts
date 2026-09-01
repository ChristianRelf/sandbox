import { beforeEach, describe, expect, it } from "vitest";
import { previewApi } from "./previewApi";
import { WORKFLOW_TEMPLATES } from "./workflowTemplates";

describe("workflow template catalogue", () => {
  beforeEach(() => localStorage.clear());

  it("offers fifteen unique premade workflows backed by editable graphs", async () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(15);
    expect(new Set(WORKFLOW_TEMPLATES.map((item) => item.key)).size).toBe(15);

    for (const template of WORKFLOW_TEMPLATES) {
      const created = await previewApi.createWorkflow(
        template.key,
        `Copy of ${template.name}`,
      );
      expect(created.name).toBe(`Copy of ${template.name}`);
      expect(created.nodes.length, template.key).toBeGreaterThan(1);
      expect(created.edges.length, template.key).toBeGreaterThan(0);
    }
  });

  it("wires the localhost template into all three named Web Builder inputs", async () => {
    const created = await previewApi.createWorkflow("localhost-status-site");
    const site = created.nodes.find((node) => node.type === "web_builder");

    expect(Object.keys(site?.inputBindings ?? {}).sort()).toEqual([
      "css",
      "html",
      "javascript",
    ]);
    expect(
      created.edges
        .filter((edge) => edge.targetNodeId === site?.id)
        .map((edge) => edge.targetHandle)
        .sort(),
    ).toEqual(["css", "html", "javascript"]);
  });
});
