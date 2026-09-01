# Discord changelog bot

A small Discord.js bot that watches GitHub Releases. When a new release appears,
it posts:

- an embed with the changelog and release metadata;
- direct buttons and links for release downloads; and
- the complete changelog as a Markdown file attachment.

Posted release IDs are saved in `.data/state.json`, so restarting the bot does
not create duplicate announcements. On a brand-new installation, the current
latest release is posted once by default.

## Set up Discord

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications), then open **Bot** and create its bot user.
2. Copy/reset the bot token. Never commit or share this token.
3. Under **Installation**, enable a server/guild install with the `bot` scope.
4. Grant only **View Channels**, **Send Messages**, **Embed Links**, and **Attach Files**, then use the install link to add the bot to your server.
5. In Discord, enable Developer Mode, right-click the destination channel, and choose **Copy Channel ID**.

No privileged gateway intents (including Message Content) are needed.

## Run locally

Node.js 20 or newer is required.

```powershell
cd examples/discord-changelog-bot
Copy-Item .env.example .env
npm install
```

Edit `.env` with your bot token and channel ID, then start it:

```powershell
npm start
```

The default repository is `ChristianRelf/sandbox`. Change
`GITHUB_REPOSITORY=owner/repository` to watch another repository. Set an
optional `GITHUB_TOKEN` for a private repository or a higher API rate limit.

## First-run behaviour

`POST_LATEST_ON_START=true` makes setup easy to verify: the newest eligible
release is announced on the first run, then only future releases are posted.
Set it to `false` to silently establish the current release baseline instead.

Pre-releases are included by default because this repository currently ships a
beta. Set `INCLUDE_PRERELEASES=false` to announce only stable releases.

To deliberately re-announce the latest release, stop the bot and remove
`.data/state.json` before starting it again.

## Run with Docker

Build the image and preserve the duplicate-prevention state in a volume:

```powershell
docker build -t discord-changelog-bot .
docker run --env-file .env -v changelog-bot-data:/app/.data discord-changelog-bot
```

The process must stay running to detect releases. A small VPS, home server,
container host, or process manager such as systemd/PM2 can keep it online.

## Verify

```powershell
npm test
npm run check
```

The bot polls GitHub every five minutes by default. Polling is intentionally
limited to no faster than once per minute to avoid exhausting GitHub's API rate
limit. If a Discord post fails, that release is not recorded and will be retried
on the next poll.
