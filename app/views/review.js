// Review decks: the knowledge sessions. A searchable, foldered deck
// picker on top, then one FSRS session per chosen deck (due cards first,
// then a capped intake of new ones). Same engine and progress store as
// vocab, separated only by the kn: id prefix; decks separate the
// knowledge cards from each other so a session stays one subject.
// Recall first on every card, with an optional write mode (type your
// answer before revealing). Deliberately thinner than Today: no tiers,
// no resurface, no streak.

import { grade, newProgress, isDue } from "../srs.js";
import { requeue, dueWithinSession, INTRO_GAP } from "../queue.js";
import { deckSummaries, searchDecks, searchCards } from "../review-bank.js";
import { markSessionDone } from "../stats.js";
import { esc, progressHtml, writeToggleHtml, writeInputHtml, typedAnswerHtml } from "./entry.js";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ponytail: fixed daily intake of new knowledge cards. A throttle vs
// review debt (like queue.js newWordBudget) can be added if backlogs bite.
const NEW_CAP = 10;
const REVIEW_CAP = 60;

// deckId null = every knowledge deck (used by tests and the "all" path);
// a deck id restricts the session to that one deck's cards.
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

export function createReviewView(ctx) {
  const { reviewBank, progress, saveProgress, meta, saveMeta } = ctx;
  let deckId = null; // null = showing the deck picker
  let query = "";
  let writeMode = false; // persists across cards in a session
  let typedAnswer = "";
  let session = null;
  let revealed = false;
  let donePosted = false; // streak marked once per finished deck
  let counts = { reviewed: 0, correct: 0, introduced: 0 };
  let sessionLapses = new Map();

  function start(id) {
    deckId = id;
    session = buildReviewSession(reviewBank, progress, new Date(), id);
    counts = { reviewed: 0, correct: 0, introduced: 0 };
    sessionLapses = new Map();
    revealed = false;
    typedAnswer = "";
    donePosted = false;
  }

  // Finishing a Review deck counts toward the same daily study streak as
  // the vocab session (studying is studying). Idempotent per day.
  async function postDone() {
    if (donePosted) return;
    donePosted = true;
    if (counts.reviewed + counts.introduced > 0) {
      markSessionDone(meta, todayStr());
      await saveMeta();
    }
  }

  function toPicker() {
    deckId = null;
    session = null;
    revealed = false;
    typedAnswer = "";
  }

  function deckLabel() {
    const d = reviewBank.decks.find((d) => d.id === deckId);
    return d ? d.label : deckId;
  }

  function current() {
    return session && session.items[session.index];
  }

  function advance() {
    session.index++;
    revealed = false;
    typedAnswer = "";
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
    const label = c.type === "cloze" ? "cloze" : "recall";
    const answer = `<div class="entry-body open">${typedAnswerHtml(typedAnswer)}<p class="review-answer">${esc(c.answer)}</p>
      <p class="review-source">${esc(c.source)}</p></div>`;
    // Tap-to-reveal only when not typing: with the textarea open, a tap
    // must reach the textarea, not flip the card.
    const recall = !revealed;
    const tappable = recall && !writeMode ? ' card--recall" data-act="reveal' : "";
    const recallBody = writeMode
      ? writeInputHtml()
      : `<p class="recall-hint">${item.kind === "intro" ? "New card. Try to answer it, then reveal." : "Recall it, then reveal."}</p>`;
    const eyebrow =
      item.kind === "intro"
        ? `${esc(deckLabel())} &middot; new card &middot; ${n} of ${total}`
        : `${esc(deckLabel())} &middot; ${label} &middot; ${n} of ${total}`;
    const primary =
      item.kind === "intro"
        ? `<button class="primary wide" data-act="continue">Continue</button>`
        : `<button class="danger" data-act="again">Again</button>
           <button class="primary" data-act="good">Got it</button>`;
    el.innerHTML = `
      <div class="card${tappable}" data-kind="${item.kind}">
        ${progressHtml(n, total)}
        <p class="eyebrow">${eyebrow}</p>
        <div class="card-main">
          <p class="review-prompt">${esc(c.prompt)}</p>
          ${revealed ? answer : recallBody}
        </div>
        <div class="actions">
          ${
            revealed
              ? primary
              : `<button class="primary wide" data-act="reveal">Reveal</button>`
          }
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

  // Group decks into folders by their slash-delimited `group` path,
  // preserving manifest order. Native <details> so folders collapse with
  // zero JS (and the CSP has nothing to block).
  function folderTree(decks) {
    const tops = new Map();
    for (const d of decks) {
      const [top, sub] = (d.group || "Other").split("/");
      if (!tops.has(top)) tops.set(top, { direct: [], subs: new Map() });
      const t = tops.get(top);
      if (sub) {
        if (!t.subs.has(sub)) t.subs.set(sub, []);
        t.subs.get(sub).push(d);
      } else {
        t.direct.push(d);
      }
    }
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

  function pickerHtml() {
    const all = deckSummaries(reviewBank, progress, new Date());
    if (all.length === 0) {
      return `
        <div class="card done">
          <p class="fleuron">&#10086;</p>
          <h1 class="done-title">No review decks yet</h1>
          <p class="honest">Themed decks live in data/review.json; #review notes build the second brain deck via npm run review-scan then npm run review-import.</p>
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
        <p class="eyebrow">Decks</p>
        ${search}
        ${body}
        ${mentionsHtml(hits, all)}
      </div>`;
  }

  function doneHtml() {
    const ran = counts.reviewed + counts.introduced > 0;
    const title = ran ? "Deck complete" : "Nothing due here";
    const body = ran
      ? "The next cards arrive as they come due."
      : "No cards in this deck are scheduled yet. New ones arrive with tomorrow.";
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
    else if (act.startsWith("deck:")) start(act.slice(5));
    else if (act === "write-on") writeMode = true;
    else if (act === "write-off") writeMode = false;
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
