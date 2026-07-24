// Second-brain review pipeline: scanner idempotency, deterministic
// generator output, importer stable-ids/no-dupe/FSRS-init, and the
// deck split that keeps knowledge cards out of the vocab session.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateCards,
  blockHash,
  parseQueue,
  renderQueue,
  mergeQueue,
  mergeBank,
  scanFile,
} from "../tools/review_lib.mjs";
import { runScan } from "../tools/review_scan.mjs";
import { runImport } from "../tools/review_import.mjs";
import { newProgress, grade, isDue } from "../app/srs.js";
import { validateImport } from "../app/store.js";
import { buildSession } from "../app/queue.js";
import { buildReviewSession } from "../app/views/review.js";

const T0 = new Date("2026-07-17T10:00:00Z");

const BLOCK = {
  source: "PURPL/RDE/Thermal.md#Nusselt number",
  heading: "Nusselt number",
  text: [
    "The Nusselt number is the ratio of convective to conductive heat transfer.",
    "**Biot number**: ratio of internal to surface thermal resistance.",
    "The **gas radiation** term inflates the fitted h by about 31 percent.",
  ].join("\n"),
};

test("generator: heading Q/A, definition Q/A, and bold cloze", () => {
  const cards = generateCards(BLOCK);
  assert.equal(cards.length, 3);
  assert.deepEqual(
    cards.map((c) => c.type),
    ["qa", "qa", "cloze"],
  );
  assert.equal(cards[0].prompt, "Nusselt number");
  assert.match(cards[0].answer, /ratio of convective/);
  assert.equal(cards[1].prompt, "Biot number");
  assert.equal(cards[1].answer, "ratio of internal to surface thermal resistance.");
  assert.equal(cards[2].prompt, "The ___ term inflates the fitted h by about 31 percent.");
  assert.equal(cards[2].answer, "gas radiation");
  for (const c of cards) assert.match(c.id, /^kn:[0-9a-f]{10}:\d+$/);
});

test("generator: ids are stable across runs (idempotent by content)", () => {
  const a = generateCards(BLOCK).map((c) => c.id);
  const b = generateCards(BLOCK).map((c) => c.id);
  assert.deepEqual(a, b);
  // Changing the content changes the block hash, hence the ids.
  const moved = generateCards({ ...BLOCK, text: BLOCK.text + "\nExtra line of content." });
  assert.notEqual(moved[0].id, a[0]);
});

test("scanFile finds inline-tagged sections and skips untagged notes", () => {
  const tagged = "# Nusselt number\n\n#review\nThe number is a ratio of heat transfer modes.";
  const blocks = scanFile("Thermal.md", tagged, "PURPL/Thermal.md");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].heading, "Nusselt number");
  assert.ok(!blocks[0].text.includes("#review"));
  assert.equal(scanFile("Plain.md", "# Notes\n\nJust some untagged text.", "PURPL/Plain.md").length, 0);
});

test("scanner is idempotent: a second scan of unchanged notes adds nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "bonmot-scan-"));
  try {
    const vault = join(dir, "vault");
    mkdirSync(vault);
    writeFileSync(
      join(vault, "note.md"),
      "# Nusselt number\n\n#review\nThe Nusselt number is a ratio of heat transfer modes.\n**Biot number**: internal over surface resistance.",
    );
    const queue = join(dir, "queue.md");
    const bank = join(dir, "review.json");
    const opts = { queue, bank, vaults: [["PURPL", vault]] };

    const first = runScan(opts);
    assert.ok(first.added > 0);
    const afterFirst = readFileSync(queue, "utf8");

    const second = runScan(opts);
    assert.equal(second.added, 0);
    assert.equal(readFileSync(queue, "utf8"), afterFirst);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanner preserves an approved checkbox on re-scan", () => {
  const cards = generateCards(BLOCK).map((c) => ({ ...c, approved: false }));
  cards[0].approved = true;
  const merged = mergeQueue(cards, generateCards(BLOCK), new Set());
  assert.equal(merged.length, cards.length); // nothing new added
  assert.equal(merged.find((c) => c.id === cards[0].id).approved, true);
});

