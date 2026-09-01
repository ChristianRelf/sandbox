import dotenv from "dotenv";
import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";

dotenv.config({ quiet: true });

try {
  const config = loadConfig();
  const bot = createBot(config);
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down.`);
    await bot.stop();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  await bot.start();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
