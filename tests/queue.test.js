import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newWordBudget,
  pickNewWords,
  buildSession,
  requeue,
  REVIEW_CAP,
  NEW_MIN,
  NEW_MAX,
} from "../app/queue.js";
import { newProgress, knownProgress, grade } from "../app/srs.js";

const T0 = new Date("2026-07-13T10:00:00Z");

function makeBank(n = 40) {
  const words = [];
  for (let i = 0; i < n; i++) {
    words.push({ id: `w${i}`, word: `w${i}`, tier: (i % 4) + 1 });
  }
  return { words, byId: new Map(words.map((w) => [w.id, w])) };
}

test("new-word budget throttles against review debt", () => {
  assert.equal(newWordBudget(0), NEW_MAX);
  assert.equal(newWordBudget(30), NEW_MAX - 2);
  assert.equal(newWordBudget(500), NEW_MIN);
});

test("pickNewWords prefers the start tier, skips seen words", () => {
  const bank = makeBank(40);
  const progress = new Map([["w1", newProgress("w1", T0)]]);
  const picked = pickNewWords(bank, progress, 2, 5);
  assert.equal(picked.length, 5);
  assert.ok(picked.every((w) => w.id !== "w1"));
  assert.ok(picked.every((w) => w.tier === 2));
});

test("buildSession: due reviews first, then new words", () => {
  const bank = makeBank(40);
  const progress = new Map();
  const overdue = grade(newProgress("w0", new Date(T0 - 10 * 864e5)), "good", new Date(T0 - 10 * 864e5));
  progress.set("w0", overdue);
  const s = buildSession(bank, progress, { startTier: 2 }, T0);
  assert.equal(s.items[0].kind, "review");
  assert.equal(s.items[0].id, "w0");
  assert.ok(s.items.filter((i) => i.kind === "intro").length >= NEW_MIN);
});

test("buildSession caps reviews and reports the deferred count", () => {
  const bank = makeBank(200);
  const progress = new Map();
  const past = new Date(T0 - 30 * 864e5);
  for (let i = 0; i < 80; i++) {
    progress.set(`w${i}`, grade(newProgress(`w${i}`, past), "good", past));
  }
  const s = buildSession(bank, progress, { startTier: 2 }, T0);
  const reviews = s.items.filter((i) => i.kind === "review");
  assert.equal(reviews.length, REVIEW_CAP);
  assert.equal(s.dueDeferred, 80 - REVIEW_CAP);
  assert.equal(s.dueTotal, 80);
});

test("buried and known words never enter the review queue", () => {
  const bank = makeBank(10);
  const past = new Date(T0 - 30 * 864e5);
  const progress = new Map();
  const buried = { ...grade(newProgress("w0", past), "good", past), state: "buried" };
  progress.set("w0", buried);
  progress.set("w1", knownProgress("w1", past));
  const s = buildSession(bank, progress, { startTier: 2 }, T0);
  assert.ok(!s.items.some((i) => i.kind === "review"));
});

test("known word resurfaces once after its resurface date", () => {
  const bank = makeBank(10);
  const past = new Date(T0 - 30 * 864e5);
  const progress = new Map([["w1", knownProgress("w1", past)]]);
  const s = buildSession(bank, progress, { startTier: 2 }, T0);
  assert.equal(s.items.filter((i) => i.kind === "resurface").length, 1);
  progress.set("w1", { ...progress.get("w1"), resurfaceDone: true });
  const s2 = buildSession(bank, progress, { startTier: 2 }, T0);
  assert.equal(s2.items.filter((i) => i.kind === "resurface").length, 0);
});

test("introUsedToday reduces the remaining new-word budget", () => {
  const bank = makeBank(40);
  const s = buildSession(bank, new Map(), { startTier: 2, introUsedToday: NEW_MAX }, T0);
  assert.equal(s.items.filter((i) => i.kind === "intro").length, 0);
});

test("requeue inserts the card a gap ahead, clamped to queue end", () => {
  const items = [{ kind: "review", id: "a" }, { kind: "review", id: "b" }];
  const r = requeue(items, 0, "a", 4);
  assert.equal(r.length, 3);
  assert.equal(r[2].id, "a");
});
