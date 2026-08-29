export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    await import("@opentelemetry/auto-instrumentations-node/register");
  }
}
