import { randomUUID } from "node:crypto";
import { DomainError } from "./types.js";

export interface BugReportInput {
  summary: string;
  description: string;
  diagnostics: Record<string, string>;
}

export interface BugReportReceipt {
  delivered: true;
  provider: "discord";
  status: number;
  reportId: string;
}

export interface BugReportSink {
  submit(report: BugReportInput): Promise<BugReportReceipt>;
}

const limited = (value: string, maximum: number): string =>
  value.trim().slice(0, maximum);

export function formatDiscordBugReport(
  report: BugReportInput,
  reportId: string,
  submittedAt = new Date()
): Record<string, unknown> {
  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    { name: "Report ID", value: reportId, inline: true }
  ];
  const diagnostics = Object.entries(report.diagnostics)
    .slice(0, 10)
    .map(([key, value]) => `**${limited(key, 40)}:** ${limited(value, 300)}`)
    .join("\n");
  if (diagnostics) {
    fields.push({ name: "Diagnostics", value: limited(diagnostics, 1_024), inline: false });
  }
  return {
    username: "sndbox bug reports",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `Bug: ${limited(report.summary, 120)}`,
      description: limited(report.description, 2_000),
      color: 14_090_059,
      fields,
      footer: { text: "sndbox app reports • credentials and workflow content are never included" },
      timestamp: submittedAt.toISOString()
    }]
  };
}

export class DiscordBugReportSink implements BugReportSink {
  private readonly webhookUrl: string;

  constructor(webhookUrl: string, private readonly request: typeof fetch = fetch) {
    let parsed: URL;
    try {
      parsed = new URL(webhookUrl);
    } catch {
      throw new Error("BUG_REPORT_DISCORD_WEBHOOK_URL must be a valid URL.");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "discord.com" ||
      !/^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(parsed.pathname)
    ) {
      throw new Error("BUG_REPORT_DISCORD_WEBHOOK_URL must be an HTTPS discord.com webhook URL.");
    }
    parsed.search = "";
    parsed.hash = "";
    this.webhookUrl = parsed.toString();
  }

  async submit(report: BugReportInput): Promise<BugReportReceipt> {
    const reportId = `BUG-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const response = await this.request(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "sndbox-control-plane/bug-reports" },
      body: JSON.stringify(formatDiscordBugReport(report, reportId)),
      signal: AbortSignal.timeout(10_000)
    }).catch(error => {
      throw new DomainError("bug_report_delivery_failed", `Discord delivery failed: ${error instanceof Error ? error.message : "network error"}.`, 502);
    });
    if (!response.ok) {
      throw new DomainError("bug_report_delivery_failed", `Discord returned HTTP ${response.status}.`, 502);
    }
    return { delivered: true, provider: "discord", status: response.status, reportId };
  }
}
