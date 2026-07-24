// Second-brain review pipeline: pure functions shared by review_scan.mjs
// (vaults -> approval queue) and review_import.mjs (approved queue ->
// data/review.json). No runtime deps; the app stays zero-build.
//
// Card shape used everywhere downstream:
//   { id, type: "qa"|"cloze", prompt, answer, source }
// id is stable: kn:<blockHash>:<n>, blockHash = sha256(source + text).
// Unchanged source -> same hash -> same ids -> nothing re-queues and
// nothing re-imports (idempotent). Changed source yields new ids; the
// old cards are never dropped from the bank (progress is keyed on id),
// matching the word-bank validator's merge-not-replace discipline.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep, basename } from "node:path";

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

/** David reads the queue; honor his no-dash rule on generated text.
 *  ponytail: em -> comma, en -> hyphen; range-aware "to" phrasing skipped. */
function noDash(s) {
  return s.replaceAll(EM, ", ").replaceAll(EN, "-");
}

function sha(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 10);
}

/** Collapse cosmetic whitespace so re-formatting a block does not churn
 *  ids, while real content edits still change the hash. */
function normalize(text) {
  return text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function blockHash(source, text) {
  return sha(source + "\n" + normalize(text));
}

// ---------- scanning ----------

function frontmatterInScope(lines) {
  if (lines[0] !== "---") return false;
  const end = lines.indexOf("---", 1);
  if (end < 1) return false;
  const fm = lines.slice(1, end).join("\n");
  return /(^|[\s,\[#-])review(\b|$)/im.test(fm);
}

/**
 * Split one markdown file into #review-tagged blocks.
 * A block is a heading section (or the preamble, titled by filename)
 * that either carries an inline #review tag or lives in a note whose
 * frontmatter is tagged review.
 * @returns {Array<{source:string, heading:string, text:string}>}
 */
export function scanFile(fullPath, text, sourcePrefix) {
  const lines = text.split("\n");
  const noteTagged = frontmatterInScope(lines) || /#review\b/.test(text);
  if (!noteTagged) return [];

  // Drop frontmatter from the body we card-ify.
  let body = lines;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) body = lines.slice(end + 1);
  }

  const sections = [];
  let cur = { heading: basename(fullPath).replace(/\.md$/, ""), lines: [], level: 0 };
  for (const line of body) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      if (cur.lines.length) sections.push(cur);
      cur = { heading: h[2].replace(/#\w+/g, "").trim(), lines: [], level: h[1].length };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.lines.length) sections.push(cur);

  const noteInScope = frontmatterInScope(lines);
  const blocks = [];
  for (const s of sections) {
    const raw = s.lines.join("\n");
    if (!noteInScope && !/#review\b/.test(raw)) continue;
    const clean = noDash(raw.replace(/#review\b/g, "").replace(/#[\w/-]+/g, "").trim());
    if (!clean) continue;
    const src = sourcePrefix + (s.heading ? "#" + s.heading : "");
    blocks.push({ source: src, heading: noDash(s.heading), text: clean });
  }
  return blocks;
}

/** Recursively scan a vault, returning every #review block. `label`
 *  becomes the human-readable source prefix (e.g. "PURPL"). */
export function scanVault(root, label) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".md")) {
        const rel = relative(root, p).split(sep).join("/");
        const text = readFileSync(p, "utf8");
        out.push(...scanFile(p, text, label + "/" + rel));
      }
    }
  };
  try {
    walk(root);
  } catch {
    /* vault missing on this machine: skip it */
  }
  return out;
}

// ---------- generation ----------

const DEF_BOLD = /^\s*[-*]?\s*\*\*(.+?)\*\*\s*[:.\-]\s+(.+)$/;
const DEF_PLAIN = /^\s*[-*]?\s*([A-Z][^:*]{0,58}?):\s+(.+)$/;
const BOLD = /\*\*(.+?)\*\*/;

function stripBold(s) {
  return s.replaceAll("**", "");
}

/**
 * Deterministic extractor: heading -> Q/A, definition lines -> Q/A,
 * bolded terms in sentences -> cloze. Order is stable so ids are stable.
 * ponytail: naive heuristics, capped at 12 cards/block. An LLM pass or
 * OCR pass would feed richer text/cards into this same shape.
 * @param {{source:string, heading:string, text:string}} block
 */
export function generateCards(block) {
  const cards = [];
  const seen = new Set();
  const add = (type, prompt, answer) => {
    prompt = noDash(prompt.trim());
    answer = noDash(answer.trim());
    if (!prompt || !answer) return;
    const key = type + "|" + prompt.toLowerCase() + "|" + answer.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    cards.push({ type, prompt, answer });
  };

  const lines = block.text.split("\n");

  // 1. heading -> first paragraph
  const firstPara = lines.find((l) => l.trim() && !/^\s*[-*#]/.test(l) && !DEF_PLAIN.test(l));
  if (block.heading && firstPara) add("qa", block.heading, stripBold(firstPara));

  for (const line of lines) {
    // 2. definition lines
    let m = DEF_BOLD.exec(line) || DEF_PLAIN.exec(line);
    if (m) {
      add("qa", stripBold(m[1]), stripBold(m[2]));
      continue;
    }
    // 3. bold term inside a sentence -> cloze (needs a real sentence)
    const b = BOLD.exec(line);
    if (b && line.replace(/[*#>-]/g, "").trim().split(/\s+/).length >= 6) {
      const term = b[1];
      const cloze = stripBold(line.replace(BOLD, "___")).replace(/^\s*[-*]\s*/, "").trim();
      add("cloze", cloze, term);
    }
    if (cards.length >= 12) break;
  }

  const hash = blockHash(block.source, block.text);
  return cards.map((c, i) => ({
    id: `kn:${hash}:${i}`,
    type: c.type,
    prompt: c.prompt,
    answer: c.answer,
    source: block.source,
  }));
}

// ---------- queue markdown (round-trippable + human editable) ----------

const CARD_RE = /^- \[([ xX])\]\s+`(kn:[^`]+)`\s+(qa|cloze)\s*$/;

/** Parse an existing queue file back into cards, preserving David's
 *  edits and approval checkboxes. */
export function parseQueue(md) {
  const cards = [];
  const lines = md.split("\n");
  let source = "";
  let cur = null;
  const flush = () => {
    if (cur) cards.push(cur);
    cur = null;
  };
  for (const line of lines) {
    const h = /^###\s+(.*)$/.exec(line);
    if (h) {
      flush();
      source = h[1].trim();
      continue;
    }
    const c = CARD_RE.exec(line);
    if (c) {
      flush();
      cur = {
        approved: c[1].toLowerCase() === "x",
        id: c[2],
        type: c[3],
        prompt: "",
        answer: "",
        source,
      };
      continue;
    }
    if (!cur) continue;
    const f = /^\s+(Q|Cloze|A):\s?(.*)$/.exec(line);
    if (f) {
      if (f[1] === "A") cur.answer = f[2];
      else cur.prompt = f[2];
    } else if (!line.trim()) {
      flush();
    }
  }
  flush();
  return cards.filter((c) => c.prompt && c.answer);
}

function renderCard(card) {
  const box = card.approved ? "x" : " ";
  const promptLabel = card.type === "cloze" ? "Cloze" : "Q";
  return (
    `- [${box}] \`${card.id}\` ${card.type}\n` +
    `  ${promptLabel}: ${card.prompt}\n` +
    `  A: ${card.answer}\n`
  );
}

/** Render the full queue file from a flat card list, grouped by source,
 *  approved cards first. */
export function renderQueue(cards) {
  const approved = cards.filter((c) => c.approved);
  const pending = cards.filter((c) => !c.approved);
  const section = (title, list) => {
    if (!list.length) return `## ${title}\n\n(none)\n`;
    const bySource = new Map();
    for (const c of list) {
      if (!bySource.has(c.source)) bySource.set(c.source, []);
      bySource.get(c.source).push(c);
    }
    let out = `## ${title}\n\n`;
    for (const [src, group] of bySource) {
      out += `### ${src}\n\n` + group.map(renderCard).join("\n") + "\n";
    }
    return out;
  };
  return (
    "# Second Brain Review Queue\n\n" +
    "Generated by tools/review_scan.mjs. Check a card's box to approve it, edit the text freely, " +
    "then run npm run review-import. Approved cards import into Bonmot's Review deck. " +
    "Re-scanning never touches or duplicates a card already listed here.\n\n" +
    section("Pending", pending) +
    "\n" +
    section("Approved", approved)
  );
}

/**
 * Idempotent merge for the scanner: keep every existing queue entry as
 * David left it (edits + checkbox), append only genuinely new generated
 * cards, and skip ids already imported into the bank.
 */
export function mergeQueue(existingCards, generatedCards, bankIds) {
  const known = new Set(existingCards.map((c) => c.id));
  const out = existingCards.slice();
  for (const g of generatedCards) {
    if (known.has(g.id) || bankIds.has(g.id)) continue;
    known.add(g.id);
    out.push({ ...g, approved: false });
  }
  return out;
}

// ---------- bank merge for the importer ----------

/** Merge approved cards into the review bank: add or update by id,
 *  never drop (progress is keyed on id, exactly like the word bank). */
export function mergeBank(existing, approved) {
  const byId = new Map(existing.map((c) => [c.id, c]));
  let added = 0;
  let updated = 0;
  for (const c of approved) {
    if (!/^kn:/.test(c.id) || !c.prompt || !c.answer) continue;
    if (byId.has(c.id)) updated++;
    else added++;
    // Spread the existing card first so hand-added fields (deck, hook,
    // reverse, group, tags) survive a re-import; only the four generated
    // fields are overwritten. Merge-not-drop applies to fields too.
    byId.set(c.id, {
      ...byId.get(c.id),
      id: c.id,
      type: c.type,
      prompt: c.prompt,
      answer: c.answer,
      source: c.source,
    });
  }
  const cards = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { cards, added, updated };
}
