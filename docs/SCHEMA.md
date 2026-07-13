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
