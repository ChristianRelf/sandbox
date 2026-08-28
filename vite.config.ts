import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

const ENTRY_CHUNK_BUDGET_BYTES = 400_000;
const ASYNC_CHUNK_BUDGET_BYTES = 300_000;

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

export default defineConfig({
  plugins: [react(), enforceBundleBudgets()],
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
