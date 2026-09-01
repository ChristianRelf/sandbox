import { getVersion } from "@tauri-apps/api/app";

export interface DesktopUpdate {
  version: string;
  releaseUrl: string;
  publishedAt?: string;
  installerUrl?: string;
  installerName?: string;
  installerBytes?: number;
  installerSha256?: string;
}

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
  digest?: string;
}

export interface GitHubRelease {
  draft?: boolean;
  prerelease?: boolean;
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
}

export const DESKTOP_UPDATE_AVAILABLE_EVENT = "sndbox:desktop-update-available";

export type DesktopUpdateCheckResult =
  | { status: "available"; currentVersion: string; latestVersion: string; update: DesktopUpdate }
  | { status: "current"; currentVersion: string; latestVersion?: string }
  | { status: "error"; currentVersion?: string; message: string }
  | { status: "unsupported"; message: string };

const RELEASES_API = import.meta.env.VITE_SANDBOX_RELEASES_API_URL
  ?? "https://api.github.com/repos/sndboxhq/sandbox/releases?per_page=10";

export async function checkForDesktopUpdate(channel: "beta" | "stable", fetcher: typeof fetch = fetch): Promise<DesktopUpdate | undefined> {
  const result = await checkForDesktopUpdateStatus(channel, fetcher);
  return result.status === "available" ? result.update : undefined;
}

export async function checkForDesktopUpdateStatus(channel: "beta" | "stable", fetcher: typeof fetch = fetch): Promise<DesktopUpdateCheckResult> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return { status: "unsupported", message: "Desktop updates can only be checked from the installed sndbox app." };
  }
  let currentVersion: string | undefined;
  try {
    currentVersion = await getVersion();
    const response = await fetcher(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store"
    });
    if (!response.ok) return { status: "error", currentVersion, message: `The release feed returned HTTP ${response.status}.` };
    const value = await response.json() as unknown;
    if (!Array.isArray(value)) return { status: "error", currentVersion, message: "The release feed returned an unexpected response." };
    const releases = value as GitHubRelease[];
    const update = selectDesktopUpdate(currentVersion, channel, releases);
    if (update) return { status: "available", currentVersion, latestVersion: update.version, update };
    const latestVersion = latestVersionForChannel(channel, releases);
    return { status: "current", currentVersion, ...(latestVersion ? { latestVersion } : {}) };
  } catch (error) {
    return { status: "error", ...(currentVersion ? { currentVersion } : {}), message: error instanceof Error ? error.message : "The desktop update check failed." };
  }
}

export function selectDesktopUpdate(currentVersion: string, channel: "beta" | "stable", releases: GitHubRelease[]): DesktopUpdate | undefined {
  return releases
    .filter(release => !release.draft && (channel === "beta" || !release.prerelease))
    .reduce<DesktopUpdate[]>((updates, release) => {
      const version = release.tag_name?.replace(/^v/, "");
      if (!version || !release.html_url || !isNewerVersion(currentVersion, version)) return updates;
      const installer = selectWindowsInstaller(release.assets ?? []);
      updates.push({
        version,
        releaseUrl: release.html_url,
        ...(release.published_at ? { publishedAt: release.published_at } : {}),
        ...(installer?.browser_download_url ? { installerUrl: installer.browser_download_url } : {}),
        ...(installer?.name ? { installerName: installer.name } : {}),
        ...(typeof installer?.size === "number" && installer.size > 0 ? { installerBytes: installer.size } : {}),
        ...(installer?.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1] ? { installerSha256: installer.digest.slice(7).toLowerCase() } : {})
      });
      return updates;
    }, [])
    .sort((left, right) => compareVersions(right.version, left.version))[0];
}

export function isNewerVersion(current: string, candidate: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (!a.prerelease.length && b.prerelease.length) return 1;
  if (a.prerelease.length && !b.prerelease.length) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;
    const aNumber = /^\d+$/.test(aPart) ? Number(aPart) : undefined;
    const bNumber = /^\d+$/.test(bPart) ? Number(bPart) : undefined;
    if (aNumber !== undefined && bNumber !== undefined) return aNumber - bNumber;
    if (aNumber !== undefined) return -1;
    if (bNumber !== undefined) return 1;
    return aPart.localeCompare(bPart);
  }
  return 0;
}

function parseVersion(version: string): {core: [number, number, number]; prerelease: string[]} | undefined {
  const match = version.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return undefined;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4]?.split(".") ?? [] };
}

function selectWindowsInstaller(assets: GitHubReleaseAsset[]): GitHubReleaseAsset | undefined {
  return assets
    .filter(asset => asset.name && asset.browser_download_url && /\.(?:exe|msi)$/i.test(asset.name))
    .sort((left, right) => installerScore(right.name ?? "") - installerScore(left.name ?? ""))[0];
}

function installerScore(name: string): number {
  return (/(?:x64|x86_64)/i.test(name) ? 4 : 0)
    + (/setup\.exe$/i.test(name) ? 2 : 0)
    + (/\.exe$/i.test(name) ? 1 : 0);
}

function latestVersionForChannel(channel: "beta" | "stable", releases: GitHubRelease[]): string | undefined {
  return releases
    .filter(release => !release.draft && (channel === "beta" || !release.prerelease))
    .map(release => release.tag_name?.replace(/^v/, "") ?? "")
    .filter(version => parseVersion(version))
    .sort((left, right) => compareVersions(right, left))[0];
}
