import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForDesktopUpdateStatus, compareVersions, isNewerVersion, selectDesktopUpdate } from "./updates";

const getVersion = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/app", () => ({ getVersion }));

describe("desktop update version comparison", () => {
  afterEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });
  it("orders beta increments and stable releases correctly", () => {
    expect(isNewerVersion("0.7.2-beta.1", "0.7.2-beta.4")).toBe(true);
    expect(isNewerVersion("0.7.2-beta.4", "0.7.2")).toBe(true);
    expect(isNewerVersion("0.7.2", "0.7.2-beta.4")).toBe(false);
  });

  it("orders semantic versions rather than comparing strings", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("not-a-version", "1.0.0")).toBe(0);
  });

  it("selects the newest release and its Windows installer", () => {
    const update = selectDesktopUpdate("0.7.4-beta.1", "beta", [
      {
        tag_name: "v0.7.4-beta.3",
        prerelease: true,
        html_url: "https://github.com/sndboxhq/sandbox/releases/tag/v0.7.4-beta.3",
        assets: [
          { name: "SHA256SUMS", browser_download_url: "https://example.test/SHA256SUMS" },
          {
            name: "sndbox_0.7.4-beta.3_x64-setup.exe",
            browser_download_url: "https://github.com/sndboxhq/sandbox/releases/download/v0.7.4-beta.3/sndbox_0.7.4-beta.3_x64-setup.exe",
            size: 254_477_803,
            digest: `sha256:${"a".repeat(64)}`
          }
        ]
      },
      { tag_name: "v0.7.4-beta.2", prerelease: true, html_url: "https://example.test/older" }
    ]);

    expect(update).toMatchObject({
      version: "0.7.4-beta.3",
      installerName: "sndbox_0.7.4-beta.3_x64-setup.exe",
      installerBytes: 254_477_803,
      installerSha256: "a".repeat(64)
    });
    expect(update?.installerUrl).toMatch(/x64-setup\.exe$/);
  });

  it("keeps prereleases out of the stable channel", () => {
    expect(selectDesktopUpdate("0.7.4-beta.1", "stable", [
      { tag_name: "v0.7.4-beta.3", prerelease: true, html_url: "https://example.test/beta" }
    ])).toBeUndefined();
  });

  it("detects an available update through the real Tauri check path", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    getVersion.mockResolvedValue("0.7.4-beta.2");
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{
        tag_name: "v0.7.4-beta.3",
        prerelease: true,
        html_url: "https://github.com/sndboxhq/sandbox/releases/tag/v0.7.4-beta.3",
        assets: [{ name: "sndbox_0.7.4-beta.3_x64-setup.exe", browser_download_url: "https://example.test/setup.exe" }]
      }]
    }) as unknown as typeof fetch;

    const result = await checkForDesktopUpdateStatus("beta", fetcher);

    expect(result).toMatchObject({ status: "available", currentVersion: "0.7.4-beta.2", latestVersion: "0.7.4-beta.3" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
