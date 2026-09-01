import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBot } from "../src/bot.js";

function release(id, publishedAt) {
  return {
    id,
    tag: `v${id}.0.0`,
    name: `Release ${id}`,
    url: `https://github.com/owner/project/releases/tag/v${id}.0.0`,
    body: `Changes in release ${id}`,
    publishedAt,
    draft: false,
    prerelease: false,
    assets: [],
  };
}

test("polling posts the latest release on first run and never duplicates it", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "changelog-bot-poll-"));
  const sent = [];
  const client = new EventEmitter();
  client.channels = { fetch: async () => ({ send: async (message) => sent.push(message) }) };
  client.login = async () => "token";
  client.destroy = () => {};

  let releases = [
    release("1", "2026-01-01T00:00:00Z"),
    release("2", "2026-02-01T00:00:00Z"),
  ];
  const bot = createBot({
    token: "discord-token",
    channelId: "123456789012345678",
    repository: { owner: "owner", name: "project", fullName: "owner/project" },
    githubToken: undefined,
    pollIntervalMs: 300_000,
    includePrereleases: true,
    postLatestOnStart: true,
    stateFile: join(stateDirectory, "state.json"),
  }, {
    client,
    fetchReleases: async () => releases,
  });

  await bot.poll();
  await bot.poll();
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /v2\\\.0\\\.0/);

  releases = [...releases, release("3", "2026-03-01T00:00:00Z")];
  await bot.poll();
  await bot.poll();
  assert.equal(sent.length, 2);
  assert.match(sent[1].content, /v3\\\.0\\\.0/);

  await bot.stop();
});
