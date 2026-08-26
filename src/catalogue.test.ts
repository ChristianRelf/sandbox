import { describe, expect, it } from "vitest";
import { createNode, definitionFor, NODE_DEFINITIONS } from "./catalogue";

describe("stage two node catalogue", () => {
  it("exposes the complete managed Chromium action set", () => {
    const types = new Set(NODE_DEFINITIONS.map(definition => definition.type));
    for (const type of ["open_browser", "navigate", "click_element", "fill_field", "select_option", "press_key", "wait_for", "extract_data", "screenshot", "download_file", "upload_file", "close_browser"] as const) {
      expect(types.has(type)).toBe(true);
    }
  });

  it("stores only credential references in communication nodes", () => {
    for (const type of ["gmail_new_email_trigger", "gmail_create_draft", "gmail_send_email", "discord_webhook", "discord_embed", "slack_webhook"] as const) {
      const defaults = definitionFor(type).defaults;
      expect(defaults).toHaveProperty("credentialId", "");
      expect(JSON.stringify(defaults).toLowerCase()).not.toContain("webhookurl");
      expect(JSON.stringify(defaults).toLowerCase()).not.toContain("accesstoken");
    }
  });

  it("creates independent editable configuration objects", () => {
    const first = createNode("http_request", { x: 0, y: 0 });
    const second = createNode("http_request", { x: 20, y: 20 });
    (first.configuration.headers as Record<string, string>).Authorization = "secret";
    expect(second.configuration.headers).toEqual({});
  });
});
