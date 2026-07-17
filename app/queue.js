// Session builder. One bounded session per open: due reviews first,
// then overconfidence resurfaces, then new words. The new-word intake
// throttles itself against review debt so a backlog never becomes a
// WaniKani-style mountain. No knobs.

import { isDue } from "./srs.js";

export const REVIEW_CAP = 60;
export const NEW_MIN = 2;
export const NEW_MAX = 8;
export const RESURFACE_CAP = 3;
// After a new word's intro card, its first recall test lands this many
// positions later in the same session.
export const INTRO_GAP = 4;

/** How many new words today, given current review debt. */
export function newWordBudget(dueCount) {
  const n = NEW_MAX - Math.floor(dueCount / 15);
  return Math.max(NEW_MIN, Math.min(NEW_MAX, n));
}

/**
 * Pick new words: prefer the placement tier, then fan out to adjacent
 * tiers, preserving bank order within a tier.
 */
export function pickNewWords(bank, progressMap, startTier, count) {
  const fresh = bank.words.filter((w) => !progressMap.has(w.id));
  const byDistance = (w) => Math.abs(w.tier - startTier);
  const picked = fresh
    .map((w, i) => ({ w, i }))
    .sort((a, b) => byDistance(a.w) - byDistance(b.w) || a.w.tier - b.w.tier || a.i - b.i)
    .slice(0, count)
    .map((x) => x.w);
  return picked;
}

/**
 * Build today's session queue.
 * @returns {{items: Array<{kind: string, id: string}>, dueTotal: number, dueDeferred: number}}
 */
export function buildSession(bank, progressMap, meta, now) {
  // Knowledge cards (kn: ids) share the progress store but ride the
  // separate Review deck, so keep them out of the vocab session.
  const learning = [...progressMap.values()].filter(
    (p) => p.state === "learning" && !p.id.startsWith("kn:"),
  );
  const due = learning
    .filter((p) => isDue(p, now))
    .sort((a, b) => new Date(a.card.due) - new Date(b.card.due));
  const reviews = due.slice(0, REVIEW_CAP);

  const resurfaces = [...progressMap.values()]
    .filter(
      (p) =>
        p.state === "known" &&
        !p.resurfaceDone &&
        p.resurfaceAt &&
        new Date(p.resurfaceAt) <= now,
    )
    .slice(0, RESURFACE_CAP);

  const startTier = meta.startTier || 2;
  const budget = Math.max(0, newWordBudget(due.length) - (meta.introUsedToday || 0));
  const fresh = pickNewWords(bank, progressMap, startTier, budget);

  const items = [
    ...reviews.map((p) => ({ kind: "review", id: p.id })),
    ...resurfaces.map((p) => ({ kind: "resurface", id: p.id })),
    ...fresh.map((w) => ({ kind: "intro", id: w.id })),
  ];
  return { items, dueTotal: due.length, dueDeferred: due.length - reviews.length };
}

/**
 * Re-queue a card inside the running session when FSRS schedules it
 * within the next 30 minutes (learning steps). Inserts a review item
 * a few positions ahead; appends if the queue is shorter.
 */
export function requeue(items, index, id, gap = INTRO_GAP) {
  const at = Math.min(index + 1 + gap, items.length);
  const copy = items.slice();
  copy.splice(at, 0, { kind: "review", id });
  return copy;
}

/** Should this just-graded card come back within the session? */
export function dueWithinSession(progress, now) {
  return new Date(progress.card.due) - now < 30 * 60e3;
}
