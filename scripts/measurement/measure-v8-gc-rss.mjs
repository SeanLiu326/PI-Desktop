/**
 * Linux RSS measurement for PR #1506 (perf(agent-runtime): gc the sidecar
 * heap while idle).
 *
 * The sidecar is an ELECTRON_RUN_AS_NODE process started with
 * `--max-old-space-size=2048` (apps/desktop/electron/main/agent-sidecar.ts).
 * This script reproduces that heap profile on plain Node with the same
 * limit and measures what the reviewer's blocker asks for: does a full GC
 * while idle actually return RSS pages to the OS, versus just waiting?
 *
 * Phases (RSS read from /proc/self/status VmRSS):
 *   1. baseline                     — process just started
 *   2. after-load                   — ~700 MB live working set held
 *   3. after-drop                   — working set dropped (turn finished)
 *   4. idle-wait 5 min, NO explicit gc — today's behavior (V8 MemoryReducer only)
 *   5. explicit gc()                — the PR's idle trim
 *   6. settle 30s                   — re-read after the OS absorbs the unmaps
 *
 * Run on Linux with:
 *   node --expose-gc --max-old-space-size=2048 measure-v8-gc-rss.mjs
 */

import { readFileSync } from "node:fs";

const MB = 1024 * 1024;

function rssMb() {
  const status = readFileSync("/proc/self/status", "utf8");
  const line = status.match(/^VmRSS:\s+(\d+) kB/m);
  if (!line) throw new Error("VmRSS not found (Linux only)");
  return Math.round(Number(line[1]) / 1024);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function report(label) {
  const mb = rssMb();
  console.log(`${label.padEnd(46)} ${String(mb).padStart(6)} MB`);
  return mb;
}

// A long-lived "session history" (stays referenced for the whole run, like
// the sidecar's retained transcripts) plus a large temporary working set
// (like a big agent turn): many medium-lived strings pushed in batches so
// the old generation gets a realistic mix of survivors and garbage.
const sessionHistory = [];
function buildWorkingSet() {
  const batch = [];
  for (let i = 0; i < 480_000; i += 1) {
    batch.push({
      role: i % 2 ? "assistant" : "user",
      content: `turn ${i}: ${"x".repeat(120 + (i % 80))} payload for old-gen pressure`,
    });
  }
  return batch;
}

console.log(`node ${process.version}, pid ${process.pid}`);
const baseline = report("1. baseline");

// --- simulate a session with large turns ---
sessionHistory.push(...buildWorkingSet().slice(0, 60_000)); // long-lived tail
let turn = null;
for (let i = 0; i < 3; i += 1) {
  turn = buildWorkingSet(); // ~150 MB of medium-lived objects per turn
  await sleep(250);
}
report("2. after-load (~700 MB working set)");
turn = null; // drop the big turn; history tail stays, like a finished session
report("3. after-drop (turn finished)");

// --- today's behavior: idle wait, no explicit gc ---
console.log("4. idle-wait 5 min WITHOUT explicit gc (today's sidecar)…");
for (let i = 0; i < 5; i += 1) {
  await sleep(60_000);
  console.log(`   +${(i + 1) * 60}s idle: ${rssMb()} MB`);
}
const afterIdle = report("   idle-wait final");

// --- the PR's behavior: explicit full gc while idle ---
if (typeof globalThis.gc !== "function") {
  console.error("restart with --expose-gc to measure the trim");
  process.exit(1);
}
globalThis.gc();
await sleep(30_000); // let the unmaps settle
const afterGc = report("5. after explicit gc() + settle 30s (the PR trim)");

console.log("\n--- summary ---");
console.log(`idle-wait alone returned    : ${baseline > 0 ? afterIdle - baseline : "?"} ... ${afterIdle} MB still resident`);
console.log(`explicit gc returned to     : ${afterGc} MB resident (baseline was ${baseline} MB)`);
console.log(`trim delta vs idle-wait     : ${afterIdle - afterGc} MB`);