test("queue markdown round-trips through parse/render with edits intact", () => {
  const cards = generateCards(BLOCK).map((c, i) => ({ ...c, approved: i === 0 }));
  const parsed = parseQueue(renderQueue(cards));
  assert.equal(parsed.length, 3);
  const first = parsed.find((c) => c.id === cards[0].id);
  assert.equal(first.approved, true);
  assert.equal(first.prompt, cards[0].prompt);
  assert.equal(first.answer, cards[0].answer);
});

test("importer: only approved cards land, ids are stable, no dupes on re-run", () => {
  const dir = mkdtempSync(join(tmpdir(), "bonmot-import-"));
  try {
    const queue = join(dir, "queue.md");
    const bank = join(dir, "review.json");
    const cards = generateCards(BLOCK).map((c, i) => ({ ...c, approved: i < 2 }));
    writeFileSync(queue, renderQueue(cards));

    const first = runImport({ queue, bank });
    assert.equal(first.added, 2);
    assert.equal(first.total, 2);
    const written = JSON.parse(readFileSync(bank, "utf8"));
    assert.deepEqual(
      written.cards.map((c) => c.id).sort(),
      cards.slice(0, 2).map((c) => c.id).sort(),
    );

    const second = runImport({ queue, bank });
    assert.equal(second.added, 0);
    assert.equal(second.updated, 2);
    assert.equal(second.total, 2); // never duplicated
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mergeBank never drops previously imported cards", () => {
  const existing = [{ id: "kn:aaaaaaaaaa:0", type: "qa", prompt: "old", answer: "kept", source: "s" }];
  const { cards } = mergeBank(existing, [
    { id: "kn:bbbbbbbbbb:0", type: "qa", prompt: "new", answer: "added", source: "s", approved: true },
  ]);
  assert.equal(cards.length, 2);
  assert.ok(cards.some((c) => c.id === "kn:aaaaaaaaaa:0"));
});

test("imported card initializes a valid FSRS record and survives import validation", () => {
  const card = generateCards(BLOCK)[0];
  const p = newProgress(card.id, T0);
  assert.equal(p.state, "learning");
  assert.equal(p.card.reps, 0);
  assert.ok(!Number.isNaN(new Date(p.card.due).getTime()));
  const graded = grade(p, "good", T0);
  assert.ok(graded.card.reps >= 1);
  // Export/import keeps kn: progress because its id is in the valid set.
  const v = validateImport(
    { app: "bonmot", progress: [graded] },
    new Set([card.id]),
  );
  assert.ok(v.ok);
  assert.equal(v.cleaned.length, 1);
  assert.equal(v.dropped, 0);
});

test("deck split: kn: cards ride Review, not the vocab session", () => {
  const bank = { words: [{ id: "w0", word: "w0", tier: 2 }], byId: new Map() };
  const reviewBank = {
    cards: [{ id: "kn:cccccccccc:0", type: "qa", prompt: "q", answer: "a", source: "s" }],
    byId: new Map(),
  };
  const progress = new Map();
  // A due knowledge card and a due vocab card.
  const past = new Date(T0 - 5 * 864e5);
  progress.set("kn:cccccccccc:0", grade(newProgress("kn:cccccccccc:0", past), "good", past));
  progress.set("w0", grade(newProgress("w0", past), "good", past));

  const vocab = buildSession(bank, progress, { startTier: 2 }, T0);
  assert.ok(!vocab.items.some((i) => i.id.startsWith("kn:")), "vocab session must exclude kn:");
  assert.ok(vocab.items.some((i) => i.id === "w0"));

  const review = buildReviewSession(reviewBank, progress, T0);
  assert.ok(review.items.some((i) => i.id === "kn:cccccccccc:0"));
  assert.ok(!review.items.some((i) => i.id === "w0"), "review session must exclude vocab");
});

test("deckId filter: a session only pulls its own deck's cards", () => {
  const reviewBank = {
    cards: [
      { id: "kn:rde:001", deck: "rde", type: "qa", prompt: "a", answer: "1", source: "s" },
      { id: "kn:spacex:001", deck: "spacex", type: "qa", prompt: "b", answer: "2", source: "s" },
    ],
    byId: new Map(),
  };
  reviewBank.byId = new Map(reviewBank.cards.map((c) => [c.id, c]));
  const progress = new Map();

  const rde = buildReviewSession(reviewBank, progress, T0, "rde");
  assert.deepEqual(
    rde.items.map((i) => i.id),
    ["kn:rde:001"],
  );
  const all = buildReviewSession(reviewBank, progress, T0);
  assert.equal(all.items.length, 2, "null deckId pulls every deck");
});

test("shipped data/review.json is valid: kn: ids, known decks, unique, no dashes", () => {
  const bank = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "review.json"), "utf8"));
  const deckIds = new Set((bank.decks || []).map((d) => d.id));
  deckIds.add("brain"); // default deck needs no manifest entry
  const seen = new Set();
  const EM = String.fromCharCode(0x2014);
  const EN = String.fromCharCode(0x2013);
  for (const c of bank.cards) {
    assert.ok(c.id.startsWith("kn:"), `id must be kn: ${c.id}`);
    assert.ok(!seen.has(c.id), `duplicate id ${c.id}`);
    seen.add(c.id);
    const deck = c.deck || "brain";
    assert.ok(deckIds.has(deck), `card ${c.id} references unknown deck ${deck}`);
    for (const f of ["type", "prompt", "answer", "source"]) {
      assert.ok(c[f], `card ${c.id} missing ${f}`);
    }
    const blob = c.prompt + c.answer + c.source + (c.hook || "") + (c.reverse || "");
    assert.ok(!blob.includes(EM) && !blob.includes(EN), `dash in card ${c.id}`);
  }
  for (const d of bank.decks || []) {
    const blob = d.label + d.blurb;
    assert.ok(!blob.includes(EM) && !blob.includes(EN), `dash in deck ${d.id}`);
  }
});

