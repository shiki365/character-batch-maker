// node _dev/test-samples.js [--update]
// Reads every NPC in _dev/samples/*.txt (NPC data copied from scenarios, PDF damage and all) and
// compares what was read with _dev/samples/expected.json. --update writes the current result as
// the new expectation; look at the diff before trusting it. The samples are copyrighted text, so
// the folder stays out of git (see .gitignore).
"use strict";
const fs = require("fs");
const path = require("path");
require("../words.v1.js");
require("../parse.v1.js");
const P = globalThis.CbParse;

const dir = path.join(__dirname, "samples");
const expectedFile = path.join(dir, "expected.json");
if (!fs.existsSync(dir)) { console.log("no _dev/samples: skipped"); process.exit(0); }

const result = {};
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".txt")).sort()) {
  const { chars, warnings } = P.parseMemo(fs.readFileSync(path.join(dir, f), "utf8"), { roll: "auto" });
  result[f] = {
    warnings,
    chars: chars.map(c => ({
      line: c.line, name: c.name, edition: c.edition, initiative: c.initiative,
      status: c.status.map(s => `${s.label} ${s.value}/${s.max}`).join(", "),
      params: c.params.map(p => `${p.label} ${p.value}`).join(", "),
      commands: c.commands.split("\n").filter(Boolean),
      unread: c.source.filter(s => s.state === "partial" || s.state === "unread").map(s => s.line),
    })),
  };
}

if (process.argv.includes("--update") || !fs.existsSync(expectedFile)) {
  fs.writeFileSync(expectedFile, JSON.stringify(result, null, 1) + "\n");
  console.log("wrote " + expectedFile);
  process.exit(0);
}

const expected = JSON.parse(fs.readFileSync(expectedFile, "utf8"));
let failed = 0, total = 0;
for (const f of Object.keys(result)) {
  const got = result[f], want = expected[f];
  if (!want) { console.log(`new sample file ${f}: run with --update after checking it`); failed++; continue; }
  const n = Math.max(got.chars.length, want.chars.length);
  for (let i = 0; i < n; i++) {
    total++;
    const a = JSON.stringify(got.chars[i]), b = JSON.stringify(want.chars[i]);
    if (a === b) continue;
    failed++;
    console.log(`NG ${f} #${i + 1}\n  want ${b}\n  got  ${a}`);
  }
  if (JSON.stringify(got.warnings) !== JSON.stringify(want.warnings)) { failed++; console.log(`NG ${f} warnings\n  want ${JSON.stringify(want.warnings)}\n  got  ${JSON.stringify(got.warnings)}`); }
}
console.log(failed ? `${failed} differences in ${total} NPCs` : `${total} NPCs read as expected`);
process.exit(failed ? 1 : 0);
