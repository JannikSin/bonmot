// Today: the one session. Reviews, resurfaces, new words; ends at an
// honest done screen. Open it, finish it, close it.

import { grade, newProgress, knownProgress } from "../srs.js";
import {
  buildSession,
  requeue,
  dueWithinSession,
  INTRO_GAP,
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
  let flagArmed = false;
  let counts = { reviewed: 0, correct: 0, introduced: 0 };
  // Leech guard: after 3 in-session lapses a card stops requeuing and
  // waits for tomorrow, so one stubborn word can never trap the session.
  let sessionLapses = new Map();

  function start() {
    const day = today();
    if (meta.introDay !== day) {
      meta.introDay = day;
      meta.introUsedToday = 0;
    }
    session = buildSession(bank, progress, meta, new Date());
    counts = { reviewed: 0, correct: 0, introduced: 0 };
    sessionLapses = new Map();
    revealed = false;
    flagArmed = false;
  }

  function current() {
    return session && session.items[session.index || 0];
  }

  async function advance() {
    session.index = (session.index || 0) + 1;
    revealed = false;
    flagArmed = false;
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
    if (rating === "again") {
      sessionLapses.set(item.id, (sessionLapses.get(item.id) || 0) + 1);
    }
    const lapses = sessionLapses.get(item.id) || 0;
    if (dueWithinSession(next, now) && lapses < 3) {
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
    if (!flagArmed) {
      flagArmed = true;
      return;
    }
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
    const flagBtn = flagArmed
      ? `<button class="flag armed" data-act="flag">Tap again to bury this entry</button>`
      : `<button class="flag" data-act="flag" aria-label="Flag a mistake in this entry">⚑</button>`;
    if (item.kind === "intro") {
      el.innerHTML = `
        <div class="card" data-kind="intro">
          <p class="eyebrow">new word · ${n} of ${total}</p>
          ${flagBtn}
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
          ${
            session.dueDeferred > 0 && n === 1
              ? `<p class="honest">Big day after a break: capped at ${session.items.length} cards, the rest waits safely for tomorrow.</p>`
              : ""
          }
          ${flagBtn}
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
        ? `<div class="actions slim"><button class="ghost" data-route="shelf">No recent backup. Export from the Shelf</button></div>`
        : "";
    const installNudge = !ctx.isStandalone
      ? `<p class="honest warn">Running in a browser tab, iOS can wipe progress after 7 days unused. Share button, then "Add to Home Screen" makes it stick.</p>`
      : "";
    const nothingRan = counts.reviewed + counts.introduced === 0;
    const doneToday = meta.sessionDoneDay === today();
    return `
      <div class="card done">
        <p class="fleuron">❦</p>
        <h1 class="done-title">${nothingRan ? (doneToday ? "Done for today" : "Nothing due right now") : "Session complete"}</h1>
        ${nothingRan ? `<p class="honest">${doneToday ? "Today's session is finished." : "No reviews are scheduled yet."} The next reviews arrive with tomorrow.</p>` : ""}
        <dl class="stats">
          <div><dt>Reviewed</dt><dd>${counts.reviewed}</dd></div>
          <div><dt>New words</dt><dd>${counts.introduced}</dd></div>
          <div><dt>Retention</dt><dd>${ret === null ? "n/a" : ret + "%"}</dd></div>
          <div><dt>Streak</dt><dd>${meta.streakCount || 0} day${(meta.streakCount || 0) === 1 ? "" : "s"}</dd></div>
        </dl>
        ${deferred}
        ${installNudge}
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

  return { render, onAction, restart: start };
}
