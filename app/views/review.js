// Review decks: the knowledge sessions. A searchable, foldered deck
// picker with a Fortress button on top, then FSRS sessions. Recall first
// on every card, with an optional write mode. Cards can carry a memory
// hook (a mnemonic or image, shown on reveal, and you can write your own)
// and a reworded reverse clue so the app can quiz you definition to term
// without letting you pattern match the memorized wording. Fortress mode
// draws random cards from the whole library, interleaved, to defend
// everything at once.

import { grade, newProgress, isDue } from "../srs.js";
import { requeue, dueWithinSession, INTRO_GAP } from "../queue.js";
import { deckSummaries, searchDecks, searchCards, atRiskCards, groupByFolder } from "../review-bank.js";
import { markSessionDone, dayStr } from "../stats.js";
import { esc, progressHtml, writeToggleHtml, writeInputHtml, typedAnswerHtml } from "./entry.js";

const NEW_CAP = 10;
const REVIEW_CAP = 60;
const FORTRESS = "__fortress__";
const FORTRESS_CAP = 40;

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
function sample(a, n) {
  return shuffle(a).slice(0, n);
}

// deckId null = every knowledge deck (used by tests); a deck id restricts
// the session to that one deck's cards.
export function buildReviewSession(reviewBank, progress, now, deckId = null) {
  const inDeck = (id) => !deckId || reviewBank.byId.get(id)?.deck === deckId;
  const known = [...progress.values()].filter((p) => p.id.startsWith("kn:") && inDeck(p.id));
  const due = known
    .filter((p) => p.state === "learning" && isDue(p, now))
    .sort((a, b) => new Date(a.card.due) - new Date(b.card.due))
    .slice(0, REVIEW_CAP);
  const fresh = reviewBank.cards
    .filter((c) => (!deckId || c.deck === deckId) && !progress.has(c.id))
    .slice(0, NEW_CAP);
  const items = [
    ...due.map((p) => ({ kind: "review", id: p.id })),
    ...fresh.map((c) => ({ kind: "intro", id: c.id })),
  ];
  return { items, index: 0 };
}

// Fortress: random instances from the ENTIRE library, interleaved, so one
// session defends every deck. Due cards first (uncapped into the pool),
// then a random sample of already-known cards for extra defense, plus a
// few new, all shuffled together and capped. Exported so the pool logic
// is testable; the view calls it with its own bank/progress.
export function buildFortressSession(reviewBank, progress, now) {
  const learning = [...progress.values()].filter((p) => p.id.startsWith("kn:") && p.state === "learning");
  const due = learning.filter((p) => new Date(p.card.due) <= now).map((p) => p.id);
  const notDue = learning.filter((p) => new Date(p.card.due) > now).map((p) => p.id);
  const fresh = reviewBank.cards.filter((c) => !progress.has(c.id)).map((c) => c.id);
  const pool = [...new Set([...due, ...sample(notDue, 12), ...sample(fresh, 6)])];
  const items = shuffle(pool)
    .slice(0, FORTRESS_CAP)
    .map((id) => ({ kind: progress.has(id) ? "review" : "intro", id }));
  return { items, index: 0 };
}