test("searchDecks and searchCards filter by tags, group, and card text", async () => {
  const { searchDecks, searchCards } = await import("../app/review-bank.js");
  const summaries = [
    { id: "pv-roy", label: "Paper: Roy 2016", blurb: "effective h", group: "PURPL/Papers", tags: ["roy", "rde", "heat-transfer"] },
    { id: "spacex", label: "SpaceX interview prep", blurb: "questions", group: "Career", tags: ["spacex", "interview"] },
  ];
  // tag match
  assert.deepEqual(searchDecks(summaries, "heat-transfer").map((d) => d.id), ["pv-roy"]);
  // group match
  assert.deepEqual(searchDecks(summaries, "papers").map((d) => d.id), ["pv-roy"]);
  // all words must match
  assert.equal(searchDecks(summaries, "roy interview").length, 0);
  // empty query returns all
  assert.equal(searchDecks(summaries, "").length, 2);

  const reviewBank = {
    cards: [
      { id: "kn:pv-roy:001", deck: "pv-roy", prompt: "Thermal diffusivity", answer: "how fast heat spreads" },
      { id: "kn:pv-braun:001", deck: "pv-braun", prompt: "Stanton number", answer: "dimensionless heat transfer" },
      { id: "kn:spacex:001", deck: "spacex", prompt: "Why SpaceX", answer: "the pace of iteration" },
    ],
  };
  const hits = searchCards(reviewBank, "heat");
  assert.deepEqual(hits.map((h) => h.deckId).sort(), ["pv-braun", "pv-roy"]);
  assert.ok(hits.every((h) => h.count === 1 && h.sample));
});

