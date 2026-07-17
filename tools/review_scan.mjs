// Scan David's vaults for #review-tagged notes/sections and draft
// flashcards into the approval queue. Idempotent: unchanged content
// never re-queues or duplicates.
//
// Usage: node tools/review_scan.mjs
// Override paths for testing: node tools/review_scan.mjs --queue <f> --bank <f> --vault LABEL=DIR ...

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scanVault, generateCards, parseQueue, renderQueue, mergeQueue } from "./review_lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_VAULTS = [
  ["PURPL", "C:/Users/DATar/Purpl/Obsidian/PURPL"],
  ["Crystal", "C:/Users/DATar/Sanity/Obsidian/Crystal"],
  ["Abroad", "C:/Users/DATar/nonrev/Obsidian/Abroad"],
];
const DEFAULT_QUEUE = "C:/Users/DATar/Sanity/Obsidian/Crystal/System/Review-Queue.md";
const DEFAULT_BANK = join(ROOT, "data", "review.json");

function parseArgs(argv) {
  const opts = { queue: DEFAULT_QUEUE, bank: DEFAULT_BANK, vaults: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--queue") opts.queue = argv[++i];
    else if (argv[i] === "--bank") opts.bank = argv[++i];
    else if (argv[i] === "--vault") {
      const [label, dir] = argv[++i].split("=");
      opts.vaults.push([label, dir]);
    }
  }
  if (!opts.vaults.length) opts.vaults = DEFAULT_VAULTS;
  return opts;
}

export function runScan({ queue, bank, vaults }) {
  const blocks = vaults.flatMap(([label, dir]) => scanVault(dir, label));
  const generated = blocks.flatMap(generateCards);

  const existing = existsSync(queue) ? parseQueue(readFileSync(queue, "utf8")) : [];
  const bankIds = new Set(
    existsSync(bank) ? (JSON.parse(readFileSync(bank, "utf8")).cards || []).map((c) => c.id) : [],
  );

  const before = existing.length;
  const merged = mergeQueue(existing, generated, bankIds);
  mkdirSync(dirname(queue), { recursive: true });
  writeFileSync(queue, renderQueue(merged));
  return { blocks: blocks.length, generated: generated.length, added: merged.length - before, total: merged.length };
}

// Run only when invoked as a CLI (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = runScan(parseArgs(process.argv.slice(2)));
  console.log(
    `scanned ${r.blocks} tagged blocks, generated ${r.generated} cards, ` +
      `added ${r.added} new to the queue (${r.total} total pending/approved).`,
  );
}
