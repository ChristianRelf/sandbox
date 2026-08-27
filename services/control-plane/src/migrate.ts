import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined, max: 1 });
const client = await pool.connect();
const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

try {
  await client.query("SELECT pg_advisory_lock(hashtext('sandbox-control-plane-migrations'))");
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = (await readdir(migrationsDirectory)).filter(file => /^\d{3}_.+\.sql$/.test(file)).sort();
  for (const file of files) {
    const sql = await readFile(join(migrationsDirectory, file), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query<{ sha256: string }>(`SELECT sha256 FROM schema_migrations WHERE version = $1`, [file]);
    if (existing.rowCount) {
      if (existing.rows[0].sha256 !== sha256) throw new Error(`Applied migration ${file} was modified`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations(version, sha256) VALUES($1,$2)`, [file, sha256]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    process.stdout.write(`Applied ${file}\n`);
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('sandbox-control-plane-migrations'))").catch(() => undefined);
  client.release();
  await pool.end();
}
