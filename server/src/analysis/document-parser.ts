import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { HttpError } from "../http.js";
import { extractText, parseDeadlineExceeded, type DocKind } from "./extract.js";
import type { ParseJobMessage, ParseWorkerMessage } from "./parse-worker.js";

/**
 * Parse deadline and isolation (security remediation P2, D-11).
 *
 * Every upload request gets one deadline (`config.upload.parseTimeoutMs`) for all of its documents, including time spent
 * waiting for the parse worker. Extraction runs in a worker thread. When a document's deadline passes while it is being
 * parsed, its
 * worker is terminated - this stops even synchronous, CPU-bound parser code - and the document fails with
 * 422 file_too_complex; a fresh worker is started for the next document. `settled` resolves only after the worker has
 * exited, and the route keeps its parse slot until then, so no parse outlives its slot.
 *
 * Measured before choosing this design (see docs/SECURITY.md): in-process cancellation can't work, because pdf.js
 * keeps the event loop busy until the whole document is parsed (a 500 ms deadline fired after 11.6 s); and workers
 * that loaded pdf.js's native canvas addon crashed the process when terminated. parse-worker.ts therefore replaces that
 * rendering-only addon with placeholders, which also dropped pdf.js's memory cost from ~578 MB to ~82 MB.
 *
 * One parse worker, not one per parse slot: two workers parse in parallel and each isolate peaks separately. Measured on
 * compiled JS, a cap-sized DOCX and a cap-sized PDF at once peaked at 1.01-1.09 GB with two workers, above the 1024 MB
 * Vercel function; with one worker the documents are parsed in turn. The 2 parse slots still bound how many requests
 * hold uploads in memory, and the deadline includes the wait, so a queued document can't hold a request past it.
 *
 * If a worker can't start in this environment (worker file missing from a serverless bundle, module hooks
 * unsupported), extraction falls back to the main thread. That fallback can't be interrupted, so its deadline is only
 * checked after the parse finishes; this is logged once with a reason code.
 */

export interface ExtractRequest {
  buffer: Buffer;
  filename: string;
  allowed: DocKind[];
}

export interface ExtractJob {
  /** The cleaned text, or the rejection (422 file_too_complex once the deadline passes). */
  text: Promise<string>;
  /** Resolves when no work for this document is running any more (finished, or its worker exited). Never rejects. */
  settled: Promise<void>;
}

export interface DocumentParser {
  extract(request: ExtractRequest, deadline: number): ExtractJob;
  close(): Promise<void>;
}

type InProcessExtract = (request: ExtractRequest) => Promise<string>;

interface Job {
  id: number;
  request: ExtractRequest;
  deadline: number;
  state: "queued" | "starting" | "parsing" | "finished";
  worker?: Worker;
  timer?: NodeJS.Timeout;
  resolve: (text: string) => void;
  reject: (err: unknown) => void;
  done: () => void;
}

interface Slot {
  worker: Worker | null;
  starting: Promise<Worker | null> | null;
  job: Job | null;
}

/** The worker file next to this module: `.ts` when run through tsx, `.js` when compiled. Null if neither exists. */
export function defaultWorkerUrl(): URL | null {
  const ts = new URL("./parse-worker.ts", import.meta.url);
  const js = new URL("./parse-worker.js", import.meta.url);
  for (const url of import.meta.url.endsWith(".ts") ? [ts, js] : [js, ts]) {
    try {
      if (existsSync(fileURLToPath(url))) return url;
    } catch {
      // not a file URL (bundled): there is no worker file to start
    }
  }
  return null;
}

/** Parse worker threads per instance (see above: memory measured against the 1024 MB Vercel function). */
export const PARSE_WORKERS = 1;

export class WorkerPoolDocumentParser implements DocumentParser {
  private readonly slots: Slot[];
  private readonly queue: Job[] = [];
  private nextId = 1;
  private live = 0;
  private fallbackReason: string | null;

  constructor(
    size: number = PARSE_WORKERS,
    private readonly workerUrl: URL | null = defaultWorkerUrl(),
    private readonly inProcess: InProcessExtract = (r) => extractText(r.buffer, r.filename, r.allowed)
  ) {
    this.slots = Array.from({ length: size }, () => ({ worker: null, starting: null, job: null }));
    this.fallbackReason = workerUrl ? null : "missing_worker_file";
    if (this.fallbackReason) console.warn(`[parse] worker unavailable: ${this.fallbackReason}; parsing in-process`);
  }

  /** Worker threads currently alive (tests use this to prove nothing is left running). */
  get workerThreads() {
    return this.live;
  }

  /** Null while workers are used; otherwise why parsing fell back to the main thread. */
  get inProcessReason() {
    return this.fallbackReason;
  }

  extract(request: ExtractRequest, deadline: number): ExtractJob {
    if (this.fallbackReason) return this.extractInProcess(request, deadline);
    let resolve!: (text: string) => void;
    let reject!: (err: unknown) => void;
    let done!: () => void;
    const text = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const settled = new Promise<void>((d) => (done = d));
    const job: Job = { id: this.nextId++, request, deadline, state: "queued", resolve, reject, done };
    job.timer = setTimeout(() => this.onDeadline(job), Math.max(0, deadline - Date.now()));
    this.queue.push(job);
    this.pump();
    return { text, settled };
  }

