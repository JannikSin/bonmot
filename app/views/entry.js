// Dictionary-entry renderer shared by Today (intro/reveal) and
// placement. The headword treatment is the app's signature: big
// Fraunces display, small-caps apparatus line, numbered senses.

import { romanTier } from "../bank.js";

// Session progress as a thin filled rule (letterpress hairline that
// fills with gilt). Native <progress> so the fill comes from the value
// attribute, not an inline style (the strict CSP blocks inline styles).
// Shared by Today and Review so the two sessions feel like one app.
// n is the current card's 1-based position.
export function progressHtml(n, total) {
  return `<progress class="progress" value="${n}" max="${total > 0 ? total : 1}" aria-label="card ${n} of ${total}"></progress>`;
}

// Write-mode pieces, shared by Today and Review. Write mode lets you
// type your recalled answer before revealing (the generation effect),
// then compare it against the real one. Self-graded: no fragile string
// matching. All CSP-safe (no inline styles).
export function writeToggleHtml(on) {
  return on
    ? `<button class="write-toggle" data-act="write-off">Hide typing</button>`
    : `<button class="write-toggle" data-act="write-on">Type your answer</button>`;
}
export function writeInputHtml(reverse = false) {
  const ph = reverse
    ? "Name the term this describes, then reveal to compare"
    : "Type what you recall, then reveal to compare";
  return `<textarea class="write-input" data-write rows="3" placeholder="${ph}" aria-label="Type your answer"></textarea>`;
}
export function typedAnswerHtml(typed) {
  if (!typed) return "";
  return `<div class="typed"><span class="label">you wrote</span> ${esc(typed)}</div>`;
}

export function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function headwordHtml(w, { withIpa = true } = {}) {
  const ipa = withIpa && w.ipa ? `<span class="ipa">${esc(w.ipa)}</span>` : "";
  return `
    <h1 class="headword">${esc(w.word)}</h1>
    <p class="apparatus">
      <span class="pos">${esc(w.pos)}</span>
      <span class="tier">tier ${romanTier(w.tier)}</span>
      ${w.register ? `<span class="register">${esc(w.register)}</span>` : ""}
      ${ipa}
    </p>`;
}

export function bodyHtml(w) {
  const senses = w.definitions
    .map(
      (d, i) =>
        `<li><span class="sense-num">${i + 1}</span> ${esc(d)}</li>`,
    )
    .join("");
  const examples = w.examples
    .map((e) => `<p class="example">${esc(e)}</p>`)
    .join("");
  const syn =
    w.synonyms && w.synonyms.length
      ? `<p class="syn"><span class="label">near</span> ${w.synonyms.map(esc).join(", ")}</p>`
      : "";
  const ety = w.etymology
    ? `<p class="etymology"><span class="label">origin</span> ${esc(w.etymology)}</p>`
    : "";
  return `
    <ol class="senses">${senses}</ol>
    <div class="examples">${examples}</div>
    ${ety}
    ${syn}`;
}
