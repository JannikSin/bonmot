# CLAUDE.md, Bonmot

Rules for every Claude session working on Bonmot. Sibling project to Mise; same discipline.

## Coding principles
Karpathy set, same as Mise: think before coding (state assumptions, surface tradeoffs), simplicity first (minimum code, no speculative abstractions), surgical changes (every changed line traces to the request), goal-driven execution (define done, verify it).

## Architecture rules (non-negotiable)
1. **Zero-build static PWA.** No bundler, no framework, no runtime dependencies beyond the vendored `ts-fsrs` and Fraunces fonts. Any new dependency needs David's approval and a Tribunal re-review.
2. **Offline is life-or-death.** The primary use is a no-signal train commute. Every change must survive: kill the server, reload, complete a session. The service worker (network-first app+data, cache-first vendor/icons) is inherited from Mise; do not reinvent it. **Bump `CACHE_VERSION` in `sw.js` on EVERY deploy that changes any shipped file, not just vendor/icons.** The ES module graph is unversioned, so the version bump is what forces one atomic `addAll(SHELL)` that swaps all modules together; without it, an interrupted post-deploy refresh can splice a new module onto a stale cached one and white-screen. Bumping is always safe.
3. **No inline styles or scripts, ever (CSP).** `index.html`'s CSP is `default-src 'none'; script-src 'self'; style-src 'self'` (no `unsafe-inline`), which enforces the privacy promise and is council-locked. It silently drops inline `style="..."` attributes and inline `on*=`/`<script>`. Drive dynamic sizing with native elements (`<progress>`, `<meter>`), attributes, or bucket classes, never an inline style string. Do not add `'unsafe-inline'` or an external origin.
4. **Progress data never leaves the device.** No sync, no analytics, no external origins (CSP enforces it). Export/import is the durability layer. Never commit a real progress export; `.gitignore` blocks the pattern, tests use synthetic fixtures. `store.js: sanitizeMeta` is a strict allowlist, so a NEW meta field must be added there too or it silently vanishes on backup restore.
5. **Word bank integrity.** `data/en.json` and `data/review.json` ids are stable slugs; NEVER renumber (user progress is keyed on them; `meta.hooks` is keyed on card ids too). The validator merges over the existing bank (add/update by id, never drop fields), so regeneration cannot orphan progress. No em or en dashes ANYWHERE David reads: bank strings, UI copy, docs (validator + `tests/dashes.test.js` enforce; vendor/ exempt). Definitions are original teaching-voice prose, never dictionary phrasing. Grow the bank via batches + `npm run validate <batch-dir>` (dictionary cross-check included).
6. **Schema changes update `docs/SCHEMA.md` in the same commit.**
7. **No settings, no knobs.** The philosophy is Mise's "take the choices away": open, do today's session, done. Push back on any feature that adds configuration. Content navigation (decks, folders, search, Map, Fortress) is not a knob; a preference toggle is.
8. **Honest stats only.** Retention over vanity. The streak stays forgiving (one grace day per week) and only counts a day with real work. No guilt mechanics, no XP, no mascots.

## Verification pipeline
1. `npm test` green (35+ engine tests plus bank guards).
2. For UI/flow changes: serve locally, exercise the real flow in a browser, verify offline reload still works.
3. Non-trivial changes face the Tribunal (David's skill) before being called done.
