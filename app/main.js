// Boot: service worker, storage persistence, bank + progress load,
// two-tab routing (Today / Shelf), first-run placement gate.

import { loadBank } from "./bank.js";
import { loadReviewBank } from "./review-bank.js";
import {
  loadProgress,
  loadMeta,
  saveProgress,
  saveMeta,
  requestPersistence,
} from "./store.js";
import { createTodayView } from "./views/today.js";
import { createReviewView } from "./views/review.js";
import { createMapView } from "./views/map.js";
import { createShelfView } from "./views/shelf.js";
import { createPlacementView } from "./views/placement-view.js";

const viewEl = document.getElementById("view");
const navEl = document.getElementById("nav");

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

async function boot() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  requestPersistence();

  const [bank, reviewBank, progress, meta] = await Promise.all([
    loadBank(),
    loadReviewBank(),
    loadProgress(),
    loadMeta(),
  ]);

  const ctx = {
    bank,
    reviewBank,
    progress,
    meta,
    saveProgress,
    saveMeta: () => saveMeta(meta),
    isStandalone: isStandalone(),
  };

  let route = meta.placementDone ? "today" : "placement";
  let todayView = null;
  let reviewView = null;
  let mapView = null;
  let shelfView = null;
  let placementView = null;

  function go(r) {
    route = r;
    render();
  }

  // Tapping a deck box (or the Fortress button) on the Map starts that
  // session on Review.
  function onOpenDeck(id) {
    if (!reviewView) reviewView = createReviewView(ctx);
    reviewView.onAction(id === "__fortress__" ? "fortress" : "deck:" + id);
    go("review");
  }

  function render() {
    navEl.hidden = route === "placement";
    for (const b of navEl.querySelectorAll("button")) {
      b.classList.toggle("active", b.dataset.route === route);
    }
    if (route === "placement") {
      if (!placementView) {
        placementView = createPlacementView({
          ...ctx,
          onFinished: () => {
            placementView = null;
            todayView = null;
            go("today");
          },
        });
      }
      placementView.render(viewEl);
    } else if (route === "review") {
      if (!reviewView) reviewView = createReviewView(ctx);
      reviewView.render(viewEl);
    } else if (route === "map") {
      if (!mapView) mapView = createMapView({ ...ctx, onOpenDeck });
      mapView.render(viewEl);
    } else if (route === "shelf") {
      shelfView = createShelfView({
        ...ctx,
        refresh: render,
        onPlacementRerun: () => {
          meta.placementDone = false;
          placementView = null;
          go("placement");
        },
      });
      shelfView.render(viewEl);
    } else {
      if (!todayView) todayView = createTodayView(ctx);
      todayView.render(viewEl);
    }
  }

  viewEl.addEventListener("click", async (e) => {
    const routeBtn = e.target.closest("[data-route]");
    if (routeBtn) {
      go(routeBtn.dataset.route);
      return;
    }
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    const active =
      route === "placement"
        ? placementView
        : route === "today"
          ? todayView
          : route === "review"
            ? reviewView
            : route === "map"
              ? mapView
              : null;
    if (active && active.onAction) {
      await active.onAction(act);
      render();
    }
  });

  navEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-route]");
    if (!btn) return;
    if (btn.dataset.route === "today" && route !== "today") todayView = null;
    if (btn.dataset.route === "review" && route !== "review") reviewView = null;
    go(btn.dataset.route);
  });

  // Live deck search (Review tab). Re-render on each keystroke and put
  // focus and caret back, since render replaces the whole view.
  viewEl.addEventListener("input", (e) => {
    const box = e.target.closest("[data-search]");
    if (!box) return;
    if (route === "review" && reviewView && reviewView.onSearch) {
      const caret = box.selectionStart;
      reviewView.onSearch(box.value);
      render();
      const nb = viewEl.querySelector("[data-search]");
      if (nb) {
        nb.focus();
        try {
          nb.setSelectionRange(caret, caret);
        } catch {
          /* some input types disallow setSelectionRange */
        }
      }
    }
  });

  // Keyboard for desktop: space or enter takes the primary action
  // (reveal, then continue or got-it); 1 marks it wrong, 2 marks it
  // right. Clicks the real buttons so it rides the same handler.
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const click = (sel) => {
      const b = viewEl.querySelector(sel);
      if (b) b.click();
      return !!b;
    };
    if (e.key === " " || e.key === "Enter") {
      if (click(".actions .primary")) e.preventDefault();
    } else if (e.key === "1") {
      click('.actions [data-act="again"], .actions [data-act="shaky"], .actions [data-act="know"]');
    } else if (e.key === "2") {
      click('.actions [data-act="good"], .actions [data-act="still"], .actions [data-act="continue"]');
    }
  });

  render();
}

boot().catch((err) => {
  viewEl.innerHTML = `<div class="card"><h1 class="done-title">Could not start</h1><p class="honest warn"></p></div>`;
  viewEl.querySelector(".honest").textContent = String(err);
});
