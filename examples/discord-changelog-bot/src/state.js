import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const emptyState = () => ({ schemaVersion: 1, postedReleaseIds: [] });

export async function loadState(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (value?.schemaVersion !== 1 || !Array.isArray(value.postedReleaseIds)
      || value.postedReleaseIds.some((id) => typeof id !== "string")) {
      throw new Error("The state file has an unsupported format.");
    }
    return { initialized: true, value };
  } catch (error) {
    if (error?.code === "ENOENT") return { initialized: false, value: emptyState() };
    throw new Error(`Could not load state from ${path}: ${error.message}`, { cause: error });
  }
}

export function rememberReleases(state, releaseIds) {
  const combined = [...state.postedReleaseIds, ...releaseIds];
  return {
    schemaVersion: 1,
    postedReleaseIds: [...new Set(combined)].slice(-200),
  };
}

export async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}
