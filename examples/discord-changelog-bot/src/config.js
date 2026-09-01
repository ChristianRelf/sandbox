import { resolve } from "node:path";

const discordSnowflake = /^\d{17,20}$/;
const githubName = /^[A-Za-z0-9_.-]+$/;

export function loadConfig(env = process.env, workingDirectory = process.cwd()) {
  const token = required(env, "DISCORD_TOKEN");
  const channelId = required(env, "DISCORD_CHANNEL_ID");
  if (!discordSnowflake.test(channelId)) {
    throw new Error("DISCORD_CHANNEL_ID must be a 17-20 digit Discord channel ID.");
  }

  const repository = parseRepository(env.GITHUB_REPOSITORY ?? "ChristianRelf/sandbox");
  const pollIntervalSeconds = integerInRange(
    env.POLL_INTERVAL_SECONDS ?? "300",
    "POLL_INTERVAL_SECONDS",
    60,
    86_400,
  );

  return Object.freeze({
    token,
    channelId,
    repository,
    githubToken: optional(env.GITHUB_TOKEN),
    pollIntervalMs: pollIntervalSeconds * 1_000,
    includePrereleases: boolean(env.INCLUDE_PRERELEASES, true, "INCLUDE_PRERELEASES"),
    postLatestOnStart: boolean(env.POST_LATEST_ON_START, true, "POST_LATEST_ON_START"),
    stateFile: resolve(workingDirectory, optional(env.STATE_FILE) ?? ".data/state.json"),
  });
}

export function parseRepository(value) {
  const normalized = String(value).trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\/$/, "")
    .replace(/\.git$/i, "");
  const parts = normalized.split("/");
  if (parts.length !== 2 || parts.some((part) => !githubName.test(part))) {
    throw new Error("GITHUB_REPOSITORY must use the owner/repository format.");
  }
  return Object.freeze({ owner: parts[0], name: parts[1], fullName: normalized });
}

function required(env, name) {
  const value = optional(env[name]);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function optional(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function integerInRange(value, name, minimum, maximum) {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a whole number.`);
  const number = Number(value);
  if (number < minimum || number > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function boolean(value, fallback, name) {
  if (value === undefined || value.trim() === "") return fallback;
  if (/^(true|1|yes)$/i.test(value)) return true;
  if (/^(false|0|no)$/i.test(value)) return false;
  throw new Error(`${name} must be true or false.`);
}
