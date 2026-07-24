# Schemas

Any schema change updates this doc in the same commit.

## Word bank: `data/<lang>.json`

```json
{
  "lang": "en",
  "version": 1,
  "generatedAt": "2026-07-13",
  "words": [
    {
      "id": "perspicacious",
      "word": "perspicacious",
      "pos": "adjective",
      "ipa": "/ˌpɜːspɪˈkeɪʃəs/",
      "definitions": ["..."],
      "examples": ["...", "..."],
      "etymology": "...",
      "roots": ["per-", "specere"],
      "synonyms": ["shrewd", "astute"],
      "register": "formal",
      "tier": 2
    }
  ]
}
```

- `id`: stable slug of the lemma. NEVER renumber; user progress is keyed on it and must survive bank regeneration.
- `definitions`: 1-2 original teaching-voice senses. Never reproduce a dictionary's phrasing (the validator flags 5-gram overlap with dictionaryapi.dev).
- `examples`: exactly 2. No em or en dashes anywhere in any string (validator hard-fails).
- `ipa`: present only when adopted from a dictionary source; generated IPA is never shipped.
- `tier`: 1 (serious-journalism hard) to 4 (word-lover rare).
- Reserved for future languages, all nullable and unused in English: `gender`, `article`, `translation`. The card model is prompt/answer/direction; English v1 always renders word→definition. French will add a direction switch and use these fields: a card-engine extension, not a data rewrite.

## Review deck: `data/review.json` (second-brain knowledge cards)

```json
{
  "app": "bonmot-review",
  "version": 1,
  "generatedAt": "2026-07-17",
  "decks": [
    {
      "id": "rde",
      "label": "RDE fundamentals",
      "blurb": "one line shown on the deck tile",
      "group": "PURPL/Fundamentals",
      "tags": ["rde", "detonation", "heat-transfer"]
    }
  ],
  "cards": [
    {
      "id": "kn:pv-theuerkauf:001",
      "deck": "rde",
      "type": "qa | cloze",
      "prompt": "question, or cloze sentence with ___ for the blank",
      "answer": "the answer, or the blanked term",
      "source": "PURPL/RDE/Thermal.md#Baseline results"
    }
  ]
}
```

Holds every non-vocab card: hand-authored themed decks (RDE fundamentals, SpaceX interview prep, one pre-reading vocab list per paper) plus `#review` second-brain cards built by `tools/review_import.mjs` (pipeline: `review_scan.mjs` -> approval queue markdown -> `review_import.mjs`). Same merge-not-replace discipline as the word bank: cards are added or updated by id, never dropped, so progress survives regeneration. See `docs/DECKS.md` for how to add a deck.

- `id`: two id styles share the `kn:` prefix. `#review` cards use `kn:<blockHash>:<n>` (`blockHash` = sha256(source path + normalized block text), idempotent). Hand-authored decks use `kn:<deckId>:<seq>` (e.g. `kn:rde:001`). Either way the `kn:` prefix (colon) can never collide with a word-bank slug (`^[a-z][a-z-]*$`, no colon), which is what keeps the two decks in one progress store from mixing.
- `deck`: which deck the card belongs to; the Review tab groups by it so a session stays one subject. A card with no `deck` falls to the default `"brain"` deck (that is what `#review` cards do, since the importer does not set one). `decks[]` is the optional manifest of `{ id, label, blurb, group?, tags? }`; the importer preserves it across `#review` re-imports. A deck listed in the manifest but with zero cards is omitted from the picker; a deck used by cards but absent from the manifest still shows, labeled by its id.
- `group`: optional slash-delimited folder path (e.g. `"PURPL/Papers"`); the picker renders it as collapsible folders (native `<details>`). Absent means the deck lands under an `"Other"` folder.
- `tags`: optional array of lowercase keywords (author names, topics, years). They drive search: the picker's search box matches a query against label, blurb, group, and tags, and separately searches card prompt/answer text so a term surfaces every deck that mentions it. Per-deck strength on the picker is computed live, not stored: it is the count of the deck's seen cards whose FSRS `stability` has reached the mature threshold (21 days).
- `type`: `qa` (prompt is a question) or `cloze` (prompt is a sentence with `___`). Both render as prompt then reveal-answer; the app only uses `type` for the eyebrow label.
- `hook` (optional): a one-line memory aid (mnemonic, image, keyword, or etymology) shown under the answer on reveal. A user-written hook in `meta.hooks[cardId]` overrides it (device-local, never shipped).
- `reverse` (optional): a REWORDED clue for the definition-to-term direction, deliberately not a copy of `answer` so recall tests understanding, not surface matching. When present, the session shows it (about 45% of reviews, never on first exposure) with the term as the answer. Null/absent for cards whose prompt is an open question.
- Progress for these cards lives in the SAME `progress` store below, keyed by the `kn:` id. The vocab session (`app/queue.js`) filters `kn:` ids out; the Review decks (`app/views/review.js`) filter them in, then by chosen deck.

## Progress record (IndexedDB `progress` store, keyPath `id`)

```json
{
  "id": "perspicacious",
  "state": "learning | known | buried",
  "addedAt": "ISO date",
  "resurfaceAt": "ISO date | null",
  "resurfaceDone": false,
  "card": {
    "due": "ISO date",
    "stability": 2.3,
    "difficulty": 5.1,
    "elapsed_days": 0,
    "scheduled_days": 0,
    "learning_steps": 0,
    "reps": 1,
    "lapses": 0,
    "state": 1,
    "last_review": "ISO date | null"
  }
}
```

`card` is a ts-fsrs card with dates serialized to ISO strings (`app/srs.js` freezes/revives).

- `learning`: in the review cycle. Mature = stability >= 21 days.
- `known`: burned via "Already know it"; gets ONE confirmation resurface at `resurfaceAt` (~21 days), then `resurfaceDone`.
- `buried`: flagged as containing a mistake; never scheduled; listed on the Shelf.

## Meta (IndexedDB `meta` store, key `"meta"`)

`startTier`, `placementDone`, `streakCount`, `streakLastDay`, `streakGraceDay`, `sessionDoneDay`, `sessionsCompleted`, `introDay`, `introUsedToday`, `recent` (rolling 0/1 array, window 200), `flagged` (word ids), `lastBackup` (ISO).

## Backup file

`exportState()` output: `{ app: "bonmot", version: 1, exportedAt, meta, progress: [...] }`. Import validates and clamps every numeric field, drops unknown ids, and applies atomically with rollback (`app/store.js: validateImport`).
