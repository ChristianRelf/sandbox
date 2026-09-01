import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { randomUUID } from "node:crypto";

const ENTRY_CHUNK_BUDGET_BYTES = 400_000;
const ASYNC_CHUNK_BUDGET_BYTES = 300_000;

interface BugReportInput {
  summary: string;
  description: string;
  diagnostics: Record<string, string>;
}

function developmentWebhookUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "discord.com" ||
    !/^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)
  ) {
    throw new Error("The development bug-report webhook URL is invalid.");
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function submitDevelopmentBugReport(
  webhookUrl: string,
  report: BugReportInput,
) {
  const reportId = `BUG-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const diagnosticText = Object.entries(report.diagnostics)
    .slice(0, 10)
    .map(([key, value]) => `**${key.slice(0, 40)}:** ${value.slice(0, 300)}`)
    .join("\n")
    .slice(0, 1_024);
  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    { name: "Report ID", value: reportId, inline: true },
  ];
  if (diagnosticText) {
    fields.push({ name: "Diagnostics", value: diagnosticText, inline: false });
  }
  const discordResponse = await fetch(developmentWebhookUrl(webhookUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "sndbox-development/bug-reports",
    },
    body: JSON.stringify({
      username: "sndbox bug reports",
      allowed_mentions: { parse: [] },
      embeds: [{
        title: `Bug: ${report.summary.slice(0, 120)}`,
        description: report.description.slice(0, 2_000),
        color: 14_090_059,
        fields,
        footer: { text: "sndbox app reports • credentials and workflow content are never included" },
        timestamp: new Date().toISOString(),
      }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!discordResponse.ok) {
    throw new Error(`Discord returned HTTP ${discordResponse.status}.`);
  }
  return {
    delivered: true as const,
    provider: "discord" as const,
    status: discordResponse.status,
    reportId,
  };
}

function enforceBundleBudgets(): Plugin {
  return {
    name: "enforce-bundle-budgets",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        const bytes = new TextEncoder().encode(output.code).byteLength;
        const budget = output.isEntry ? ENTRY_CHUNK_BUDGET_BYTES : ASYNC_CHUNK_BUDGET_BYTES;
        if (bytes > budget) this.error(`${output.fileName} is ${bytes} bytes and exceeds its ${budget}-byte ${output.isEntry ? "entry" : "async"} budget.`);
      }
    },
  };
}

function developmentBugReports(): Plugin {
  return {
    name: "development-bug-reports",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname !== "/__sndbox/bug-reports") {
          next();
          return;
        }
        void (async () => {
          response.setHeader("content-type", "application/json");
          response.setHeader("cache-control", "no-store");
          if (request.method !== "POST") {
            response.statusCode = 405;
            response.end(JSON.stringify({ error: "Method not allowed." }));
            return;
          }
          const webhookUrl = process.env.BUG_REPORT_DISCORD_WEBHOOK_URL;
          if (!webhookUrl) {
            response.statusCode = 503;
            response.end(JSON.stringify({ error: "The development bug-report webhook is not configured." }));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            const value = Buffer.from(chunk);
            size += value.length;
            if (size > 32 * 1024) {
              response.statusCode = 413;
              response.end(JSON.stringify({ error: "Bug report is too large." }));
              return;
            }
            chunks.push(value);
          }
          let value: unknown;
          try {
            value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "Bug report must be valid JSON." }));
            return;
          }
          const record = value && typeof value === "object" && !Array.isArray(value)
            ? value as Record<string, unknown>
            : {};
          const summary = typeof record.summary === "string" ? record.summary.trim() : "";
          const description = typeof record.description === "string" ? record.description.trim() : "";
          const diagnosticValue = record.diagnostics;
          const diagnostics = diagnosticValue && typeof diagnosticValue === "object" && !Array.isArray(diagnosticValue)
            ? Object.fromEntries(Object.entries(diagnosticValue).filter(([key, item]) => key.length <= 40 && typeof item === "string").slice(0, 10))
            : {};
          if (summary.length < 4 || summary.length > 120 || description.length < 10 || description.length > 2_000) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "Complete both bug-report fields." }));
            return;
          }
          try {
            const report: BugReportInput = { summary, description, diagnostics };
            const receipt = await submitDevelopmentBugReport(webhookUrl, report);
            response.statusCode = 200;
            response.end(JSON.stringify(receipt));
          } catch {
            response.statusCode = 502;
            response.end(JSON.stringify({ error: "The bug report could not be delivered." }));
          }
        })();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), developmentBugReports(), enforceBundleBudgets()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2021", minify: "esbuild", sourcemap: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "packages/content/src/**/*.{test,spec}.{ts,tsx}"],
  }
});
