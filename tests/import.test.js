import { test } from "node:test";
import assert from "node:assert/strict";
import { validateImport } from "../app/store.js";
import { newProgress, grade } from "../app/srs.js";

const T0 = new Date("2026-07-13T10:00:00Z");
const bankIds = new Set(["alpha", "beta"]);

function goodPayload() {
  return {
    app: "bonmot",
    version: 1,
    exportedAt: T0.toISOString(),
    meta: { streakCount: 4 },
    progress: [grade(newProgress("alpha", T0), "good", T0)],
  };
}

test("a valid export validates and survives intact", () => {
  const v = validateImport(goodPayload(), bankIds);
  assert.ok(v.ok);
  assert.equal(v.cleaned.length, 1);
  assert.equal(v.dropped, 0);
  assert.equal(v.meta.streakCount, 4);
});

test("rejects files that are not bonmot backups", () => {
  assert.equal(validateImport({ foo: 1 }, bankIds).ok, false);
  assert.equal(validateImport(null, bankIds).ok, false);
  assert.equal(validateImport("[]", bankIds).ok, false);
});

test("drops unknown word ids", () => {
  const p = goodPayload();
  p.progress.push({ ...newProgress("ghost", T0) });
  const v = validateImport(p, bankIds);
  assert.equal(v.cleaned.length, 1);
  assert.equal(v.dropped, 1);
});

test("clamps garbage SRS numbers instead of wedging the scheduler", () => {
  const p = goodPayload();
  p.progress[0].card.stability = "NaN-garbage";
  p.progress[0].card.difficulty = -50;
  p.progress[0].card.reps = 1e12;
  const v = validateImport(p, bankIds);
  const c = v.cleaned[0].card;
  assert.equal(c.stability, 0);
  assert.equal(c.difficulty, 1);
  assert.equal(c.reps, 1e6);
});

test("invalid dates fall back instead of producing NaN due", () => {
  const p = goodPayload();
  p.progress[0].card.due = "not-a-date";
  const v = validateImport(p, bankIds);
  assert.ok(!Number.isNaN(new Date(v.cleaned[0].card.due).getTime()));
});

test("meta is sanitized: markup strings and wrong types cannot pass", () => {
  const p = goodPayload();
  p.meta = {
    startTier: "<img src=x onerror=alert(1)>",
    streakCount: "999<script>",
    recent: "not-an-array",
    flagged: [{ evil: true }, "legit-word", 42],
    lastBackup: "garbage-date",
    streakLastDay: "<b>2026</b>",
    unknownKey: "dropped",
  };
  const v = validateImport(p, bankIds);
  assert.ok(v.ok);
  assert.equal(v.meta.startTier, 2);
  assert.equal(v.meta.streakCount, 0);
  assert.deepEqual(v.meta.recent, []);
  assert.deepEqual(v.meta.flagged, ["legit-word"]);
  assert.ok(!("lastBackup" in v.meta));
  assert.ok(!("streakLastDay" in v.meta));
  assert.ok(!("unknownKey" in v.meta));
});

test("valid meta survives sanitization intact", () => {
  const p = goodPayload();
  p.meta = {
    startTier: 3,
    placementDone: true,
    streakCount: 12,
    streakLastDay: "2026-07-12",
    recent: [1, 0, 1],
    flagged: ["alpha"],
  };
  const v = validateImport(p, bankIds);
  assert.equal(v.meta.startTier, 3);
  assert.equal(v.meta.placementDone, true);
  assert.equal(v.meta.streakCount, 12);
  assert.equal(v.meta.streakLastDay, "2026-07-12");
  assert.deepEqual(v.meta.recent, [1, 0, 1]);
  assert.deepEqual(v.meta.flagged, ["alpha"]);
});

test("unknown state strings are coerced to learning", () => {
  const p = goodPayload();
  p.progress[0].state = "hacked";
  const v = validateImport(p, bankIds);
  assert.equal(v.cleaned[0].state, "learning");
});
