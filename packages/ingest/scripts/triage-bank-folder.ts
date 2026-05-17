/**
 * One-shot triage: classify every file at the root of `Documents/bank/` by
 * filename and move it into the appropriate `archive/<source>/` subfolder.
 * Creates the folder structure if it doesn't exist.
 *
 * Dry-run by default — prints the proposed plan without touching anything.
 * Pass `--apply` to actually move the files.
 *
 * Usage:
 *   pnpm tsx scripts/triage-bank-folder.ts                     # dry-run
 *   pnpm tsx scripts/triage-bank-folder.ts --apply             # do it
 *   pnpm tsx scripts/triage-bank-folder.ts /path/to/bank-dir   # different root
 *
 * Idempotent: re-running on an already-organized folder is a no-op (files in
 * archive/ subfolders are skipped because we only scan the root level).
 *
 * Hash-aware: when two root files have identical content (e.g. duplicate
 * PhonePe downloads under "(1)" and " 2" naming), keeps the one with the
 * shortest filename and moves the rest to `archive/<source>/duplicates/`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { classifyByFilename, type SourceType } from "../src/classify";

const TARGET_DIRS: Record<SourceType | "unparsed", string> = {
  hdfc_savings: "archive/hdfc-savings",
  hdfc_cc: "archive/hdfc-cc",
  hdfc_fd: "archive/hdfc-fd",
  phonepe: "archive/phonepe",
  gpay: "archive/gpay",
  cred: "archive/cred",
  swiggy: "archive/swiggy",
  zomato: "archive/zomato",
  unparsed: "unparsed",
};

interface PlannedMove {
  src: string;
  dst: string;
  sourceType: SourceType | "unparsed";
  reason: string;
  isDuplicate: boolean;
}

function planMoves(root: string): PlannedMove[] {
  const entries = readdirSync(root)
    .filter((name) => !name.startsWith("."))
    .filter((name) => {
      const full = join(root, name);
      return statSync(full).isFile();
    })
    .map((name) => join(root, name));

  // Hash each file once so we can detect duplicate content under different
  // names (PhonePe "Statement.pdf" vs "Statement (1).pdf").
  const byHash = new Map<string, string[]>();
  for (const path of entries) {
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    byHash.set(hash, [...(byHash.get(hash) ?? []), path]);
  }

  const moves: PlannedMove[] = [];
  for (const [, paths] of byHash) {
    // Pick the "primary" file: shortest basename → presumed original. Others
    // become duplicates.
    const sorted = [...paths].sort((a, b) => basename(a).length - basename(b).length);
    const primary = sorted[0]!;
    const duplicates = sorted.slice(1);

    const classified = classifyByFilename(primary);
    const sourceType: SourceType | "unparsed" = classified?.sourceType ?? "unparsed";
    const baseDir = TARGET_DIRS[sourceType];

    moves.push({
      src: primary,
      dst: join(root, baseDir, basename(primary)),
      sourceType,
      reason: classified ? `classified as ${sourceType}` : "no classifier match",
      isDuplicate: false,
    });

    for (const dup of duplicates) {
      moves.push({
        src: dup,
        dst: join(root, baseDir, "duplicates", basename(dup)),
        sourceType,
        reason: `byte-identical to ${basename(primary)}`,
        isDuplicate: true,
      });
    }
  }

  return moves.sort((a, b) => a.src.localeCompare(b.src));
}

function printPlan(moves: PlannedMove[], root: string) {
  const counts = new Map<string, number>();
  for (const m of moves) {
    counts.set(m.sourceType, (counts.get(m.sourceType) ?? 0) + 1);
  }

  console.log(`\n# Triage plan for ${root}\n`);
  for (const m of moves) {
    const flag = m.isDuplicate ? "[dup]" : `[${m.sourceType}]`;
    console.log(`  ${flag.padEnd(16)} ${basename(m.src)}`);
    console.log(`  ${" ".repeat(16)} → ${m.dst.replace(root + "/", "")}`);
  }

  console.log("\n# Summary:");
  for (const [src, count] of [...counts.entries()].sort()) {
    console.log(`  ${src.padEnd(16)} ${count}`);
  }
  console.log(`  ${"TOTAL".padEnd(16)} ${moves.length}\n`);
}

function applyMoves(moves: PlannedMove[]) {
  // Pre-create every target directory.
  const dirs = new Set(moves.map((m) => m.dst.replace(/\/[^/]+$/, "")));
  for (const d of dirs) mkdirSync(d, { recursive: true });

  let ok = 0;
  let failed = 0;
  for (const m of moves) {
    try {
      renameSync(m.src, m.dst);
      ok++;
    } catch (e) {
      console.error(`FAILED ${m.src} → ${m.dst}: ${(e as Error).message}`);
      failed++;
    }
  }
  console.log(`\nMoved ${ok} file(s); failures: ${failed}`);
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const root = args.find((a) => !a.startsWith("--")) ?? "/Users/prateek/Documents/bank";

  const moves = planMoves(root);
  printPlan(moves, root);

  if (!apply) {
    console.log("DRY RUN — re-run with --apply to actually move the files.");
    return;
  }

  applyMoves(moves);
}

main();