test("deckSummaries counts mastered cards by FSRS stability", async () => {
  const { deckSummaries } = await import("../app/review-bank.js");
  const reviewBank = {
    decks: [{ id: "rde", label: "RDE", blurb: "", group: "PURPL/Fundamentals", tags: ["rde"] }],
    cards: [
      { id: "kn:rde:001", deck: "rde", type: "qa", prompt: "a", answer: "1", source: "s" },
      { id: "kn:rde:002", deck: "rde", type: "qa", prompt: "b", answer: "2", source: "s" },
    ],
    byId: new Map(),
  };
  reviewBank.byId = new Map(reviewBank.cards.map((c) => [c.id, c]));
  const progress = new Map();
  progress.set("kn:rde:001", { id: "kn:rde:001", state: "learning", card: { due: T0.toISOString(), stability: 40 } });
  progress.set("kn:rde:002", { id: "kn:rde:002", state: "learning", card: { due: T0.toISOString(), stability: 3 } });
  const [rde] = deckSummaries(reviewBank, progress, T0);
  assert.equal(rde.seen, 2);
  assert.equal(rde.mastered, 1); // only the stability-40 card is mature
  assert.equal(rde.tags[0], "rde");
  assert.equal(rde.group, "PURPL/Fundamentals");
});

test("atRiskCards ranks most-overdue first, then longest unseen", async () => {
  const { atRiskCards } = await import("../app/review-bank.js");
  const now = new Date("2026-08-01T00:00:00Z");
  const mk = (id, dueDaysAgo, lastDaysAgo) => [
    id,
    {
      id,
      state: "learning",
      addedAt: new Date(now - 30 * 864e5).toISOString(),
      card: {
        due: new Date(now - dueDaysAgo * 864e5).toISOString(),
        last_review: new Date(now - lastDaysAgo * 864e5).toISOString(),
      },
    },
  ];
  const reviewBank = {
    cards: [
      { id: "kn:a:1", deck: "a", prompt: "A" },
      { id: "kn:a:2", deck: "a", prompt: "B" },
      { id: "kn:a:3", deck: "a", prompt: "C" },
    ],
    byId: new Map(),
  };
  reviewBank.byId = new Map(reviewBank.cards.map((c) => [c.id, c]));
  const progress = new Map([
    mk("kn:a:1", 2, 5), // overdue 2
    mk("kn:a:2", 10, 12), // overdue 10 -> most at risk
    mk("kn:a:3", -3, 4), // not due yet (negative overdue)
  ]);
  const rows = atRiskCards(reviewBank, progress, now, 8);
  assert.equal(rows[0].id, "kn:a:2", "most overdue first");
  assert.equal(rows[1].id, "kn:a:1");
  assert.equal(rows[2].id, "kn:a:3");
  assert.equal(rows[0].overdueDays, 10);
  assert.equal(rows[1].daysSince, 5);
});

test("buildFortressSession: kn:-only, deduped, capped, kind by progress", async () => {
  const { buildFortressSession } = await import("../app/views/review.js");
  const now = new Date("2026-08-01T00:00:00Z");
  const cards = [];
  for (let i = 0; i < 60; i++) cards.push({ id: `kn:f:${i}`, deck: "f", prompt: "p", answer: "a", source: "s" });
  const reviewBank = { cards, byId: new Map(cards.map((c) => [c.id, c])) };
  const progress = new Map();
  // one vocab word (must never appear) and a couple of seen kn: cards
  progress.set("w0", grade(newProgress("w0", now), "good", now));
  const past = new Date(now - 5 * 864e5);
  progress.set("kn:f:0", grade(newProgress("kn:f:0", past), "good", past)); // due
  const s = buildFortressSession(reviewBank, progress, now);
  assert.ok(s.items.length > 0 && s.items.length <= 40, "capped at 40");
  assert.ok(s.items.every((i) => i.id.startsWith("kn:")), "no vocab leak");
  assert.equal(new Set(s.items.map((i) => i.id)).size, s.items.length, "no duplicates");
  assert.ok(s.items.some((i) => i.id === "kn:f:0" && i.kind === "review"), "seen card is a review");
  const anIntro = s.items.find((i) => i.kind === "intro");
  if (anIntro) assert.ok(!progress.has(anIntro.id), "intro cards are unseen");
});
