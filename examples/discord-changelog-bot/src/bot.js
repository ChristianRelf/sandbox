import { Client, Events, GatewayIntentBits } from "discord.js";
import { buildReleaseMessage } from "./format.js";
import { chooseReleasesToPost, fetchReleases } from "./github.js";
import { loadState, rememberReleases, saveState } from "./state.js";

export function createBot(config, dependencies = {}) {
  const client = dependencies.client ?? new Client({ intents: [GatewayIntentBits.Guilds] });
  const getReleases = dependencies.fetchReleases ?? fetchReleases;
  let timer;
  let polling = false;
  let stopped = false;

  async function poll() {
    if (polling || stopped) return;
    polling = true;
    try {
      const loaded = await loadState(config.stateFile);
      const releases = await getReleases({
        repository: config.repository,
        token: config.githubToken,
        signal: AbortSignal.timeout(15_000),
      });
      const eligible = releases.filter((release) => !release.draft
        && (config.includePrereleases || !release.prerelease));

      if (!loaded.initialized) {
        if (config.postLatestOnStart && eligible.length > 0) {
          const latest = [...eligible]
            .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))[0];
          await postRelease(latest);
        }
        await saveState(config.stateFile, rememberReleases(loaded.value, eligible.map((release) => release.id)));
        return;
      }

      let state = loaded.value;
      const unposted = chooseReleasesToPost(releases, state.postedReleaseIds, {
        includePrereleases: config.includePrereleases,
      });
      for (const release of unposted) {
        await postRelease(release);
        state = rememberReleases(state, [release.id]);
        await saveState(config.stateFile, state);
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Changelog poll failed:`, error);
    } finally {
      polling = false;
    }
  }

  async function postRelease(release) {
    const channel = await client.channels.fetch(config.channelId);
    if (!channel || typeof channel.send !== "function") {
      throw new Error(`Discord channel ${config.channelId} is not a sendable text channel.`);
    }
    await channel.send(buildReleaseMessage(release, config.repository.fullName));
    console.log(`[${new Date().toISOString()}] Posted ${release.tag} to channel ${config.channelId}.`);
  }

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}; watching ${config.repository.fullName}.`);
    await poll();
    if (!stopped) timer = setInterval(() => void poll(), config.pollIntervalMs);
  });
  client.on(Events.Error, (error) => console.error("Discord client error:", error));

  return {
    async start() {
      await client.login(config.token);
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      client.destroy();
    },
    poll,
  };
}
