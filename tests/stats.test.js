import { test } from "node:test";
import assert from "node:assert/strict";
import {
  updateStreak,
  recordOutcome,
  retention,
  RETENTION_WINDOW,
} from "../app/stats.js";

test("first session starts the streak", () => {
  const m = updateStreak({}, "2026-07-13");
  assert.equal(m.streakCount, 1);
});

test("consecutive days extend the streak", () => {
  let m = updateStreak({}, "2026-07-13");
  m = updateStreak(m, "2026-07-14");
  assert.equal(m.streakCount, 2);
});

test("same day twice does not double-count", () => {
  let m = updateStreak({}, "2026-07-13");
  m = updateStreak(m, "2026-07-13");
  assert.equal(m.streakCount, 1);
});

test("one missed day is covered by grace", () => {
  let m = updateStreak({}, "2026-07-13");
  m = updateStreak(m, "2026-07-15"); // skipped the 14th
  assert.equal(m.streakCount, 2);
  assert.equal(m.streakGraceDay, "2026-07-15");
});

test("a second grace within the same week does not apply", () => {
  let m = updateStreak({}, "2026-07-13");
  m = updateStreak(m, "2026-07-15"); // grace used
  m = updateStreak(m, "2026-07-17"); // another skip, too soon
  assert.equal(m.streakCount, 1);
});

test("grace becomes available again after a week", () => {
  let m = updateStreak({}, "2026-07-13");
  m = updateStreak(m, "2026-07-15"); // grace 1
  for (const d of ["2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23"]) {
    m = updateStreak(m, d);
  }
  const before = m.streakCount;
  m = updateStreak(m, "2026-07-25"); // skip the 24th, grace available again
  assert.equal(m.streakCount, before + 1);
});

test("two missed days reset the streak", () => {
  let m = updateStreak({}, "2026-07-13");
  m = updateStreak(m, "2026-07-16");
  assert.equal(m.streakCount, 1);
});

test("retention rolls over a bounded window", () => {
  let recent = [];
  for (let i = 0; i < RETENTION_WINDOW + 50; i++) {
    recent = recordOutcome(recent, true);
  }
  assert.equal(recent.length, RETENTION_WINDOW);
  assert.equal(retention(recent), 100);
  for (let i = 0; i < 20; i++) recent = recordOutcome(recent, false);
  assert.equal(retention(recent), 90);
  assert.equal(retention([1, 0]), 50);
  assert.equal(retention([]), null);
});
