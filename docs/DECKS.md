# Review decks

The Review tab is a deck picker. Each deck is a themed set of FSRS cards
that shares the vocab engine and progress store but rides its own `kn:`
ids, so a session stays one subject. Two ways cards get in.

## The decks that ship today

- **RDE fundamentals** (`rde`): the core detonation and heat transfer
  vocabulary every paper assumes. Learn these first.
- **SpaceX interview prep** (`spacex`): behavioral and technical questions
  mapped to the HADES, RDE, and FEA work, each with a model answer.
- **Paper decks** (`pv-<slug>`): one pre-reading vocabulary list per Fitz
  digest in `PURPL/20 Papers`. Learn the deck, then read the paper.
- **Second brain** (`brain`): whatever comes through the `#review`
  pipeline. The default deck for any card with no `deck` set.

## Adding or growing a hand-authored deck

All themed cards live in `data/review.json`:

```json
{
  "decks": [ { "id": "rde", "label": "RDE fundamentals", "blurb": "one line" } ],
  "cards": [ { "id": "kn:rde:001", "deck": "rde", "type": "qa",
              "prompt": "term", "answer": "teaching-voice definition",
              "source": "where it came from" } ]
}
```

Rules, all enforced by `tests/review.test.js`:

- Every id starts with `kn:` and is unique. Hand-authored ids use
  `kn:<deckId>:<seq>` (e.g. `kn:rde:023`). Never renumber an existing id;
  progress is keyed on it.
- Every card names a `deck` that exists in the manifest (or `brain`).
- No em or en dashes anywhere. Use commas, colons, or "to" for ranges.
- Definitions are original teaching-voice prose, not dictionary phrasing.

Add cards, then reload the app. A deck with a manifest entry but zero
cards is hidden until it has at least one card, so you can stub a deck's
label ahead of filling it.

## The Fitz pre-reading loop

The paper decks realize a simple habit: **learn a paper's vocabulary
before you read the paper.** When Fitz digests a new paper into
`PURPL/20 Papers/paper-<slug>.md`, emit a matching pre-reading vocab list
(10 to 16 terms, teaching-voice, no dashes) and add it as a `pv-<slug>`
deck here. Then the terms are already in spaced repetition by the time the
paper is actually read, and the paper stops being a wall of unknown jargon.

To (re)generate a paper deck fast, hand a Sonnet agent the digest path and
the card shape above; it returns a drop-in JSON array. That is exactly how
the current paper decks were built.

## Karaoke and other lists

The deck model carries anything that fits prompt then reveal-answer, not
just vocab. A karaoke deck (`prompt`: song and the hard section, `answer`:
the lyrics) drops straight in once the song list exists. Same for any
other recall list. Add a manifest entry and cards; nothing else changes.
