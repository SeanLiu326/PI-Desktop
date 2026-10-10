/**
 * Linux RSS measurement for PR #1505 (fix(voice): unload the transcription
 * model after an idle spell).
 *
 * The desktop's VoiceService loads the local STT model into the Electron
 * main process via transcribe-cpp (koffi FFI over libtranscribe). Before the
 * PR, ModelManager.unload() only ran on model deletion or app quit, so the
 * model weights stayed resident for the whole session. This script measures
 * the load and unload RSS delta with the exact same binding the app uses.
 *
 * It uses whisper-small q8_0 (445 MB) from the app's own model catalog
 * (packages/voice-runtime/src/model-catalog.ts) — same weight format as the
 * recommended whisper-large-v3-turbo (1.54 GiB), just smaller to download.
 * The delta scales with the model size.
 *
 * Phases (RSS from /proc/self/status VmRSS):
 *   1. baseline          — process + library loaded, no model
 *   2. after-load        — TranscribeModel.load(modelPath)
 *   3. after-unload      — model.dispose() (what the PR schedules when idle)
 *
 * Env:
 *   MODEL_PATH  path to the downloaded ggml model (required)
 * Run on Linux with:
 *   node measure-voice-model-unload-rss.mjs
 */

import { readFileSync } from "node:fs";

function rssMb() {
  const status = readFileSync("/proc/self/status", "utf8");
  const line = status.match(/^VmRSS:\s+(\d+) kB/m);
  if (!line) throw new Error("VmRSS not found (Linux only)");
  return Math.round(Number(line[1]) / 1024);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function report(label) {
  const mb = rssMb();
  console.log(`${label.padEnd(40)} ${String(mb).padStart(6)} MB`);
  return mb;
}

const modelPath = process.env.MODEL_PATH;
if (!modelPath) {
  console.error("MODEL_PATH env var pointing at the ggml model file is required");
  process.exit(1);
}

console.log(`node ${process.version}, pid ${process.pid}`);
console.log(`model: ${modelPath}`);
const baseline = report("1. baseline (library, no model)");

const transcribeCpp = await import("transcribe-cpp");
const model = await transcribeCpp.TranscribeModel.load(modelPath);
await sleep(1_000); // let allocations settle
const loaded = report("2. after TranscribeModel.load");

model.dispose();
await sleep(1_000); // let the frees settle
const unloaded = report("3. after model.dispose() (the PR unload)");

console.log("\n--- summary ---");
console.log(`model load added        : ${loaded - baseline} MB resident`);
console.log(`dispose returned        : ${loaded - unloaded} MB (${Math.round(((loaded - unloaded) / (loaded - baseline)) * 100)}% of the load delta)`);
console.log(`resident after unload  : ${unloaded} MB (baseline was ${baseline} MB)`);

// And prove the process is still healthy for a second recording cycle.
const model2 = await transcribeCpp.TranscribeModel.load(modelPath);
const reloaded = report("4. reload works (next recording path)");
model2.dispose();
console.log(`reload added            : ${reloaded - unloaded} MB — lazy reload path intact`);
