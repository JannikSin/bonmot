// Word-bank build tool. Merges generated batches, enforces the schema,
// dedupes, hard-fails on em/en dashes, cross-checks every word against
// dictionaryapi.dev (existence + IPA + definition-originality overlap),
// and writes data/en.json plus a human report.
//
// Usage: node tools/validate_bank.mjs <batch-dir> [--no-net]

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const batchDir = process.argv[2];
const noNet = process.argv.includes("--no-net");
if (!batchDir) {
  console.error("usage: node tools/validate_bank.mjs <batch-dir> [--no-net]");
  process.exit(1);
}

const REQUIRED = ["id", "word", "pos", "definitions", "examples", "etymology", "tier"];
const OPTIONAL = ["roots", "synonyms", "register", "ipa"];
const POS = new Set(["adjective", "noun", "verb", "adverb"]);
const REGISTERS = new Set(["formal", "literary", "academic", "conversational", "archaic"]);

const errors = [];
const warnings = [];
const entries = [];
const seen = new Map();

// Merge-not-replace: the existing bank is the base. Batches ADD new
// entries or UPDATE existing ids; nothing already shipped is ever
// dropped, so user progress (keyed on id) is safe across regenerations.
const bankPath = join(ROOT, "data", "en.json");
const existing = new Map();
try {
  const prev = JSON.parse(readFileSync(bankPath, "utf8"));
  for (const w of prev.words) existing.set(w.id, w);
  console.log(`merging over existing bank: ${existing.size} entries`);
} catch {
  console.log("no existing bank, building fresh");
}

for (const f of readdirSync(batchDir).filter((f) => f.startsWith("batch-") && f.endsWith(".json"))) {
  const arr = JSON.parse(readFileSync(join(batchDir, f), "utf8"));
  for (const e of arr) {
    const where = `${f}:${e && e.id}`;
    if (!e || typeof e !== "object") {
      errors.push(`${where}: not an object`);
      continue;
    }
    for (const k of REQUIRED) {
      if (!(k in e)) errors.push(`${where}: missing ${k}`);
    }
    for (const k of Object.keys(e)) {
      if (!REQUIRED.includes(k) && !OPTIONAL.includes(k)) {
        warnings.push(`${where}: dropping unknown key ${k}`);
        delete e[k];
      }
    }
    if (typeof e.id !== "string" || !/^[a-z][a-z-]*$/.test(e.id))
      errors.push(`${where}: bad id`);
    if (!POS.has(e.pos)) errors.push(`${where}: bad pos ${e.pos}`);
    if (!Array.isArray(e.definitions) || e.definitions.length < 1 || e.definitions.length > 2)
      errors.push(`${where}: definitions must be 1-2`);
    if (!Array.isArray(e.examples) || e.examples.length !== 2)
      errors.push(`${where}: examples must be exactly 2`);
    if (![1, 2, 3, 4].includes(e.tier)) errors.push(`${where}: bad tier ${e.tier}`);
    if (e.register && !REGISTERS.has(e.register))
      warnings.push(`${where}: nonstandard register ${e.register}`);
    const text = JSON.stringify(e);
    if (text.includes("\u2014") || text.includes("\u2013"))
      errors.push(`${where}: EM/EN DASH found (hard fail)`);
    if (seen.has(e.id)) {
      warnings.push(`${where}: duplicate of ${seen.get(e.id)}, skipped`);
      continue;
    }
    seen.set(e.id, f);
    entries.push(e);
  }
}

if (errors.length) {
  console.error(`SCHEMA FAIL (${errors.length}):`);
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}

// ---------- dictionary cross-check ----------

function shingles(s, n = 5) {
  const words = s.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

async function lookup(word) {
  const url = "https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(word);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return { found: false };
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const ipa =
        data
          .flatMap((d) => d.phonetics || [])
          .map((p) => p.text)
          .find((t) => t && t.startsWith("/")) || null;
      const defs = data
        .flatMap((d) => d.meanings || [])
        .flatMap((m) => m.definitions || [])
        .map((d) => d.definition)
        .filter(Boolean);
      return { found: true, ipa, defs };
    } catch (err) {
      if (attempt === 2) return { error: String(err) };
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return { error: "retries exhausted" };
}

const notFound = [];
const overlapFlags = [];
const netErrors = [];
let ipaAdded = 0;

if (!noNet) {
  let i = 0;
  for (const e of entries) {
    i++;
    if (i % 50 === 0) console.log(`  cross-check ${i}/${entries.length}`);
    const r = await lookup(e.word);
    if (r.error) {
      netErrors.push(`${e.id}: ${r.error}`);
    } else if (!r.found) {
      notFound.push(e.id);
    } else {
      if (r.ipa) {
        e.ipa = r.ipa;
        ipaAdded++;
      }
      const mine = e.definitions.map((d) => shingles(d));
      for (const apiDef of r.defs) {
        const theirs = shingles(apiDef);
        for (const s of mine) {
          for (const sh of s) {
            if (theirs.has(sh)) {
              overlapFlags.push(`${e.id}: 5-gram overlap with dictionary ("${sh}")`);
            }
          }
        }
      }
    }
    await new Promise((r) => setTimeout(r, 350));
  }
}

// ---------- emit (merge over the existing bank) ----------

let added = 0;
let updated = 0;
for (const e of entries) {
  if (existing.has(e.id)) updated++;
  else added++;
  existing.set(e.id, e);
}
const merged = [...existing.values()];
merged.sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
const tierCounts = [1, 2, 3, 4].map((t) => merged.filter((e) => e.tier === t).length);

const bank = { lang: "en", version: 1, generatedAt: new Date().toISOString().slice(0, 10), words: merged };
mkdirSync(join(ROOT, "data"), { recursive: true });
writeFileSync(bankPath, JSON.stringify(bank, null, 1));

const report = [
  `entries: ${merged.length} (${added} added, ${updated} updated, ${merged.length - added - updated} kept)`,
  `tiers 1/2/3/4: ${tierCounts.join("/")}`,
  `ipa adopted from dictionary: ${ipaAdded}`,
  `not in dictionaryapi.dev (${notFound.length}): ${notFound.join(", ")}`,
  `originality flags (${overlapFlags.length}):`,
  ...overlapFlags.map((f) => "  " + f),
  `network errors (${netErrors.length}):`,
  ...netErrors.map((f) => "  " + f),
  `warnings (${warnings.length}):`,
  ...warnings.map((f) => "  " + f),
].join("\n");
writeFileSync(join(batchDir, "report.txt"), report);
console.log(report.split("\n").slice(0, 6).join("\n"));
console.log(`\nwrote data/en.json + ${join(batchDir, "report.txt")}`);
