import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadState, rememberReleases, saveState } from "../src/state.js";

test("state persists posted releases without duplicates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "changelog-bot-"));
  const path = join(directory, "nested", "state.json");
  const missing = await loadState(path);
  assert.equal(missing.initialized, false);

  const state = rememberReleases(missing.value, ["1", "2", "1"]);
  await saveState(path, state);
  const loaded = await loadState(path);
  assert.equal(loaded.initialized, true);
  assert.deepEqual(loaded.value.postedReleaseIds, ["1", "2"]);
  assert.match(await readFile(path, "utf8"), /"schemaVersion": 1/);
});
