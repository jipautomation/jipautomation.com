#!/usr/bin/env node
/* Manage the encrypted workspace hub data (assets/hub/<hub>.enc.json) from the command line.

   The format matches what assets/site.js opens in the browser:
     - each user's password goes through PBKDF2-SHA256 (200000 rounds, the user's salt from
       assets/site.js) to 512 bits: the first 256 are the auth hash, the last 256 are a
       key-encryption key (KEK);
     - the hub JSON is AES-256-GCM encrypted with a random data key (dk);
     - blob.keys[<user>] holds dk wrapped with that user's KEK, so any user with a wrapped key
       can open the hub.

   Commands (passwords are prompted, or read from HUB_PASS / HUB_NEW_PASS):
     node tools/hub-keys.mjs add-user <hub> <existing-user> <new-user>
         Unwrap dk with the existing user's password, wrap it for the new user, write it back.
         The new user must already be in USERS in assets/site.js (its salt and hash are read from there).
     node tools/hub-keys.mjs dump <hub> <user>
         Decrypt the hub to assets/hub/<hub>.plain.json (gitignored) for editing.
     node tools/hub-keys.mjs seal <hub> <user>
         Re-encrypt assets/hub/<hub>.plain.json with the same dk. Every wrapped key stays valid.
   Plaintext never enters the repo: assets/hub/*.plain.* is in .gitignore. */
import { webcrypto as crypto } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import readline from "node:readline";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ITER = 200000;
const enc = new TextEncoder(), dec = new TextDecoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const unhex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
const b64d = s => Uint8Array.from(Buffer.from(s, "base64"));
const b64e = b => Buffer.from(b).toString("base64");

function userRecord(name) {
  const src = readFileSync(join(ROOT, "assets/site.js"), "utf8");
  const m = src.match(new RegExp("\\b" + name + ":\\{[^}]*?salt:'([0-9a-f]{32})'[^}]*?hash:'([0-9a-f]{64})'"));
  if (!m) throw new Error("user '" + name + "' is not in USERS in assets/site.js (add it there first)");
  return { salt: m[1], hash: m[2] };
}
async function derive(pass, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: ITER }, key, 512));
  return { hash: hex(bits.slice(0, 32)), kek: bits.slice(32, 64) };
}
async function gcmKey(raw, use) { return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [use]); }
async function open(raw, ivB64, ctB64) { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(ivB64) }, await gcmKey(raw, "decrypt"), b64d(ctB64))); }
async function seal(raw, data) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await gcmKey(raw, "encrypt"), data); return { iv: b64e(iv), ct: b64e(ct) }; }

function ask(label, envName) {
  if (process.env[envName]) return Promise.resolve(process.env[envName]);
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    const out = rl.output; const write = out.write.bind(out); let muted = false;
    out.write = (s, ...r) => write(muted ? "" : s, ...r);
    rl.question(label + ": ", v => { muted = false; write("\n"); rl.close(); resolve(v); });
    muted = true;
  });
}
async function kekFor(user, label, envName) {
  const rec = userRecord(user);
  const d = await derive(await ask(label, envName), rec.salt);
  if (d.hash !== rec.hash) throw new Error("wrong password for '" + user + "'");
  return d.kek;
}
function hubPath(hub, kind) { return join(ROOT, "assets/hub/" + hub + "." + kind + ".json"); }
function readBlob(hub) { return JSON.parse(readFileSync(hubPath(hub, "enc"), "utf8")); }
function writeBlob(hub, blob) { writeFileSync(hubPath(hub, "enc"), JSON.stringify(blob)); }
async function dataKey(blob, user, kek) {
  const w = blob.keys && blob.keys[user];
  if (!w) throw new Error("no wrapped key for '" + user + "' in this hub");
  return open(kek, w.iv, w.ct);
}

const [cmd, hub, user, newUser] = process.argv.slice(2);
try {
  if (cmd === "add-user" && hub && user && newUser) {
    const blob = readBlob(hub);
    const dk = await dataKey(blob, user, await kekFor(user, "Password for " + user, "HUB_PASS"));
    const newKek = await kekFor(newUser, "Password for " + newUser, "HUB_NEW_PASS");
    blob.keys[newUser] = await seal(newKek, dk);
    writeBlob(hub, blob);
    console.log("Wrapped the '" + hub + "' hub key for '" + newUser + "'. Users with keys: " + Object.keys(blob.keys).sort().join(", "));
  } else if (cmd === "dump" && hub && user) {
    const blob = readBlob(hub);
    const dk = await dataKey(blob, user, await kekFor(user, "Password for " + user, "HUB_PASS"));
    const plain = dec.decode(await open(dk, blob.iv, blob.ct));
    writeFileSync(hubPath(hub, "plain"), JSON.stringify(JSON.parse(plain), null, 2) + "\n");
    console.log("Wrote " + hubPath(hub, "plain") + " (gitignored). Edit it, then run: seal " + hub + " " + user);
  } else if (cmd === "seal" && hub && user) {
    const blob = readBlob(hub);
    const dk = await dataKey(blob, user, await kekFor(user, "Password for " + user, "HUB_PASS"));
    const plain = JSON.stringify(JSON.parse(readFileSync(hubPath(hub, "plain"), "utf8")));
    Object.assign(blob, await seal(dk, enc.encode(plain)), { plainBytes: enc.encode(plain).length });
    writeBlob(hub, blob);
    console.log("Re-encrypted " + hubPath(hub, "enc") + " (" + blob.plainBytes + " plaintext bytes). Wrapped keys unchanged.");
  } else {
    console.error("usage:\n  hub-keys.mjs add-user <hub> <existing-user> <new-user>\n  hub-keys.mjs dump <hub> <user>\n  hub-keys.mjs seal <hub> <user>");
    process.exit(2);
  }
} catch (e) { console.error("error: " + (e && e.message || e)); process.exit(1); }
