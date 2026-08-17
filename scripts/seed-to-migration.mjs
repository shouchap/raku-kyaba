#!/usr/bin/env node
/**
 * supabase/seeds/*.sql を supabase/migrations/ へ連番付きでコピーする。
 *
 * migrations に置くと push だけで GitHub Actions が本番へ自動適用するため、
 * SQL Editor への貼り付けが不要になる。
 *
 * 使い方:
 *   npm run db:seed-to-migration -- attendance_schedules_2026_08_16_31.sql
 *   npm run db:seed-to-migration -- --all
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedsDir = path.join(rootDir, "supabase", "seeds");
const migrationsDir = path.join(rootDir, "supabase", "migrations");

/** db push は各ファイルを1トランザクションで実行するため、明示的な BEGIN/COMMIT は除去する */
function stripTransactionStatements(sql) {
  return sql
    .split("\n")
    .filter((line) => !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$/i.test(line))
    .join("\n");
}

function nextSequenceNumber() {
  const used = readdirSync(migrationsDir)
    .map((name) => Number.parseInt(name.slice(0, 3), 10))
    .filter((n) => Number.isInteger(n));
  const max = used.length > 0 ? Math.max(...used) : 0;
  return String(max + 1).padStart(3, "0");
}

function alreadyMigrated(seedName) {
  const base = seedName.replace(/\.sql$/i, "");
  return readdirSync(migrationsDir).some((name) => name.includes(base));
}

function convert(seedName, sequence) {
  const seedPath = path.join(seedsDir, seedName);
  if (!existsSync(seedPath)) {
    throw new Error(`seed が見つかりません: ${seedPath}`);
  }

  const body = stripTransactionStatements(readFileSync(seedPath, "utf8"));
  const target = path.join(migrationsDir, `${sequence}_seed_${seedName}`);
  const header = [
    `-- supabase/seeds/${seedName} から自動生成（npm run db:seed-to-migration）`,
    "-- push すると GitHub Actions が本番へ適用します。",
    "",
  ].join("\n");

  writeFileSync(target, `${header}${body}`, "utf8");
  return path.relative(rootDir, target);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    "使い方: npm run db:seed-to-migration -- <seedファイル名>  または  -- --all"
  );
  process.exit(1);
}

const targets =
  args[0] === "--all"
    ? readdirSync(seedsDir).filter((n) => n.endsWith(".sql"))
    : args;

let sequence = Number.parseInt(nextSequenceNumber(), 10);
const created = [];

for (const seedName of targets) {
  if (alreadyMigrated(seedName)) {
    console.log(`skip（適用済み）: ${seedName}`);
    continue;
  }
  created.push(convert(seedName, String(sequence).padStart(3, "0")));
  sequence += 1;
}

if (created.length === 0) {
  console.log("新規に作成したマイグレーションはありません。");
} else {
  console.log("作成しました:");
  for (const file of created) console.log(`  ${file}`);
  console.log("\nこの後 git push すると本番DBへ自動適用されます。");
}
