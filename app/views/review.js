// Review deck: the second-brain session. Due knowledge cards first,
// then a capped intake of new ones. Same FSRS engine and progress store
// as vocab, separated only by the kn: id prefix. Deliberately thinner
// than Today: no tiers, no resurface, no streak. Knowledge recall is a
// separate discipline from the daily vocab streak.

import { grade, newProgress, isDue } from "../srs.js";
import { requeue, dueWithinSession, INTRO_GAP } from "../queue.js";
import { esc } from "./entry.js";

// ponytail: fixed daily intake of new knowledge cards. A throttle vs
// review debt (like queue.js newWordBudget) can be added if backlogs bite.
const NEW_CAP = 10;
const REVIEW_CAP = 60;

export function buildReviewSession(reviewBank, progress, now) {
  const known = [...progress.values()].filter((p) => p.id.startsWith("kn:"));
  const due = known
    .filter((p) => p.state === "learning" && isDue(p, now))
    .sort((a, b) => new Date(a.card.due) - new Date(b.card.due))
    .slice(0, REVIEW_CAP);
  const fresh = reviewBank.cards.filter((c) => !progress.has(c.id)).slice(0, NEW_CAP);
  const items = [
    ...due.map((p) => ({ kind: "review", id: p.id })),
    ...fresh.map((c) => ({ kind: "intro", id: c.id })),
  ];
  return { items, index: 0 };
}

export function createReviewView(ctx) {
  const { reviewBank, progress, saveProgress } = ctx;
  let session = null;
  let revealed = false;
  let counts = { reviewed: 0, correct: 0, introduced: 0 };
  let sessionLapses = new Map();

  function start() {
    session = buildReviewSession(reviewBank, progress, new Date());
    counts = { reviewed: 0, correct: 0, introduced: 0 };
    sessionLapses = new Map();
    revealed = false;
  }

  function current() {
    return session && session.items[session.index];
  }

  function advance() {
    session.index++;
    revealed = false;
  }

  async function onGrade(rating) {
    const item = current();
    const now = new Date();
    const next = grade(progress.get(item.id), rating, now);
    progress.set(item.id, next);
    await saveProgress(next);
    counts.reviewed++;
    if (rating === "good") counts.correct++;
    if (rating === "again") sessionLapses.set(item.id, (sessionLapses.get(item.id) || 0) + 1);
    if (dueWithinSession(next, now) && (sessionLapses.get(item.id) || 0) < 3) {
      session.items = requeue(session.items, session.index, item.id);
    }
    advance();
  }

  async function onIntroContinue() {
    const item = current();
    const p = newProgress(item.id, new Date());
    progress.set(item.id, p);
    await saveProgress(p);
    counts.introduced++;
    session.items = requeue(session.items, session.index, item.id, INTRO_GAP);
    advance();
  }

  function render(el) {
    if (!session) start();
    const item = current();
    if (!item) {
      el.innerHTML = doneHtml();
      return;
    }
    const c = reviewBank.byId.get(item.id);
    if (!c) {
      // Card left the deck (edited/removed upstream): skip it cleanly.
      advance();
      return render(el);
    }
    const n = session.index + 1;
    const total = session.items.length;
    const label = c.type === "cloze" ? "cloze" : "recall";
    const answer = `<div class="entry-body open"><p class="review-answer">${esc(c.answer)}</p>
      <p class="review-source">${esc(c.source)}</p></div>`;
    if (item.kind === "intro") {
      el.innerHTML = `
        <div class="card" data-kind="intro">
          <p class="eyebrow">new card &middot; ${n} of ${total}</p>
          <p class="review-prompt">${esc(c.prompt)}</p>
          ${answer}
          <div class="actions">
            <button class="primary wide" data-act="continue">Continue</button>
          </div>
        </div>`;
    } else {
      el.innerHTML = `
        <div class="card" data-kind="review">
          <p class="eyebrow">${label} &middot; ${n} of ${total}</p>
          <p class="review-prompt">${esc(c.prompt)}</p>
          ${revealed ? answer : `<p class="recall-hint">Recall it, then reveal.</p>`}
          <div class="actions">
            ${
              revealed
                ? `<button class="danger" data-act="again">Again</button>
                   <button class="primary" data-act="good">Got it</button>`
                : `<button class="primary wide" data-act="reveal">Reveal</button>`
            }
          </div>
        </div>`;
    }
  }

  function doneHtml() {
    const empty = reviewBank.cards.length === 0;
    const ran = counts.reviewed + counts.introduced > 0;
    const title = empty
      ? "No review deck yet"
      : ran
        ? "Review complete"
        : "Nothing due right now";
    const body = empty
      ? `Tag notes with #review, run npm run review-scan, approve cards in System/Review-Queue.md, then npm run review-import.`
      : ran
        ? "The next cards arrive as they come due."
        : "No knowledge cards are scheduled yet. New reviews arrive with tomorrow.";
    return `
      <div class="card done">
        <p class="fleuron">&#10086;</p>
        <h1 class="done-title">${title}</h1>
        <p class="honest">${esc(body)}</p>
        ${
          ran
            ? `<dl class="stats">
                <div><dt>Reviewed</dt><dd>${counts.reviewed}</dd></div>
                <div><dt>New cards</dt><dd>${counts.introduced}</dd></div>
              </dl>`
            : ""
        }
      </div>`;
  }

  async function onAction(act) {
    if (act === "reveal") revealed = true;
    else if (act === "again") await onGrade("again");
    else if (act === "good") await onGrade("good");
    else if (act === "continue") await onIntroContinue();
  }

  return { render, onAction, restart: start };
}