  private finish(job: Job, outcome: { text: string } | { error: unknown }, releaseNow = true) {
    if (job.state === "finished") return;
    job.state = "finished";
    clearTimeout(job.timer);
    for (const slot of this.slots) if (slot.job === job) slot.job = null;
    if ("text" in outcome) job.resolve(outcome.text);
    else job.reject(outcome.error);
    if (releaseNow) job.done();
  }

  private onDeadline(job: Job) {
    if (job.state === "finished") return;
    if (job.state === "queued") {
      this.queue.splice(this.queue.indexOf(job), 1);
      return this.finish(job, { error: parseDeadlineExceeded() });
    }
    const slot = this.slots.find((s) => s.job === job);
    if (job.state === "starting" || !job.worker || !slot) {
      // The worker was still starting; nothing was sent to it.
      return this.finish(job, { error: parseDeadlineExceeded() });
    }
    // Parsing: terminate the thread (interrupts synchronous parser code). The worker slot stays reserved until the old
    // thread has exited, so a replacement never runs alongside it; the request's parse slot is released after that.
    const worker = job.worker;
    console.warn("[parse] deadline exceeded: worker terminated");
    if (slot.worker === worker) slot.worker = null;
    this.finish(job, { error: parseDeadlineExceeded() }, false);
    slot.job = job;
    void worker.terminate().finally(() => {
      if (slot.job === job) slot.job = null;
      job.done();
      this.pump();
    });
  }

  private extractInProcess(request: ExtractRequest, deadline: number): ExtractJob {
    const work = this.inProcess(request);
    const settled = work.then(
      () => undefined,
      () => undefined
    );
    // The main thread can't be interrupted; the deadline is still enforced on the result.
    const text = work.then((t) => {
      if (Date.now() > deadline) throw parseDeadlineExceeded();
      return t;
    });
    return { text, settled };
  }

  private startWorker(slot: Slot): Promise<Worker | null> {
    if (slot.worker) return Promise.resolve(slot.worker);
    if (slot.starting) return slot.starting;
    slot.starting = new Promise<Worker | null>((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(this.workerUrl!);
      } catch {
        return resolve(this.markUnavailable("spawn_failed"));
      }
      this.live++;
      let ready = false;
      worker.on("message", (msg: ParseWorkerMessage) => {
        if (msg.type === "ready") {
          ready = true;
          slot.worker = worker;
          return resolve(worker);
        }
        if (msg.type === "unavailable") {
          void worker.terminate();
          return resolve(this.markUnavailable(msg.reason));
        }
        const job = slot.job;
        if (!job || job.worker !== worker || job.id !== msg.id) return;
        const outcome = msg.ok
          ? { text: msg.text }
          : { error: msg.error ? new HttpError(msg.error.status, msg.error.message, msg.error.code, msg.error.headers) : parseDeadlineExceeded() };
        this.finish(job, outcome);
        this.pump();
      });
      // An idle worker must never keep the process alive. unref() after attaching listeners, which re-reference it.
      worker.unref();
      worker.on("error", () => {
        if (!ready) resolve(this.markUnavailable("start_failed"));
        else console.warn("[parse] worker error");
      });
      worker.on("exit", () => {
        this.live--;
        if (slot.worker === worker) slot.worker = null;
        if (!ready) return resolve(this.markUnavailable("start_failed"));
        // Died while parsing without being terminated by the deadline (e.g. out of memory): fail only its own job.
        const job = slot.job;
        if (job && job.worker === worker && job.state === "parsing") {
          this.finish(job, { error: parseDeadlineExceeded() });
          this.pump();
        }
      });
    }).finally(() => {
      slot.starting = null;
    });
    return slot.starting;
  }

  private markUnavailable(reason: string): null {
    if (!this.fallbackReason) {
      this.fallbackReason = reason;
      console.warn(`[parse] worker unavailable: ${reason}; parsing in-process`);
    }
    return null;
  }

  private pump() {
    for (const slot of this.slots) {
      if (!this.queue.length) return;
      if (slot.job) continue;
      const job = this.queue.shift()!;
      slot.job = job;
      job.state = "starting";
      void this.startWorker(slot).then((worker) => this.dispatch(slot, job, worker));
    }
  }

  private dispatch(slot: Slot, job: Job, worker: Worker | null) {
    if ((job.state as Job["state"]) === "finished") {
      // The deadline passed while the worker was starting.
      if (slot.job === job) slot.job = null;
      return this.pump();
    }
    if (!worker) {
      // Workers can't run here: move this and every queued document to the main thread.
      slot.job = null;
      for (const pending of [job, ...this.queue.splice(0)]) {
        clearTimeout(pending.timer);
        pending.state = "finished";
        const fallback = this.extractInProcess(pending.request, pending.deadline);
        fallback.text.then(pending.resolve, pending.reject);
        void fallback.settled.then(pending.done);
      }
      return;
    }
    job.state = "parsing";
    job.worker = worker;
    const { buffer } = job.request;
    const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length) as ArrayBuffer;
    worker.postMessage({ id: job.id, data, filename: job.request.filename, allowed: job.request.allowed } satisfies ParseJobMessage, [data]);
  }

  async close() {
    await Promise.all(
      this.slots.map(async (slot) => {
        const worker = slot.worker ?? (slot.starting ? await slot.starting : null);
        slot.worker = null;
        if (worker) await worker.terminate();
      })
    );
  }
}

/** Shared by every app in the process: at most one pool of parse workers per instance. */
export const defaultDocumentParser: DocumentParser = new WorkerPoolDocumentParser();
