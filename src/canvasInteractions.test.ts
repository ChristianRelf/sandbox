import { describe, expect, it } from "vitest";
import { isCanvasDoubleClickTarget } from "./canvasInteractions";

describe("isCanvasDoubleClickTarget", () => {
  it.each(["react-flow__pane", "react-flow__viewport", "react-flow__background"])(
    "accepts the %s as a canvas surface",
    (className) => {
      const flow = document.createElement("div");
      flow.className = "react-flow";
      const target = document.createElement(
        className === "react-flow__background" ? "svg" : "div",
      );
      target.classList.add(className);
      flow.append(target);

      expect(isCanvasDoubleClickTarget(target)).toBe(true);
    },
  );

  it.each(["react-flow__node", "react-flow__edge", "react-flow__controls"])(
    "rejects interactive %s content",
    (className) => {
      const flow = document.createElement("div");
      flow.className = "react-flow";
      const interactive = document.createElement("div");
      interactive.className = className;
      const target = document.createElement("span");
      interactive.append(target);
      flow.append(interactive);

      expect(isCanvasDoubleClickTarget(target)).toBe(false);
    },
  );

  it("rejects elements outside React Flow", () => {
    expect(isCanvasDoubleClickTarget(document.createElement("div"))).toBe(false);
  });
});
