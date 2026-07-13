// SRS engine: thin wrapper over vendored ts-fsrs (FSRS-6 scheduler).
// Two-button grading: "again" | "good". Fuzz disabled so scheduling is
// deterministic and testable. Card state is stored as plain JSON
// (dates as ISO strings) and revived here.

import { fsrs, createEmptyCard, Rating } from "../vendor/ts-fsrs.mjs";

const engine = fsrs({ enable_fuzz: false });

/** @param {object} card plain card with ISO date strings */
function revive(card) {
  return {
    ...card,
    due: new Date(card.due),
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  };
}

/** @param {object} card ts-fsrs card with Date fields */
function freeze(card) {
  return {
    ...card,
    due: card.due.toISOString(),
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}

/** New progress record for a bank word. */
export function newProgress(id, now) {
  return {
    id,
    state: "learning", // learning | known | buried
    card: freeze(createEmptyCard(now)),
    addedAt: now.toISOString(),
    resurfaceAt: null,
    resurfaceDone: false,
  };
}

/** Progress record for a word flagged "already know it". */
export function knownProgress(id, now) {
  const p = newProgress(id, now);
  p.state = "known";
  p.resurfaceAt = new Date(now.getTime() + 21 * 864e5).toISOString();
  return p;
}

/** Apply a two-button grade. Returns a NEW progress record. */
export function grade(progress, rating, now) {
  const r = rating === "good" ? Rating.Good : Rating.Again;
  const { card } = engine.next(revive(progress.card), now, r);
  return { ...progress, card: freeze(card) };
}

/** @returns {boolean} card is due for review at `now` */
export function isDue(progress, now) {
  return new Date(progress.card.due) <= now;
}

/** Days until due (negative = overdue). */
export function dueInDays(progress, now) {
  return (new Date(progress.card.due) - now) / 864e5;
}

/** A card counts as mature once its memory stability exceeds 21 days. */
export function isMature(progress) {
  return progress.card.stability >= 21;
}
