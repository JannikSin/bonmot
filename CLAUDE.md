# CLAUDE.md, Bonmot

Rules for every Claude session working on Bonmot. Sibling project to Mise; same discipline.

## Coding principles
Karpathy set, same as Mise: think before coding (state assumptions, surface tradeoffs), simplicity first (minimum code, no speculative abstractions), surgical changes (every changed line traces to the request), goal-driven execution (define done, verify it).

## Architecture rules (non-negotiable)
1. **Zero-build static PWA.** No bundler, no framework, no runtime dependencies beyond the vendored `ts-fsrs` and Fraunces fonts. Any new dependency needs David's approval and a Tribunal re-review.
2. **Offline is life-or-death.** The primary use is a no-signal train commute. Every change must survive: kill the server, reload, complete a session. The service worker (network-first app+data, cache-first vendor/icons) is inherited from Mise; do not reinvent it. Bump `CACHE_VERSION` in `sw.js` when vendor/icons change.
3. **Progress data never leaves the device.** No sync, no analytics, no external origins (CSP enforces it). Export/import is the durability layer. Never commit a real progress export; `.gitignore` blocks the pattern, tests use synthetic fixtures.
4. **Word bank integrity.** `data/en.json` ids are stable slugs; NEVER renumber (user progress is keyed on them). The validator merges over the existing bank (add/update by id, never drop), so regeneration cannot orphan progress. No em or en dashes ANYWHERE David reads: bank strings, UI copy, docs (validator + `tests/dashes.test.js` enforce; vendor/ exempt). Definitions are original teaching-voice prose, never dictionary phrasing. Grow the bank via batches + `npm run validate <batch-dir>` (dictionary cross-check included).
5. **Schema changes update `docs/SCHEMA.md` in the same commit.**
6. **No settings, no knobs.** The philosophy is Mise's "take the choices away": open, do today's session, done. Push back on any feature that adds configuration.
7. **Honest stats only.** Retention over vanity. The streak stays forgiving (one grace day per week). No guilt mechanics, no XP, no mascots.

## Verification pipeline
1. `npm test` green (35+ engine tests plus bank guards).
2. For UI/flow changes: serve locally, exercise the real flow in a browser, verify offline reload still works.
3. Non-trivial changes face the Tribunal (David's skill) before being called done.
