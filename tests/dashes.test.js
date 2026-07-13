// David's hard rule: no em or en dashes in anything he reads. This
// sweeps every content surface (bank data is covered by bank.test.js;
// this covers UI code, docs, and config). vendor/ is exempt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "vendor", ".git", "data", "icons"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(js|mjs|css|html|md|json|webmanifest)$/.test(name)) yield p;
  }
}

test("no em or en dashes in any human-facing file", () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    const text = readFileSync(file, "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      if (line.includes("\u2014") || line.includes("\u2013")) {
        offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "dashes found at: " + offenders.join(", "));
});
