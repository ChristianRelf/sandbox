import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const token = "test-token-with-enough-entropy";
let child: ChildProcessWithoutNullStreams;
let lines: Interface;
let profilePath: string;

beforeEach(async () => {
  profilePath = await mkdtemp(path.join(tmpdir(), "sandbox-browser-test-"));
  child = spawn(process.execPath, [path.resolve("dist/server.js")], {
    env: { ...process.env, SANDBOX_IPC_TOKEN: token, PLAYWRIGHT_BROWSERS_PATH: path.resolve("browsers") }, stdio: ["pipe", "pipe", "pipe"],
  });
  lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
});
afterEach(async () => {
  lines.close(); child.kill(); await rm(profilePath, { recursive: true, force: true });
});

async function request(operation: string, payload: Record<string, unknown> = {}, suppliedToken = token) {
  const id = crypto.randomUUID();
  const response = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Sidecar did not respond before the timeout.")), 20_000);
    const onLine = (line: string) => {
      const value = JSON.parse(line);
      if (value.id !== id) return;
      clearTimeout(timer);
      lines.off("line", onLine);
      resolve(value);
    };
    lines.on("line", onLine);
  });
  child.stdin.write(`${JSON.stringify({ id, token: suppliedToken, protocolVersion: 1, operation, payload })}\n`);
  return response;
}

describe("authenticated protocol", () => {
  it("rejects the wrong token and negotiates versions", async () => {
    expect((await request("hello", {}, "wrong-token-value-different")).error.code).toBe("unauthorized");
    const hello = await request("hello");
    expect(hello.ok).toBe(true);
    expect(hello.result.protocolVersion).toBe(1);
    expect(hello.result.sidecarVersion).toBe("0.2.0");
    expect(hello.result.browserName).toBe("chromium");
    expect(hello.result.browserVersion).toMatch(/^140\./);
  }, 30_000);
});

describe("managed browser workflow", () => {
  it("fills, clicks, extracts and captures useful locator failure evidence", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end(`<!doctype html><label>Email <input aria-label="Email" /></label><button>Submit</button><output aria-label="Result"></output><script>document.querySelector('button').onclick=()=>document.querySelector('output').textContent='Saved '+document.querySelector('input').value</script>`);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    try {
      const opened = await request("open_browser", { profileId: "test", profilePath, persistent: false, headed: false });
      const sessionId = opened.result.browserSession.sessionId;
      expect((await request("navigate", { sessionId, url, waitCondition: "dom_ready" })).ok).toBe(true);
      const field = { primary: { kind: "label", value: "Email", exact: true }, alternatives: [], tag: "input", recordingUrl: url };
      expect((await request("fill_field", { sessionId, locator: field, value: "alice@example.com", sensitive: true })).ok).toBe(true);
      const button = { primary: { kind: "role", value: "button", name: "Submit", exact: true }, alternatives: [], tag: "button", recordingUrl: url };
      expect((await request("click_element", { sessionId, locator: button })).ok).toBe(true);
      const output = { primary: { kind: "role", value: "status", name: "Result", exact: true }, alternatives: [{ kind: "css", value: "output" }], tag: "output", recordingUrl: url };
      const extracted = await request("extract_data", { sessionId, locator: output, extract: "text", fieldName: "result" });
      expect(extracted.result.data.result).toBe("Saved alice@example.com");
      const missing = await request("click_element", { sessionId, locator: { primary: { kind: "role", value: "button", name: "Removed" }, alternatives: [], tag: "button", recordingUrl: url }, diagnosticDirectory: profilePath });
      expect(missing.ok).toBe(false);
      expect(missing.error.details.currentUrl).toBe(url + "/");
      expect(missing.error.details.locatorAttempts).toHaveLength(1);
      expect(missing.error.details.screenshotPath).toMatch(/failure-/);
      expect(missing.error.details.rerecordAvailable).toBe(true);
      expect((await request("close_browser", { sessionId })).ok).toBe(true);
      const stale = await request("navigate", { sessionId, url });
      expect(stale.error.code).toBe("session_not_found");
    } finally { server.close(); }
  }, 30_000);
});
