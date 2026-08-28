import { getVersion } from "@tauri-apps/api/app";

export interface DesktopUpdate {
  version: string;
  releaseUrl: string;
  publishedAt?: string;
}

interface GitHubRelease {
  draft?: boolean;
  prerelease?: boolean;
  tag_name?: string;
  html_url?: string;
  published_at?: string;
}

const RELEASES_API = import.meta.env.VITE_SANDBOX_RELEASES_API_URL
  ?? "https://api.github.com/repos/ChristianRelf/sandbox/releases?per_page=10";

export async function checkForDesktopUpdate(channel: "beta" | "stable", fetcher: typeof fetch = fetch): Promise<DesktopUpdate | undefined> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return undefined;
  try {
    const currentVersion = await getVersion();
    const response = await fetcher(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store"
    });
    if (!response.ok) return undefined;
    const releases = await response.json() as GitHubRelease[];
    return releases
      .filter(release => !release.draft && (channel === "beta" || !release.prerelease))
      .reduce<DesktopUpdate[]>((updates, release) => {
        const version = release.tag_name?.replace(/^v/, "");
        if (version && release.html_url && isNewerVersion(currentVersion, version)) updates.push({ version, releaseUrl: release.html_url, ...(release.published_at ? { publishedAt: release.published_at } : {}) });
        return updates;
      }, [])
      .sort((left, right) => compareVersions(right.version, left.version))[0];
  } catch {
    return undefined;
  }
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
