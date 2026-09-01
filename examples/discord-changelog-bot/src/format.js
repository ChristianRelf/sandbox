import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

const embedDescriptionLimit = 3_600;
const embedFieldLimit = 1_024;
const changelogAttachmentLimit = 1_000_000;

export function buildReleaseMessage(release, repositoryName) {
  const description = truncate(
    release.body || "No changelog text was provided for this release.",
    embedDescriptionLimit,
  );
  const embed = new EmbedBuilder()
    .setColor(release.prerelease ? 0xf0a832 : 0x57f287)
    .setTitle(truncate(release.name, 256))
    .setURL(release.url)
    .setDescription(description)
    .addFields(
      { name: "Version", value: inlineCode(release.tag), inline: true },
      { name: "Published", value: discordTimestamp(release.publishedAt), inline: true },
    )
    .setAuthor({ name: repositoryName })
    .setFooter({ text: release.prerelease ? "Pre-release" : "Stable release" })
    .setTimestamp(new Date(release.publishedAt));

  if (release.assets.length > 0) {
    embed.addFields({
      name: "Downloads",
      value: truncate(release.assets.map(formatAssetLink).join("\n"), embedFieldLimit),
    });
  }

  const changelog = limitUtf8(buildChangelog(release, repositoryName), changelogAttachmentLimit);
  const attachment = new AttachmentBuilder(Buffer.from(changelog), {
    name: `changelog-${safeFilename(release.tag)}.md`,
    description: `Full changelog for ${release.tag}`,
  });

  const buttons = [
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Release notes").setURL(release.url),
    ...release.assets.slice(0, 4).map((asset) => new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(truncate(asset.name, 80))
      .setURL(asset.url)),
  ];

  return {
    content: `New ${release.prerelease ? "pre-release" : "release"}: **${escapeMarkdown(release.tag)}**`,
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(buttons)],
    files: [attachment],
    allowedMentions: { parse: [] },
  };
}

export function buildChangelog(release, repositoryName) {
  const downloads = release.assets.length > 0
    ? release.assets.map((asset) => `- [${escapeMarkdown(asset.name)}](${asset.url}) (${formatBytes(asset.size)})`).join("\n")
    : "No downloadable files are attached to this release.";
  return `# ${release.name}\n\n`
    + `- Repository: ${repositoryName}\n`
    + `- Version: ${release.tag}\n`
    + `- Published: ${release.publishedAt}\n`
    + `- Release page: ${release.url}\n\n`
    + `## Changelog\n\n${release.body || "No changelog text was provided for this release."}\n\n`
    + `## Downloads\n\n${downloads}\n`;
}

function formatAssetLink(asset) {
  return `[${escapeMarkdown(asset.name)}](${asset.url}) · ${formatBytes(asset.size)}`;
}

function discordTimestamp(value) {
  const seconds = Math.floor(Date.parse(value) / 1_000);
  return Number.isFinite(seconds) ? `<t:${seconds}:R>` : "Unknown";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "size unknown";
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1_024)), units.length - 1);
  const amount = bytes / (1_024 ** unit);
  return `${amount.toFixed(unit === 0 || amount >= 10 ? 0 : 1)} ${units[unit]}`;
}

function truncate(value, maximum) {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum - 1).trimEnd()}…`;
}

function inlineCode(value) {
  return `\`${String(value).replaceAll("`", "ˋ")}\``;
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\`*_{}\[\]()<>#+.!|~-])/g, "\\$1");
}

function safeFilename(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100) || "release";
}

function limitUtf8(value, maximumBytes) {
  const encoded = Buffer.from(value);
  if (encoded.length <= maximumBytes) return value;
  return `${new TextDecoder().decode(encoded.subarray(0, maximumBytes - 64))}\n\n[Changelog truncated]\n`;
}
