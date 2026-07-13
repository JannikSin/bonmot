// Today: the one session. Reviews, resurfaces, new words; ends at an
// honest done screen. Open it, finish it, close it.

import { grade, newProgress, knownProgress } from "../srs.js";
import {
  buildSession,
  requeue,
  dueWithinSession,
  INTRO_GAP,
  newWordBudget,
} from "../queue.js";
import { updateStreak, recordOutcome, retention } from "../stats.js";
import { headwordHtml, bodyHtml } from "./entry.js";

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function createTodayView(ctx) {
  const { bank, progress, meta, saveProgress, saveMeta } = ctx;
  let session = null;
  let revealed = false;
  let counts = { reviewed: 0, correct: 0, introduced: 0 };

  function start() {
    const day = today();
    if (meta.introDay !== day) {
      meta.introDay = day;
      meta.introUsedToday = 0;
    }
    session = buildSession(bank, progress, meta, new Date());
    counts = { reviewed: 0, correct: 0, introduced: 0 };
    revealed = false;
  }

  function current() {
    return session && session.items[session.index || 0];
  }

  async function advance() {
    session.index = (session.index || 0) + 1;
    revealed = false;
  }

  async function onGrade(rating) {
    const item = current();
    const now = new Date();
    const p = progress.get(item.id);
    const next = grade(p, rating, now);
    progress.set(item.id, next);
    await saveProgress(next);
    counts.reviewed++;
    if (rating === "good") counts.correct++;
    meta.recent = recordOutcome(meta.recent, rating === "good");
    await saveMeta(meta);
    if (dueWithinSession(next, now)) {
      session.items = requeue(session.items, session.index || 0, item.id);
    }
    await advance();
  }

  async function onIntroContinue() {
    const item = current();
    const now = new Date();
    const p = newProgress(item.id, now);
    progress.set(item.id, p);
    await saveProgress(p);
    counts.introduced++;
    meta.introUsedToday = (meta.introUsedToday || 0) + 1;
    await saveMeta(meta);
    session.items = requeue(session.items, session.index || 0, item.id, INTRO_GAP);
    await advance();
  }

  async function onAlreadyKnow() {
    const item = current();
    const p = knownProgress(item.id, new Date());
    progress.set(item.id, p);
    await saveProgress(p);
    meta.introUsedToday = (meta.introUsedToday || 0) + 1;
    await saveMeta(meta);
    await advance();
  }

  async function onResurface(stillKnows) {
    const item = current();
    const now = new Date();
    let p = progress.get(item.id);
    if (stillKnows) {
      p = { ...p, resurfaceDone: true };
    } else {
      p = { ...newProgress(item.id, now), addedAt: p.addedAt };
    }
    progress.set(item.id, p);
    await saveProgress(p);
    await advance();
  }

  async function onFlag() {
    const item = current();
    let p = progress.get(item.id) || newProgress(item.id, new Date());
    p = { ...p, state: "buried" };
    progress.set(item.id, p);
    await saveProgress(p);
    meta.flagged = [...(meta.flagged || []), item.id];
    await saveMeta(meta);
    await advance();
  }

  async function onDone() {
    const day = today();
    if (meta.sessionDoneDay !== day) {
      Object.assign(meta, updateStreak(meta, day));
      meta.sessionDoneDay = day;
      meta.sessionsCompleted = (meta.sessionsCompleted || 0) + 1;
    }
    await saveMeta(meta);
  }

  function render(el) {
    if (!session) start();
    const item = current();
    if (!item) {
      onDone();
      el.innerHTML = doneHtml();
      return;
    }
    const w = bank.byId.get(item.id);
    const n = (session.index || 0) + 1;
    const total = session.items.length;
    if (item.kind === "intro") {
      el.innerHTML = `
        <div class="card" data-kind="intro">
          <p class="eyebrow">new word · ${n} of ${total}</p>
          <button class="flag" data-act="flag" aria-label="Flag a mistake in this entry">⚑</button>
          ${headwordHtml(w)}
          <div class="entry-body open">${bodyHtml(w)}</div>
          <div class="actions">
            <button class="ghost" data-act="know">Already know it</button>
            <button class="primary" data-act="continue">Continue</button>
          </div>
        </div>`;
    } else if (item.kind === "resurface") {
      el.innerHTML = `
        <div class="card" data-kind="resurface">
          <p class="eyebrow">still with you?</p>
          ${headwordHtml(w, { withIpa: false })}
          ${revealed ? `<div class="entry-body open">${bodyHtml(w)}</div>` : ""}
          <div class="actions">
            ${
              revealed
                ? `<button class="ghost" data-act="shaky">It was shaky</button>
                   <button class="primary" data-act="still">Still know it</button>`
                : `<button class="primary wide" data-act="reveal">Check the meaning</button>`
            }
          </div>
        </div>`;
    } else {
      el.innerHTML = `
        <div class="card" data-kind="review">
          <p class="eyebrow">review · ${n} of ${total}</p>
          <button class="flag" data-act="flag" aria-label="Flag a mistake in this entry">⚑</button>
          ${headwordHtml(w, { withIpa: revealed })}
          ${revealed ? `<div class="entry-body open">${bodyHtml(w)}</div>` : `<p class="recall-hint">Recall the meaning, then reveal.</p>`}
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
    const ret = retention(meta.recent);
    const deferred =
      session.dueDeferred > 0
        ? `<p class="honest">${session.dueDeferred} more were due today; they lead tomorrow's session.</p>`
        : "";
    const backupAge = meta.lastBackup
      ? Math.floor((Date.now() - new Date(meta.lastBackup)) / 864e5)
      : null;
    const backupNudge =
      backupAge === null || backupAge > 14
        ? `<p class="honest warn">No recent backup. Export your progress from the Shelf.</p>`
        : "";
    const nothingRan = counts.reviewed + counts.introduced === 0;
    return `
      <div class="card done">
        <p class="fleuron">❦</p>
        <h1 class="done-title">${nothingRan ? "Nothing due right now" : "Session complete"}</h1>
        ${nothingRan ? `<p class="honest">Today's session is done. The next reviews arrive with tomorrow.</p>` : ""}
        <dl class="stats">
          <div><dt>Reviewed</dt><dd>${counts.reviewed}</dd></div>
          <div><dt>New words</dt><dd>${counts.introduced}</dd></div>
          <div><dt>Retention</dt><dd>${ret === null ? "–" : ret + "%"}</dd></div>
          <div><dt>Streak</dt><dd>${meta.streakCount || 0} day${(meta.streakCount || 0) === 1 ? "" : "s"}</dd></div>
        </dl>
        ${deferred}
        ${backupNudge}
      </div>`;
  }

  async function onAction(act) {
    if (act === "reveal") revealed = true;
    else if (act === "again") await onGrade("again");
    else if (act === "good") await onGrade("good");
    else if (act === "continue") await onIntroContinue();
    else if (act === "know") await onAlreadyKnow();
    else if (act === "still") await onResurface(true);
    else if (act === "shaky") await onResurface(false);
    else if (act === "flag") await onFlag();
  }

  return { render, onAction, restart: start, budgetPreview: () => newWordBudget(0) };
}
