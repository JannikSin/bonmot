// Dictionary-entry renderer shared by Today (intro/reveal) and
// placement. The headword treatment is the app's signature: big
// Fraunces display, small-caps apparatus line, numbered senses.

import { romanTier } from "../bank.js";

export function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