export function createReviewView(ctx) {
  const { reviewBank, progress, saveProgress, meta, saveMeta } = ctx;
  if (!meta.hooks) meta.hooks = {};
  let deckId = null; // null = deck picker
  let query = "";
  let writeMode = false;
  let typedAnswer = "";
  let curDir = "forward"; // per-card direction, fixed at show time
  let hookEditing = false;
  let session = null;
  let revealed = false;
  let donePosted = false;
  let counts = { reviewed: 0, correct: 0, introduced: 0 };
  let sessionLapses = new Map();

  function pickDir() {
    const item = current();
    const c = item && reviewBank.byId.get(item.id);
    // Reverse only on genuine review (not first exposure) and only when a
    // reworded clue exists. ~45% of the time, for variety.
    curDir = c && c.reverse && item.kind !== "intro" && Math.random() < 0.45 ? "reverse" : "forward";
  }

  function start(id) {
    deckId = id;
    session =
      id === FORTRESS
        ? buildFortressSession(reviewBank, progress, new Date())
        : buildReviewSession(reviewBank, progress, new Date(), id);
    counts = { reviewed: 0, correct: 0, introduced: 0 };
    sessionLapses = new Map();
    revealed = false;
    typedAnswer = "";
    hookEditing = false;
    donePosted = false;
    pickDir();
  }

  function toPicker() {
    deckId = null;
    session = null;
    revealed = false;
    typedAnswer = "";
    hookEditing = false;
  }

  function deckLabel(id = deckId) {
    if (id === FORTRESS) return "Fortress";
    const d = reviewBank.decks.find((d) => d.id === id);
    return d ? d.label : id;
  }

  function current() {
    return session && session.items[session.index];
  }
  function advance() {
    session.index++;
    revealed = false;
    typedAnswer = "";
    hookEditing = false;
    pickDir();
  }
  function hookOf(card) {
    return meta.hooks[card.id] || card.hook || "";
  }

  async function postDone() {
    if (donePosted) return;
    donePosted = true;
    if (counts.reviewed + counts.introduced > 0) {
      markSessionDone(meta, dayStr());
      await saveMeta();
    }
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

  async function saveHook() {
    const box = document.querySelector("[data-hookedit]");
    const item = current();
    if (box && item) {
      const v = box.value.trim();
      if (v) meta.hooks[item.id] = v;
      else delete meta.hooks[item.id];
      await saveMeta();
    }
    hookEditing = false;
  }

  function render(el) {
    if (deckId === null) {
      el.innerHTML = pickerHtml();
      return;
    }
    const item = current();
    if (!item) {
      postDone();
      el.innerHTML = doneHtml();
      return;
    }
    const c = reviewBank.byId.get(item.id);
    if (!c) {
      advance();
      return render(el);
    }
    const n = session.index + 1;
    const total = session.items.length;
    const reverse = curDir === "reverse";
    const hook = hookOf(c);
    const cardDeck = deckId === FORTRESS ? deckLabel(c.deck) : deckLabel();
    const kindLabel = item.kind === "intro" ? "new card" : reverse ? "name it" : c.type === "cloze" ? "cloze" : "recall";
    const eyebrow = `${esc(cardDeck)} &middot; ${kindLabel} &middot; ${n} of ${total}`;

    // The prompt: forward shows the term/question; reverse shows the
    // reworded clue and asks for the term.
    const promptHtml = reverse
      ? `<p class="review-prompt">${esc(c.reverse)}</p>`
      : `<p class="review-prompt">${esc(c.prompt)}</p>`;

    // The answer face. Reverse reveals the term first (that was the goal),
    // then the full explanation. Both show the hook and a place to edit it.
    const hookBlock = hookEditing
      ? `<div class="hook-edit"><textarea class="write-input hook-input" data-hookedit rows="2" placeholder="Your own hook: an image, a rhyme, anything">${esc(meta.hooks[c.id] || "")}</textarea>
           <button class="write-toggle" data-act="hook-save">Save hook</button></div>`
      : hook
        ? `<p class="hook"><span class="label">hook</span> ${esc(hook)} <button class="hook-editbtn" data-act="hook-edit" aria-label="Edit hook">edit</button></p>`
        : `<div class="write-row"><button class="write-toggle" data-act="hook-edit">Add a memory hook</button></div>`;
    const answerInner = reverse
      ? `<p class="reverse-term">${esc(c.prompt)}</p><p class="review-answer">${esc(c.answer)}</p>`
      : `<p class="review-answer">${esc(c.answer)}</p>`;
    const answer = `<div class="entry-body open">${typedAnswerHtml(typedAnswer)}${answerInner}
      ${hookBlock}
      <p class="review-source">${esc(c.source)}</p></div>`;

    const recallHint = reverse
      ? "Name the term this describes, then reveal."
      : item.kind === "intro"
        ? "New card. Try to answer it, then reveal."
        : "Recall it, then reveal.";
    const recallBody = writeMode ? writeInputHtml(reverse) : `<p class="recall-hint">${recallHint}</p>`;
    const tappable = !revealed && !writeMode ? ' card--recall" data-act="reveal' : "";
    const primary =
      item.kind === "intro" && !reverse
        ? `<button class="primary wide" data-act="continue">Continue</button>`
        : `<button class="danger" data-act="again">Again</button>
           <button class="primary" data-act="good">Got it</button>`;

    el.innerHTML = `
      <div class="card${tappable}" data-kind="${item.kind}">
        ${progressHtml(n, total)}
        <p class="eyebrow">${eyebrow}</p>
        <div class="card-main">
          ${promptHtml}
          ${revealed ? answer : recallBody}
        </div>
        <div class="actions">
          ${revealed ? primary : `<button class="primary wide" data-act="reveal">Reveal</button>`}
        </div>
        ${revealed ? "" : `<div class="write-row">${writeToggleHtml(writeMode)}</div>`}
      </div>`;
  }

  // ---------- deck picker ----------

  function deckTile(d) {
    const ready = d.due + d.new;
    const badge =
      ready > 0
        ? `<span class="deck-ready">${d.due} due &middot; ${d.new} new</span>`
        : `<span class="deck-clear">all caught up</span>`;
    const strength =
      d.seen > 0
        ? `<span class="deck-strength"><meter class="strength" min="0" max="${d.total}" value="${d.mastered}" aria-label="${d.mastered} of ${d.total} mastered"></meter><span class="strength-label">${d.mastered}/${d.total} mastered</span></span>`
        : `<span class="strength-label faint">not started</span>`;
    const tags = (d.tags || [])
      .slice(0, 5)
      .map((t) => `<span class="tag">${esc(t)}</span>`)
      .join("");
    return `
      <button class="deck-tile" data-act="deck:${esc(d.id)}">
        <span class="deck-head">
          <span class="deck-label">${esc(d.label)}</span>
          ${badge}
        </span>
        ${d.blurb ? `<span class="deck-blurb">${esc(d.blurb)}</span>` : ""}
        ${strength}
        ${tags ? `<span class="tags">${tags}</span>` : ""}
      </button>`;
  }

  function folderTree(decks) {
    const tops = groupByFolder(decks);
    let out = "";
    for (const [top, t] of tops) {
      out += `<details class="folder" open><summary class="folder-name">${esc(top)}</summary>`;
      out += t.direct.map(deckTile).join("");
      for (const [sub, list] of t.subs) {
        out += `<details class="folder folder--sub" open><summary class="folder-name folder-name--sub">${esc(sub)}</summary>${list.map(deckTile).join("")}</details>`;
      }
      out += `</details>`;
    }
    return out;
  }

  function mentionsHtml(hits, all) {
    if (!hits.length) return "";
    const labelOf = (id) => all.find((d) => d.id === id)?.label || id;
    const rows = hits
      .map(
        (h) => `
      <button class="mention" data-act="deck:${esc(h.deckId)}">
        <span class="mention-head"><span class="mention-deck">${esc(labelOf(h.deckId))}</span>
        <span class="mention-count">${h.count} card${h.count === 1 ? "" : "s"}</span></span>
        <span class="mention-sample">${esc(h.sample)}</span>
      </button>`,
      )
      .join("");
    return `<div class="mentions"><p class="eyebrow">Mentioned in cards</p>${rows}</div>`;
  }

  function fortressBtn() {
    const now = new Date();
    const dueTotal = [...progress.values()].filter(
      (p) => p.id.startsWith("kn:") && p.state === "learning" && new Date(p.card.due) <= now,
    ).length;
    // Honest about what it draws: due cards first, then a shuffled spread
    // across your decks. Not literally every card at once.
    const sub =
      dueTotal > 0
        ? `${dueTotal} due, then a spread across your decks`
        : "a shuffled spread across your decks";
    return `<button class="fortress-btn" data-act="fortress">
        <span class="fortress-title">Fortress</span>
        <span class="fortress-sub">${sub}</span>
      </button>`;
  }

  function pickerHtml() {
    const all = deckSummaries(reviewBank, progress, new Date());
    if (all.length === 0) {
      return `
        <div class="card done">
          <p class="fleuron">&#10086;</p>
          <h1 class="done-title">No review decks yet</h1>
          <p class="honest">No review decks yet. Once decks are added they show up here to study.</p>
        </div>`;
    }
    const q = query.trim();
    const decks = q ? searchDecks(all, q) : all;
    const hits = q ? searchCards(reviewBank, q) : [];
    const search = `<div class="deck-search"><input type="search" class="search-input" data-search placeholder="Search decks, authors, topics, card text" value="${esc(query)}" aria-label="Search decks, authors, and card text"></div>`;
    let body;
    if (!decks.length && !hits.length) {
      body = `<p class="no-results">Nothing matches &ldquo;${esc(q)}&rdquo;.</p>`;
    } else {
      body = decks.length ? folderTree(decks) : "";
    }
    return `
      <div class="deck-list">
        ${q ? "" : fortressBtn()}
        <p class="eyebrow">Decks</p>
        ${search}
        ${body}
        ${mentionsHtml(hits, all)}
      </div>`;
  }

  function doneHtml() {
    const ran = counts.reviewed + counts.introduced > 0;
    const title = ran ? "complete" : "nothing due here";
    const body = ran
      ? "The next cards arrive as they come due."
      : "No cards are scheduled yet. New ones arrive with tomorrow.";
    return `
      <div class="card done">
        <p class="fleuron">&#10086;</p>
        <h1 class="done-title">${esc(deckLabel())}: ${title}</h1>
        <p class="honest">${esc(body)}</p>
        ${
          ran
            ? `<dl class="stats">
                <div><dt>Reviewed</dt><dd>${counts.reviewed}</dd></div>
                <div><dt>New cards</dt><dd>${counts.introduced}</dd></div>
                <div><dt>Streak</dt><dd>${meta.streakCount || 0} day${(meta.streakCount || 0) === 1 ? "" : "s"}</dd></div>
              </dl>`
            : ""
        }
        <div class="actions">
          <button class="primary wide" data-act="decks">Back to decks</button>
        </div>
      </div>`;
  }

  function onSearch(q) {
    query = q;
  }

  async function onAction(act) {
    if (act === "decks") toPicker();
    else if (act === "fortress") start(FORTRESS);
    else if (act.startsWith("deck:")) start(act.slice(5));
    else if (act === "write-on") writeMode = true;
    else if (act === "write-off") writeMode = false;
    else if (act === "hook-edit") hookEditing = true;
    else if (act === "hook-save") await saveHook();
    else if (act === "reveal") {
      const ta = document.querySelector("[data-write]");
      if (ta) typedAnswer = ta.value;
      revealed = true;
    } else if (act === "again") await onGrade("again");
    else if (act === "good") await onGrade("good");
    else if (act === "continue") await onIntroContinue();
  }

  return { render, onAction, onSearch, restart: toPicker };
}
