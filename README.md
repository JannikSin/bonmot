# Bonmot

One bounded daily session of difficult vocabulary. Open it, finish it, close it.

Bonmot replaces the word-an-hour notification app pattern with what the memory research actually supports: active recall (you try to retrieve the meaning before seeing it), FSRS spaced repetition (each word returns right before you would forget it), and a session that ends. No accounts, no server, no notifications, no settings, no subscription. It runs entirely on your device and works with zero signal.

## Install on iPhone

1. Open the app URL in Safari.
2. Tap the share button, then **Add to Home Screen**.
3. Open it from the home screen icon from now on.

Installing matters: in a browser tab, iOS deletes site storage after 7 days of disuse. Installed, your progress persists, and the Shelf's **Export progress** button gives you a backup file that makes it permanent regardless.

## How it works

- **First run**: a 16-word adaptive placement finds your starting tier (I to IV). Under 3 minutes.
- **Today**: due reviews first (recall, reveal, then *Again* or *Got it*), then a few new words. New-word intake throttles itself when review debt builds, so a missed week never becomes a mountain. The session ends with honest numbers: retention percent is the headline, the streak forgives one missed day per week.
- **Already know it** on any new word removes it permanently, after one confirmation resurface weeks later to catch overconfidence.
- **Flag** (⚑) buries an entry with a mistake in it and lists it on the Shelf.
- **Shelf**: retention, streak, word states, backup export/import, placement re-run.

## The word bank

500 entries across four difficulty tiers, from serious-journalism hard (tier I) to word-lover rare (tier IV). Every entry: original definitions, two example sentences, an etymology memory hook, roots, synonyms, register. IPA pronunciation appears where verified against a dictionary source. Definitions are original teaching-voice prose (see `docs/SCHEMA.md`); the word bank content is released under CC0.

To grow or fix the bank: edit `data/en.json` (ids are stable slugs; progress survives regeneration) or add generated batches and run `npm run validate`.

## Development

Zero-build static files. `npx serve` (or any static server) from the repo root to run locally.

```
npm test          # engine test suites (FSRS wrapper, queue, streak, placement, import)
npm run validate  # word-bank schema + dictionary cross-check
```

Architecture notes are in `docs/SCHEMA.md` and `docs/ROADMAP.md`. The service worker follows the network-first-for-code, cache-first-for-vendor pattern proven in [mise](https://github.com/JannikSin/mise).

## License

Code MIT (see LICENSE). Word bank content (`data/*.json`) CC0.
