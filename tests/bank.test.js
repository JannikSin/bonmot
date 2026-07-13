// Guards the SHIPPED word bank: schema, unique stable ids, the em-dash
// ban, tier coverage. Runs against data/en.json (skips cleanly if the
// bank has not been generated yet).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const path = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "en.json");
const exists = existsSync(path);
const bank = exists ? JSON.parse(readFileSync(path, "utf8")) : null;

test("bank exists and is non-trivial", { skip: !exists }, () => {
  assert.equal(bank.lang, "en");
  assert.ok(bank.words.length >= 400, `has ${bank.words.length} words`);
});

test("ids are unique stable slugs", { skip: !exists }, () => {
  const ids = new Set();
  for (const w of bank.words) {
    assert.match(w.id, /^[a-z][a-z-]*$/, w.id);
    assert.ok(!ids.has(w.id), `duplicate ${w.id}`);
    ids.add(w.id);
  }
});

test("no em or en dashes anywhere", { skip: !exists }, () => {
  const text = JSON.stringify(bank);
  assert.ok(!text.includes("\u2014"), "em dash found");
  assert.ok(!text.includes("\u2013"), "en dash found");
});

test("every entry carries the required teaching apparatus", { skip: !exists }, () => {
  for (const w of bank.words) {
    assert.ok(w.definitions.length >= 1 && w.definitions.length <= 2, w.id);
    assert.equal(w.examples.length, 2, w.id);
    assert.ok(w.etymology && w.etymology.length > 10, w.id);
    assert.ok([1, 2, 3, 4].includes(w.tier), w.id);
    assert.ok(["adjective", "noun", "verb", "adverb"].includes(w.pos), w.id);
  }
});

test("all four tiers are meaningfully stocked", { skip: !exists }, () => {
  for (const t of [1, 2, 3, 4]) {
    const n = bank.words.filter((w) => w.tier === t).length;
    assert.ok(n >= 40, `tier ${t} has ${n}`);
  }
});

test("shipped ipa always looks like ipa", { skip: !exists }, () => {
  for (const w of bank.words) {
    if (w.ipa) assert.match(w.ipa, /^\//, w.id);
  }
});
