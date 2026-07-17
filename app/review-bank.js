// Knowledge (second-brain) deck loader. Ships alongside the word bank,
// built from David's #review notes by tools/review_import.mjs. Cards are
// { id: "kn:...", type, prompt, answer, source }. Absent or empty is a
// normal state (no cards approved yet); the Review tab just says so.

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
    reviewBank = { app: "bonmot-review", version: 1, cards: [] };
  }
  reviewBank.byId = new Map(reviewBank.cards.map((c) => [c.id, c]));
  return reviewBank;
}
