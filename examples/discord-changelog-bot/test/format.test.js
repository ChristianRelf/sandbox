import assert from "node:assert/strict";
import test from "node:test";
import { buildChangelog, buildReleaseMessage } from "../src/format.js";

const release = {
  id: "42",
  tag: "v1.2.3-beta.1",
  name: "A useful update",
  url: "https://github.com/owner/project/releases/tag/v1.2.3-beta.1",
  body: "- Added a feature\n- Fixed a bug",
  publishedAt: "2026-01-02T12:00:00Z",
  prerelease: true,
  draft: false,
  assets: [{
    name: "installer.exe",
    size: 2_097_152,
    url: "https://github.com/owner/project/releases/download/v1.2.3-beta.1/installer.exe",
  }],
};

test("buildReleaseMessage includes an embed, changelog file, and links", () => {
  const message = buildReleaseMessage(release, "owner/project");
  assert.equal(message.embeds.length, 1);
  assert.equal(message.files[0].name, "changelog-v1.2.3-beta.1.md");
  assert.equal(message.components[0].components.length, 2);
  assert.deepEqual(message.allowedMentions, { parse: [] });
});

test("buildChangelog includes release notes and downloadable assets", () => {
  const changelog = buildChangelog(release, "owner/project");
  assert.match(changelog, /Added a feature/);
  assert.match(changelog, /installer\\\.exe/);
  assert.match(changelog, /2\.0 MB/);
});
