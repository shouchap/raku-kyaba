#!/usr/bin/env node
/**
 * 手動で SQL Editor 実行済みのマイグレーションを、
 * Supabase の履歴テーブル上でも「applied」に揃える（初回だけ）。
 *
 * 使い方:
 *   1. npx supabase login
 *   2. npm run db:link
 *   3. npm run db:repair-applied
 */
import { readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error("No migration files found.");
  process.exit(1);
}

console.log(`Marking ${files.length} migrations as applied on linked remote...\n`);

let failed = 0;
for (const file of files) {
  // 001_initial_schema.sql -> 001
  const version = basename(file, ".sql").split("_")[0];
  if (!version) {
    console.error(`Skip (no version): ${file}`);
    failed += 1;
    continue;
  }
  console.log(`repair ${version} (${file})`);
  const r = spawnSync(
    "npx",
    ["supabase", "migration", "repair", version, "--status", "applied"],
    { stdio: "inherit", shell: process.platform === "win32" }
  );
  if (r.status !== 0) {
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`\nCompleted with ${failed} error(s).`);
  process.exit(1);
}

console.log("\nDone. Next: npm run db:status");
