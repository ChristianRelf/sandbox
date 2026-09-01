import assert from "node:assert/strict";
import test from "node:test";
import { chooseReleasesToPost, fetchReleases } from "../src/github.js";

const releases = [
  { id: "3", publishedAt: "2026-03-03T00:00:00Z", draft: false, prerelease: false },
  { id: "1", publishedAt: "2026-01-01T00:00:00Z", draft: false, prerelease: false },
  { id: "2", publishedAt: "2026-02-02T00:00:00Z", draft: false, prerelease: true },
  { id: "4", publishedAt: "2026-04-04T00:00:00Z", draft: true, prerelease: false },
];

test("chooseReleasesToPost returns unseen releases oldest first", () => {
  assert.deepEqual(
    chooseReleasesToPost(releases, ["1"]).map((release) => release.id),
    ["2", "3"],
  );
});

test("chooseReleasesToPost can exclude prereleases", () => {
  assert.deepEqual(
    chooseReleasesToPost(releases, [], { includePrereleases: false }).map((release) => release.id),
    ["1", "3"],
  );
});

test("fetchReleases normalizes the GitHub response and sends API headers", async () => {
  let request;
  const result = await fetchReleases({
    repository: { owner: "owner", name: "project" },
    token: "github-token",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify([{
        id: 42,
        tag_name: "v1.0.0",
        name: "First release",
        html_url: "https://github.com/owner/project/releases/tag/v1.0.0",
        body: "Changes",
        published_at: "2026-01-01T00:00:00Z",
        draft: false,
        prerelease: false,
        assets: [{
          name: "app.zip",
          size: 1_024,
          browser_download_url: "https://github.com/owner/project/releases/download/v1.0.0/app.zip",
        }],
      }]), { status: 200 });
    },
  });

  assert.match(request.url, /\/repos\/owner\/project\/releases\?per_page=20$/);
  assert.equal(request.options.headers.Authorization, "Bearer github-token");
  assert.equal(result[0].id, "42");
  assert.equal(result[0].assets[0].name, "app.zip");
});
