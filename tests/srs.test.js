import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newProgress,
  knownProgress,
  grade,
  isDue,
  isMature,
} from "../app/srs.js";

const T0 = new Date("2026-07-13T10:00:00Z");

test("newProgress creates a due learning card with serialized dates", () => {
  const p = newProgress("perspicacious", T0);
  assert.equal(p.state, "learning");
  assert.equal(typeof p.card.due, "string");
  assert.ok(isDue(p, T0));
});

test("good grade schedules the card into the future", () => {
  const p = newProgress("w", T0);
  const g = grade(p, "good", T0);
  assert.ok(new Date(g.card.due) > T0);
  assert.ok(!isDue(g, T0));
  assert.equal(g.card.reps, 1);
});

test("again keeps the card close; good pushes it further", () => {
  const p = newProgress("w", T0);
  const again = grade(p, "again", T0);
  const good = grade(p, "good", T0);
  assert.ok(new Date(again.card.due) <= new Date(good.card.due));
});

test("repeated good grades grow the interval (no ease hell)", () => {
  let p = newProgress("w", T0);
  let now = T0;
  let lastInterval = 0;
  for (let i = 0; i < 6; i++) {
    p = grade(p, "good", now);
    const interval = new Date(p.card.due) - now;
    if (i >= 2) assert.ok(interval > lastInterval, `interval grew at rep ${i}`);
    lastInterval = interval;
    now = new Date(p.card.due);
  }
  assert.ok(lastInterval > 5 * 864e5, "mature interval exceeds 5 days");
});

test("a lapse after maturity does not wedge the card", () => {
  let p = newProgress("w", T0);
  let now = T0;
  for (let i = 0; i < 5; i++) {
    p = grade(p, "good", now);
    now = new Date(p.card.due);
  }
  p = grade(p, "again", now);
  assert.equal(p.card.lapses, 1);
  // recovers: next goods still schedule forward
  p = grade(p, "good", new Date(p.card.due));
  assert.ok(new Date(p.card.due) > now);
});

test("grade round-trips through JSON serialization", () => {
  let p = newProgress("w", T0);
  p = grade(p, "good", T0);
  const revived = JSON.parse(JSON.stringify(p));
  const g = grade(revived, "good", new Date(revived.card.due));
  assert.ok(new Date(g.card.due) > new Date(revived.card.due));
});

test("knownProgress sets a resurface date ~21 days out", () => {
  const p = knownProgress("w", T0);
  assert.equal(p.state, "known");
  const days = (new Date(p.resurfaceAt) - T0) / 864e5;
  assert.equal(Math.round(days), 21);
});

test("isMature tracks stability threshold", () => {
  let p = newProgress("w", T0);
  assert.ok(!isMature(p));
  let now = T0;
  for (let i = 0; i < 10; i++) {
    p = grade(p, "good", now);
    now = new Date(p.card.due);
  }
  assert.ok(isMature(p), "10 straight goods reach maturity");
});
