const githubApiVersion = "2022-11-28";

export async function fetchReleases({ repository, token, signal, fetchImpl = fetch }) {
  const owner = encodeURIComponent(repository.owner);
  const name = encodeURIComponent(repository.name);
  const url = `https://api.github.com/repos/${owner}/${name}/releases?per_page=20`;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "sandbox-discord-changelog-bot/1.0",
    "X-GitHub-Api-Version": githubApiVersion,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl(url, { headers, signal });
  if (!response.ok) {
    const rateLimitReset = response.headers.get("x-ratelimit-reset");
    const resetMessage = response.status === 403 && rateLimitReset
      ? ` Rate limit resets at ${new Date(Number(rateLimitReset) * 1_000).toISOString()}.`
      : "";
    throw new Error(`GitHub Releases request failed with ${response.status}.${resetMessage}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("GitHub returned an unexpected releases response.");
  return data.map(normalizeRelease).filter(Boolean);
}

export function chooseReleasesToPost(releases, postedReleaseIds, options = {}) {
  const includePrereleases = options.includePrereleases ?? true;
  const eligible = releases
    .filter((release) => !release.draft && (includePrereleases || !release.prerelease))
    .sort((left, right) => Date.parse(left.publishedAt) - Date.parse(right.publishedAt));
  const posted = new Set(postedReleaseIds);
  return eligible.filter((release) => !posted.has(release.id));
}

function normalizeRelease(value) {
  if (!value || typeof value !== "object") return undefined;
  if ((typeof value.id !== "number" && typeof value.id !== "string")
    || typeof value.tag_name !== "string"
    || typeof value.html_url !== "string"
    || typeof value.published_at !== "string") return undefined;

  return Object.freeze({
    id: String(value.id),
    tag: value.tag_name,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : value.tag_name,
    url: value.html_url,
    body: typeof value.body === "string" ? value.body.trim() : "",
    publishedAt: value.published_at,
    draft: Boolean(value.draft),
    prerelease: Boolean(value.prerelease),
    assets: Array.isArray(value.assets) ? value.assets.map(normalizeAsset).filter(Boolean) : [],
  });
}

function normalizeAsset(value) {
  if (!value || typeof value !== "object"
    || typeof value.name !== "string"
    || typeof value.browser_download_url !== "string"
    || !value.browser_download_url.startsWith("https://")) return undefined;
  return Object.freeze({
    name: value.name,
    url: value.browser_download_url,
    size: typeof value.size === "number" ? value.size : 0,
  });
}
