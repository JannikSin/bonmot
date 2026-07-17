// Shelf: honest stats, backup (the real durability layer), flagged
// entries, install nudge, placement re-run. No settings.

import { retention } from "../stats.js";
import { isMature } from "../srs.js";
import { exportState, importState, validateImport, saveMeta } from "../store.js";
import { esc } from "./entry.js";

export function createShelfView(ctx) {
  const { bank, reviewBank, progress, meta, isStandalone, onPlacementRerun, refresh } = ctx;

  // Import keeps knowledge (kn:) progress alive: its ids must be in the
  // valid-id set or validateImport would drop them as unknown.
  const allBankIds = new Set([
    ...bank.words.map((w) => w.id),
    ...((reviewBank && reviewBank.cards) || []).map((c) => c.id),
  ]);

  function countStates() {
    let learning = 0;
    let mature = 0;
    let known = 0;
    let buried = 0;
    for (const p of progress.values()) {
      if (p.id.startsWith("kn:")) continue; // vocab stats only
      if (p.state === "known") known++;
      else if (p.state === "buried") buried++;
      else if (isMature(p)) mature++;
      else learning++;
    }
    const remaining = bank.words.length - learning - mature - known - buried;
    return { learning, mature, known, buried, remaining };
  }

  async function doExport() {
    const state = await exportState();
    const blob = new Blob([JSON.stringify(state, null, 1)], {
      type: "application/json",
    });
    const name = `bonmot-backup-${state.exportedAt.slice(0, 10)}.progress.json`;
    const file = new File([blob], name, { type: "application/json" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Bonmot backup" });
      } catch {
        return; // user cancelled the share sheet
      }
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    meta.lastBackup = new Date().toISOString();
    await saveMeta(meta);
    refresh();
  }

  async function doImport(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      alert("That file is not valid JSON.");
      return;
    }
    const bankIds = allBankIds;
    const preview = validateImport(data, bankIds);
    if (
      preview.ok &&
      preview.cleaned.length < progress.size &&
      !confirm(
        `This backup has ${preview.cleaned.length} words; you currently have ${progress.size}. Replace anyway?`,
      )
    ) {
      return;
    }
    const verdict = await importState(data, allBankIds);
    if (!verdict.ok) {
      alert(verdict.reason);
      return;
    }
    const note =
      verdict.dropped > 0 ? ` (${verdict.dropped} unrecognized records skipped)` : "";
    alert(`Backup restored: ${verdict.cleaned.length} words${note}. Reloading.`);
    location.reload();
  }

  function render(el) {
    const c = countStates();
    const ret = retention(meta.recent);
    const backupAge = meta.lastBackup
      ? Math.floor((Date.now() - new Date(meta.lastBackup)) / 864e5)
      : null;
    const backupLine =
      backupAge === null
        ? `<p class="honest warn">Never backed up. iOS can evict app storage; the backup file is what makes progress permanent.</p>`
        : backupAge > 14
          ? `<p class="honest warn">Last backup ${backupAge} days ago. Export again.</p>`
          : `<p class="honest">Last backup ${backupAge === 0 ? "today" : backupAge + " days ago"}.</p>`;
    const flagged = (meta.flagged || [])
      .map((id) => bank.byId.get(id))
      .filter(Boolean)
      .map((w) => `<li>${esc(w.word)}</li>`)
      .join("");
    const installNudge = isStandalone
      ? ""
      : `<section class="panel warn-panel">
          <h2>Install Bonmot</h2>
          <p>Running in a browser tab, iOS wipes stored progress after 7 days unused. Install to the home screen: tap the share button, then "Add to Home Screen".</p>
        </section>`;
    el.innerHTML = `
      ${installNudge}
      <section class="panel">
        <h2>The record</h2>
        <dl class="stats">
          <div><dt>Retention</dt><dd>${ret === null ? "n/a" : ret + "%"}</dd></div>
          <div><dt>Streak</dt><dd>${meta.streakCount || 0}</dd></div>
          <div><dt>Learning</dt><dd>${c.learning}</dd></div>
          <div><dt>Mature</dt><dd>${c.mature}</dd></div>
          <div><dt>Known</dt><dd>${c.known}</dd></div>
          <div><dt>Unseen</dt><dd>${c.remaining}</dd></div>
        </dl>
        <p class="honest">Retention is the share of recent reviews you got right. The streak forgives one missed day per week.</p>
      </section>
      <section class="panel">
        <h2>Backup</h2>
        ${backupLine}
        <div class="actions">
          <button class="primary" data-act="export">Export progress</button>
          <label class="ghost file-btn">Import<input type="file" accept=".json,application/json" hidden></label>
        </div>
      </section>
      ${
        flagged
          ? `<section class="panel"><h2>Flagged entries</h2><p class="honest">Buried from reviews; fix them in the repo.</p><ul class="flag-list">${flagged}</ul></section>`
          : ""
      }
      <section class="panel">
        <h2>Placement</h2>
        <p class="honest">Starting tier: ${meta.startTier || 2}. Re-running keeps all progress.</p>
        <div class="actions">
          <button class="ghost" data-act="rerun">Re-run placement</button>
        </div>
      </section>`;
    el.querySelector("[data-act=export]").addEventListener("click", doExport);
    el.querySelector("[data-act=rerun]").addEventListener("click", onPlacementRerun);
    el.querySelector("input[type=file]").addEventListener("change", (e) => {
      if (e.target.files[0]) doImport(e.target.files[0]);
    });
  }

  return { render };
}
