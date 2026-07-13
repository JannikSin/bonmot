// First-run placement: adaptive staircase, ~16 words, under 3 minutes.
// "I know it" pre-burns the word (with a later confirmation resurface).

import {
  pickPlacementWord,
  stepTier,
  estimateTier,
  TRIALS,
  START_TIER,
} from "../placement.js";
import { knownProgress } from "../srs.js";
import { headwordHtml } from "./entry.js";
import { romanTier } from "../bank.js";

export function createPlacementView(ctx) {
  const { bank, progress, meta, saveProgress, saveMeta, onFinished } = ctx;
  let tier = meta.startTier || START_TIER;
  let walk = [];
  let seen = new Set();
  let word = null;
  let finished = false;

  function next() {
    word = pickPlacementWord(bank, tier, seen);
    if (word) seen.add(word.id);
  }

  async function answer(knewIt) {
    walk.push(tier);
    if (knewIt) {
      const p = knownProgress(word.id, new Date());
      progress.set(word.id, p);
      await saveProgress(p);
    }
    tier = stepTier(tier, knewIt);
    if (walk.length >= TRIALS) {
      finished = true;
      meta.startTier = estimateTier(walk);
      meta.placementDone = true;
      await saveMeta(meta);
    } else {
      next();
    }
  }

  function render(el) {
    if (finished) {
      el.innerHTML = `
        <div class="card done">
          <p class="fleuron">❦</p>
          <h1 class="done-title">Tier ${romanTier(meta.startTier)}</h1>
          <p class="honest">New words start here and follow your recall from now on. Nothing to configure.</p>
          <div class="actions">
            <button class="primary wide" data-act="begin">Begin</button>
          </div>
        </div>`;
      return;
    }
    if (!word) next();
    if (!word) {
      finished = true;
      meta.startTier = estimateTier(walk);
      meta.placementDone = true;
      saveMeta(meta).then(() => render(el));
      return;
    }
    el.innerHTML = `
      <div class="card" data-kind="placement">
        <p class="eyebrow">placement · ${walk.length + 1} of ${TRIALS}</p>
        ${
          walk.length === 0
            ? `<p class="honest">${TRIALS} quick words, about three minutes. This finds where you start; nothing to configure after.</p>`
            : ""
        }
        ${headwordHtml(word, { withIpa: false })}
        <p class="recall-hint">Could you define it, right now?</p>
        <div class="actions">
          <button class="ghost" data-act="no">Not really</button>
          <button class="primary" data-act="yes">I know it</button>
        </div>
      </div>`;
  }

  async function onAction(act) {
    if (act === "yes") await answer(true);
    else if (act === "no") await answer(false);
    else if (act === "begin") onFinished();
  }

  return { render, onAction };
}
