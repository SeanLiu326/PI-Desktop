/**
 * Download the whisper-small q8_0 model the exact way the app does
 * (packages/voice-runtime/src/model-downloader.ts): via @huggingface/hub's
 * downloadFile, which follows LFS/CDN correctly where a plain curl of the
 * resolve URL returns the LFS pointer.
 */
import { createWriteStream } from "node:fs";
import { statSync } from "node:fs";

const REPO = "handy-computer/whisper-small-GGUF";
const FILE = "ggml-small-q8_0.bin";
const EXPECTED = 466_616_320; // packages/voice-runtime/src/model-catalog.ts

const { downloadFile } = await import("@huggingface/hub");
const response = await downloadFile({ repo: REPO, path: FILE });
if (!response || !response.body) throw new Error("no response body");
console.log("content-length:", response.headers.get("content-length"));

const writer = createWriteStream(FILE);
const reader = response.body.getReader();
let received = 0;
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  writer.write(Buffer.from(value));
  received += value.byteLength;
  if (received % (100 * 1024 * 1024) < value.byteLength) {
    console.log(`  … ${Math.round(received / 1024 / 1024)} MB`);
  }
}
await new Promise((resolve, reject) => {
  writer.on("error", reject);
  writer.end(() => resolve());
});

const size = statSync(FILE).size;
console.log(`downloaded: ${size} bytes (expected ~${EXPECTED})`);
if (size < EXPECTED * 0.99) {
  throw new Error(`download looks like an LFS pointer or truncated file: ${size} bytes`);
}
console.log("model download OK");
