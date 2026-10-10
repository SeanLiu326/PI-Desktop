/**
 * Download whisper-small q8_0 for the load/unload RSS measurement.
 *
 * The app catalog's repo (handy-computer/whisper-small-GGUF) is not
 * resolvable anonymously, so pull the identical ggml-small-q8_0.bin from the
 * upstream whisper.cpp model repo — the same weight format transcribe-cpp's
 * whisper.cpp loads.
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

const URL_ =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin";
const FILE = "ggml-small-q8_0.bin";

console.log("downloading", URL_);
execFileSync("curl", ["-L", "--retry", "3", "--retry-delay", "5", URL_, "-o", FILE], {
  stdio: "inherit",
});
const size = statSync(FILE).size;
console.log(`downloaded: ${size} bytes`);
if (size < 200 * 1024 * 1024) {
  throw new Error(`download too small to be the small q8_0 model: ${size} bytes`);
}
console.log("model download OK");
