// Map: the knowledge library as a picture, not a list. Decks are boxes
// grouped into their folders; each box is shaded by how much of it you
// have mastered (cold hairline to warm gilt), so one glance shows what
// you know and what is still weak. Seeing your knowledge as a spatial
// structure is itself a memory aid (the method of loci in miniature).
// Tap a box to study that deck. Read-only otherwise. All heat is driven
// by bucket classes, never inline styles, so the strict CSP is happy.

import { deckSummaries } from "../review-bank.js";
import { esc } from "./entry.js";

// Ratio of mastered cards to a 0..4 heat bucket.
function heatClass(mastered, total) {
  if (!total) return "heat-0";
  const r = mastered / total;
  if (r <= 0) return "heat-0";
  if (r < 0.25) return "heat-1";
  if (r < 0.5) return "heat-2";
  if (r < 0.85) return "heat-3";
  return "heat-4";
}

export function createMapView(ctx) {
  const { reviewBank, progress } = ctx;

  function box(d) {
    const heat = heatClass(d.mastered, d.total);
    const due = d.due > 0 ? `<span class="map-due" aria-label="${d.due} due">${d.due}</span>` : "";
    return `
      <button class="map-box ${heat}" data-act="deck:${esc(d.id)}" aria-label="${esc(d.label)}, ${d.mastered} of ${d.total} mastered${d.due ? ", " + d.due + " due" : ""}">
        ${due}
        <span class="map-box-label">${esc(d.label)}</span>
        <span class="map-box-count">${d.mastered}/${d.total}</span>
      </button>`;
  }

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
      out += `<section class="map-folder"><h2 class="map-folder-name">${esc(top)}</h2>`;
      if (t.direct.length) out += `<div class="map-grid">${t.direct.map(box).join("")}</div>`;
      for (const [sub, list] of t.subs) {
        out += `<div class="map-sub"><h3 class="map-sub-name">${esc(sub)}</h3><div class="map-grid">${list.map(box).join("")}</div></div>`;
      }
      out += `</section>`;
    }
    return out;
  }

  function render(el) {
    const decks = deckSummaries(reviewBank, progress, new Date());
    if (decks.length === 0) {
      el.innerHTML = `
        <div class="card done">
          <p class="fleuron">&#10086;</p>
          <h1 class="done-title">Nothing to map yet</h1>
          <p class="honest">Study a deck on the Review tab and it appears here, shaded by how well you know it.</p>
        </div>`;
      return;
    }
    const totalCards = decks.reduce((s, d) => s + d.total, 0);
    const totalMastered = decks.reduce((s, d) => s + d.mastered, 0);
    const totalDue = decks.reduce((s, d) => s + d.due, 0);
    const pct = totalCards ? Math.round((totalMastered / totalCards) * 100) : 0;
    el.innerHTML = `
      <div class="map-view">
        <p class="eyebrow">Your knowledge</p>
        <dl class="map-totals">
          <div><dt>Mastered</dt><dd>${totalMastered} of ${totalCards}</dd></div>
          <div><dt>Overall</dt><dd>${pct}%</dd></div>
          <div><dt>Due</dt><dd>${totalDue}</dd></div>
        </dl>
        ${folderTree(decks)}
        <div class="map-legend" aria-hidden="true">
          <span class="map-legend-label">less</span>
          <span class="map-swatch heat-0"></span>
          <span class="map-swatch heat-1"></span>
          <span class="map-swatch heat-2"></span>
          <span class="map-swatch heat-3"></span>
          <span class="map-swatch heat-4"></span>
          <span class="map-legend-label">mastered</span>
        </div>
      </div>`;
  }

  async function onAction(act) {
    if (act.startsWith("deck:") && ctx.onOpenDeck) ctx.onOpenDeck(act.slice(5));
  }

  return { render, onAction };
}
