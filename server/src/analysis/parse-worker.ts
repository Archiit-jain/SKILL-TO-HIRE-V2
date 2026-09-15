// Parse worker (security remediation P2, D-11): document extraction runs in this thread, so a document that runs past
// the upload's parse deadline is stopped by terminating the thread.
//
// pdf.js always loads the native @napi-rs/canvas addon, which it only needs for RENDERING. Terminating a worker that
// has loaded that addon crashed the whole Node process in testing, and the addon also cost ~440 MB. Text extraction
// never renders, so before pdf.js is imported this thread replaces the addon with inert placeholders. The worker
// refuses to start (and the parser falls back to the main thread) if the native addon still got loaded.
import { createRequire, registerHooks } from "node:module";
import { parentPort } from "node:worker_threads";

export interface ParseJobMessage {
  id: number;
  data: ArrayBuffer;
  filename: string;
  allowed: Array<"pdf" | "docx" | "txt">;
}

export type ParseWorkerMessage =
  | { type: "ready" }
  | { type: "unavailable"; reason: string }
  | { type: "result"; id: number; ok: true; text: string }
  | { type: "result"; id: number; ok: false; error: { status: number; code: string; message: string; headers?: Record<string, string> } | null };

/** Inert stand-in for the addon (a real CommonJS file, so both pdf.js's require() and ESM imports resolve to it). */
const CANVAS_PLACEHOLDER = new URL("./canvas-placeholder.cjs", import.meta.url).href;

const port = parentPort;

async function main() {
  if (!port) return;
  if (typeof registerHooks !== "function") {
    return port.postMessage({ type: "unavailable", reason: "module_hooks_unsupported" } satisfies ParseWorkerMessage);
  }
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@napi-rs/canvas") return { url: CANVAS_PLACEHOLDER, format: "commonjs", shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  const { HttpError } = await import("../http.js");
  const { extractText } = await import("./extract.js");
  // Load pdf.js now (not on the first PDF) and prove the native addon was not loaded in this thread.
  await import("pdf-parse");
  const nativeLoaded = Object.keys(createRequire(import.meta.url).cache).some((p) => /[\\/]@napi-rs[\\/]canvas/.test(p));
  if (nativeLoaded) return port.postMessage({ type: "unavailable", reason: "native_canvas_loaded" } satisfies ParseWorkerMessage);

  port.on("message", (job: ParseJobMessage) => {
    extractText(Buffer.from(job.data), job.filename, job.allowed).then(
      (text) => port.postMessage({ type: "result", id: job.id, ok: true, text } satisfies ParseWorkerMessage),
      (err: unknown) =>
        port.postMessage({
          type: "result",
          id: job.id,
          ok: false,
          // Only public HttpError fields cross the thread boundary; anything else becomes a generic failure.
          error: err instanceof HttpError ? { status: err.status, code: err.code, message: err.message, headers: err.headers } : null,
        } satisfies ParseWorkerMessage)
    );
  });
  port.postMessage({ type: "ready" } satisfies ParseWorkerMessage);
}

main().catch(() => port?.postMessage({ type: "unavailable", reason: "start_failed" } satisfies ParseWorkerMessage));
