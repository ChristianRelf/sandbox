import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, parseRepository } from "../src/config.js";

test("parseRepository accepts shorthand and GitHub URLs", () => {
  assert.equal(parseRepository("owner/project").fullName, "owner/project");
  assert.equal(parseRepository("https://github.com/owner/project.git").fullName, "owner/project");
  assert.equal(parseRepository("https://github.com/owner/project.git/").fullName, "owner/project");
});

test("loadConfig supplies safe polling defaults", () => {
  const config = loadConfig({
    DISCORD_TOKEN: "secret",
    DISCORD_CHANNEL_ID: "123456789012345678",
  }, "C:/bot");
  assert.equal(config.repository.fullName, "ChristianRelf/sandbox");
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.includePrereleases, true);
  assert.equal(config.postLatestOnStart, true);
  assert.equal(config.healthFile, undefined);
});

test("loadConfig rejects polling that would exhaust the GitHub API limit", () => {
  assert.throws(() => loadConfig({
    DISCORD_TOKEN: "secret",
    DISCORD_CHANNEL_ID: "123456789012345678",
    POLL_INTERVAL_SECONDS: "10",
  }), /between 60 and 86400/);
});
