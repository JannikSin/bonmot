// Knowledge deck loader. Ships alongside the word bank, holding every
// non-vocab card: hand-authored themed decks (RDE vocab, SpaceX interview
// prep, one pre-reading vocab list per paper) plus #review second-brain
// cards from tools/review_import.mjs. Cards are
// { id: "kn:...", deck, type, prompt, answer, source }; a card with no
// deck belongs to the default "brain" deck (the #review pipeline output).
// Decks are named by the optional top-level `decks` manifest. Absent or
// empty is a normal state; the Review tab just says so.

const DEFAULT_DECK = "brain";

let reviewBank = null;

export async function loadReviewBank() {
  if (reviewBank) return reviewBank;
  try {
    const res = await fetch("./data/review.json");
    if (res.ok) reviewBank = await res.json();
  } catch {
    /* offline first run before this deck was cached: treat as empty */
  }
  if (!reviewBank || !Array.isArray(reviewBank.cards)) {
    reviewBank = { app: "bonmot-review", version: 1, decks: [], cards: [] };
  }
  if (!Array.isArray(reviewBank.decks)) reviewBank.decks = [];
  for (const c of reviewBank.cards) if (!c.deck) c.deck = DEFAULT_DECK;
  reviewBank.byId = new Map(reviewBank.cards.map((c) => [c.id, c]));
  return reviewBank;
}

// Mature = FSRS stability of at least this many days (matches SCHEMA).
const MATURE_DAYS = 21;

// Decks that actually have cards, each with its live new/due/mastered
// counts, in manifest order (manifest-less decks fall to the end,
// insertion order). A deck with a manifest entry but zero cards is
// omitted: nothing to study. `mastered` counts seen cards whose FSRS
// stability has passed the mature threshold, an honest per-deck strength.
export function deckSummaries(reviewBank, progress, now) {
  const counts = new Map(); // deckId -> { total, due, seen, mastered }
  for (const c of reviewBank.cards) {
    const d = counts.get(c.deck) || { total: 0, due: 0, seen: 0, mastered: 0 };
    d.total++;
    counts.set(c.deck, d);
  }
  for (const p of progress.values()) {
    if (!p.id.startsWith("kn:")) continue;
    const card = reviewBank.byId.get(p.id);
    if (!card) continue;
    const d = counts.get(card.deck);
    if (!d) continue;
    d.seen++;
    if (p.state === "learning" && new Date(p.card.due) <= now) d.due++;
    if ((p.card.stability || 0) >= MATURE_DAYS) d.mastered++;
  }
  const manifest = new Map(reviewBank.decks.map((d, i) => [d.id, { ...d, order: i }]));
  return [...counts.entries()]
    .map(([id, c]) => {
      const m = manifest.get(id) || { label: id, blurb: "", order: 999, group: "", tags: [] };
      return {
        id,
        label: m.label,
        blurb: m.blurb,
        group: m.group || "",
        tags: m.tags || [],
        order: m.order,
        new: c.total - c.seen,
        due: c.due,
        seen: c.seen,
        mastered: c.mastered,
        total: c.total,
      };
    })
    .sort((a, b) => a.order - b.order);
}

// Search decks by label, blurb, tags, or folder group; case and space
// insensitive, all query words must match somewhere. Returns the same
// summary shape, filtered.
export function searchDecks(summaries, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return summaries;
  return summaries.filter((d) => {
    const hay = `${d.label} ${d.blurb} ${d.group} ${(d.tags || []).join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// Search card CONTENT (prompt + answer) across every deck. This is the
// "an author reuses the same terms" lookup: type a term, see which decks
// mention it and how often. Returns [{ deckId, count, sample }] sorted by
// count. All query words must appear in the card.
export function searchCards(reviewBank, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = new Map(); // deckId -> { count, sample }
  for (const c of reviewBank.cards) {
    const hay = `${c.prompt} ${c.answer}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const h = hits.get(c.deck) || { count: 0, sample: c.prompt };
    h.count++;
    hits.set(c.deck, h);
  }
  return [...hits.entries()]
    .map(([deckId, h]) => ({ deckId, count: h.count, sample: h.sample }))
    .sort((a, b) => b.count - a.count);
}
