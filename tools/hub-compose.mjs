#!/usr/bin/env node
/* Compose the workspace copy of a Build Hub from the hub's source files.

   The Build Hub keeps everything; the client workspace carries a trimmed copy:
     - the document archive (full text of every doc), the deal documents, the list of
       sources from the client and the worked example of a real order stay on the
       private hub (assets/hub.js never renders them and says so on the Build notes page);
     - the asks section of the checklist gets the client-facing title the workspace
       uses everywhere else ("Inputs needed from <client>");
     - the checklist's done list is the hub's live ticks when a ticks file is given,
       and a seed version is stamped so browsers drop their local copy of older ticks.

   Usage:
     node tools/hub-compose.mjs <hub> <hub_model.json> <checklist_data.json> [--done <ticks.json>] [--seed <version>]
     node tools/hub-compose.mjs <hub> --page <saved Build Hub page.html> [--done <ticks.json>] [--seed <version>]
   The second form reads the model and checklist out of the published Build Hub page, which
   embeds both as window.__HUB__. Writes assets/hub/<hub>.plain.json (gitignored).
   Then: node tools/hub-keys.mjs seal <hub> <user>.
   <ticks.json> is {"done":[...]} as the hub's shared database holds it (collection hub, doc checklist). */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), opt = {};
for (let i = args.length - 1; i >= 0; i--) if (args[i].startsWith("--")) { opt[args[i].slice(2)] = args[i + 1]; args.splice(i, 2); }
const [hub, modelPath, checklistPath] = args;
if (!hub || !(opt.page || (modelPath && checklistPath))) {
  console.error("usage: hub-compose.mjs <hub> <hub_model.json> <checklist_data.json> [--done <ticks.json>] [--seed <version>]\n       hub-compose.mjs <hub> --page <hub page.html> [--done <ticks.json>] [--seed <version>]");
  process.exit(2);
}
const read = p => JSON.parse(readFileSync(p, "utf8"));
/* The hub page carries `window.__HUB__ = {...};` — take the balanced object literal after the assignment. */
function fromPage(p) {
  const src = readFileSync(p, "utf8"), key = "window.__HUB__ = ", at = src.indexOf(key);
  if (at < 0) throw new Error("no window.__HUB__ in " + p);
  let i = at + key.length, depth = 0, inStr = false, escp = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inStr) { if (escp) escp = false; else if (ch === "\\") escp = true; else if (ch === '"') inStr = false; }
    else if (ch === '"') inStr = true; else if (ch === "{") depth++; else if (ch === "}" && --depth === 0) { i++; break; }
  }
  return JSON.parse(src.slice(at + key.length, i));
}
const page = opt.page ? fromPage(opt.page) : null;
const model = page ? page.model : read(modelPath), checklist = page ? page.checklist : read(checklistPath);

/* Trims: what stays on the private hub. */
const TRIM_MODEL = ["journey", "deal_docs", "sources_from_legacy"];
TRIM_MODEL.forEach(k => { delete model[k]; });
model.docs = model.docs || []; // the archive index; assets/hub.js counts it but renders none of it

/* The asks section keeps the client-facing title. */
const client = (model.meta && (model.meta.client_short || (model.meta.org || "").split(" · ")[0])) || "the client";
checklist.sections.forEach(s => { if (s.ken || s.step === "ASK") s.title = "Inputs needed from " + client; });

/* Live ticks and seed version. */
if (opt.done) {
  const ids = new Set(); checklist.sections.forEach(s => s.items.forEach(it => ids.add(it.id)));
  const live = read(opt.done).done || [];
  const unknown = live.filter(id => !ids.has(id));
  if (unknown.length) throw new Error("ticks not in the checklist: " + unknown.join(", "));
  checklist.done = live;
}
const seed = opt.seed || new Date().toISOString().slice(0, 10) + (model.meta && model.meta.release ? "-" + String(model.meta.release).toLowerCase() : "");

const plain = { seed_version: seed, model, checklist, docs: {} };
const out = join(ROOT, "assets/hub/" + hub + ".plain.json");
writeFileSync(out, JSON.stringify(plain, null, 2) + "\n");
const p2 = checklist.sections.filter(s => String(s.phase || 2) === "2"), t = p2.reduce((n, s) => n + s.items.length, 0), d = p2.reduce((n, s) => n + s.items.filter(it => checklist.done.indexOf(it.id) >= 0).length, 0);
console.log("Wrote " + out + " — " + (model.meta && model.meta.release) + " of " + (model.meta && model.meta.updated) + ", seed " + seed + ", " + d + " of " + t + " Phase 2 items ticked, " + Buffer.byteLength(JSON.stringify(plain)) + " plaintext bytes. Next: node tools/hub-keys.mjs seal " + hub + " <user>");
