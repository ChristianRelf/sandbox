const INTERACTIVE_CANVAS_TARGETS = [
  ".react-flow__node",
  ".react-flow__edge",
  ".react-flow__controls",
  ".react-flow__minimap",
  "button",
  "input",
  "textarea",
  "select",
  "a",
  "[role='button']",
].join(",");

/**
 * React Flow can report the pane, viewport, or background SVG as the target of
 * a canvas gesture. Treat all non-interactive surfaces inside React Flow as
 * canvas while keeping node and control double-clicks isolated.
 */
export function isCanvasDoubleClickTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || !target.closest(".react-flow")) {
    return false;
  }

  return !target.closest(INTERACTIVE_CANVAS_TARGETS);
}
