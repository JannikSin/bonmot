import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickPlacementWord,
  stepTier,
  estimateTier,
  TRIALS,
  START_TIER,
} from "../app/placement.js";

function makeBank() {
  const words = [];
  for (let t = 1; t <= 4; t++) {
    for (let i = 0; i < 10; i++) words.push({ id: `t${t}w${i}`, word: `t${t}w${i}`, tier: t });
  }
  return { words };
}

test("stepTier moves within bounds", () => {
  assert.equal(stepTier(2, true), 3);
  assert.equal(stepTier(2, false), 1);
  assert.equal(stepTier(4, true), 4);
  assert.equal(stepTier(1, false), 1);
});

test("pickPlacementWord returns an unseen word at the tier", () => {
  const bank = makeBank();
  const seen = new Set(["t2w0"]);
  const w = pickPlacementWord(bank, 2, seen);
  assert.equal(w.tier, 2);
  assert.notEqual(w.id, "t2w0");
});

test("pickPlacementWord falls back to nearby tiers when exhausted", () => {
  const bank = makeBank();
  const seen = new Set(bank.words.filter((w) => w.tier === 3).map((w) => w.id));
  const w = pickPlacementWord(bank, 3, seen);
  assert.ok(w && w.tier !== 3);
});

test("a strong reader converges high, a struggling one low", () => {
  let tier = START_TIER;
  const strongWalk = [];
  for (let i = 0; i < TRIALS; i++) {
    strongWalk.push(tier);
    tier = stepTier(tier, true);
  }
  assert.equal(estimateTier(strongWalk), 4);

  tier = START_TIER;
  const weakWalk = [];
  for (let i = 0; i < TRIALS; i++) {
    weakWalk.push(tier);
    tier = stepTier(tier, false);
  }
  assert.equal(estimateTier(weakWalk), 1);
});

test("an alternating reader lands mid-scale", () => {
  let tier = START_TIER;
  const walk = [];
  for (let i = 0; i < TRIALS; i++) {
    walk.push(tier);
    tier = stepTier(tier, i % 2 === 0);
  }
  const est = estimateTier(walk);
  assert.ok(est >= 2 && est <= 3, `estimate ${est} is mid-scale`);
});
