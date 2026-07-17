// Import approved cards from the review queue into data/review.json.
// Merge by id, add or update, never drop (progress is keyed on id).
//
// Usage: node tools/review_import.mjs
// Override for testing: node tools/review_import.mjs --queue <f> --bank <f>

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseQueue, mergeBank } from "./review_lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_QUEUE = "C:/Users/DATar/Sanity/Obsidian/Crystal/System/Review-Queue.md";
const DEFAULT_BANK = join(ROOT, "data", "review.json");

function parseArgs(argv) {
  const opts = { queue: DEFAULT_QUEUE, bank: DEFAULT_BANK };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--queue") opts.queue = argv[++i];
    else if (argv[i] === "--bank") opts.bank = argv[++i];
  }
  return opts;
}

export function runImport({ queue, bank }) {
  if (!existsSync(queue)) throw new Error("queue not found: " + queue);
  const approved = parseQueue(readFileSync(queue, "utf8")).filter((c) => c.approved);
  const existing = existsSync(bank) ? JSON.parse(readFileSync(bank, "utf8")).cards || [] : [];
  const { cards, added, updated } = mergeBank(existing, approved);
  const out = { app: "bonmot-review", version: 1, generatedAt: new Date().toISOString().slice(0, 10), cards };
  mkdirSync(dirname(bank), { recursive: true });
  writeFileSync(bank, JSON.stringify(out, null, 1));
  return { approved: approved.length, added, updated, total: cards.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = runImport(parseArgs(process.argv.slice(2)));
  console.log(
    `approved ${r.approved} cards: ${r.added} added, ${r.updated} updated. ` +
      `Review deck now holds ${r.total} cards. Reload Bonmot to pick them up.`,
  );
}
