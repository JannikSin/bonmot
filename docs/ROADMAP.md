# Roadmap

Ten steps ahead, deliberately NOT built in v1. Each waits for its trigger; nothing here is wired before the daily habit proves itself.

0. **Next 300 words.** Generate when tier consumption warrants (Shelf "Unseen" running low at the working tier). Append-only, ids stable, `npm run validate` gates it.
1. **Reverse recall + cloze modes (v1.1).** Definition→word and blanked-example drills, unlocked at forward maturity, loosely scheduled as derived drills, NOT independent FSRS states. Trigger: forward retention proven over some weeks.
2. **French pack (`data/fr.json`).** The identity pull. Card engine gains a direction switch (EN→FR, FR→EN); schema's reserved `gender`/`article`/`translation` fields go live. Low-rewrite, not zero-rewrite (documented in SCHEMA.md).
3. **Spanish pack.** Same mechanics as French.
4. **"From my reading" capture.** Paste a sentence containing an unknown word; the app builds a card from it. Needs an entry editor + validator in-app.
5. **Audio pronunciation.** `speechSynthesis` (local, zero-dependency, CSP-clean). Likely the first thing after v1.
6. **Word-of-the-day on the Shelf.** Serendipity without notifications.
7. **Writing integration.** "Use three of this week's words in your next script" prompt on the done screen.
8. **Root-family drills.** One Latin root unlocks ten words; morphology mode.
9. **Cross-device sync.** Needs a private data repo + PAT (mise pattern: data repo stays PRIVATE). Council before building; it is real money-adjacent effort and a security surface.
10. **daily.py train-sheet line. DONE at launch (2026-07-13).** The Loyalist reversed the original deferral: the morning-brief line is the trigger that helps the habit form, not a reward for it existing. One line in Crystal's daily.py now points at the train session.
