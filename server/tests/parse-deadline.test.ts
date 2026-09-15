// P2 D-11: every upload request has one parse deadline. Parsing runs in a terminable worker thread; when the deadline
// passes the worker is terminated, the document gets 422 file_too_complex and the parse slot is released only after
// the thread has exited. Synthetic documents only.
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { after, describe, it } from "node:test";
import request from "supertest";
import { ParseSlots } from "../src/analysis/parse-slots.js";
import { PARSE_WORKERS, WorkerPoolDocumentParser, type DocumentParser, type ExtractJob } from "../src/analysis/document-parser.js";
import { config } from "../src/config.js";
import { makeDocx, makePdf, SAMPLE_JD, SAMPLE_RESUME } from "./fixtures.js";
import { CSRF, count, testApp } from "./helpers.js";

const MB = 1024 * 1024;
const SAFETY = { error: { code: "file_too_complex", message: "This document is too large or complex to process safely." } };

/** A valid PDF whose pages each carry ~`mbPerPage` of Flate-compressed text operators: parsing it takes seconds. */
function slowPdf(pages = 3, mbPerPage = 9.5): Buffer {
  const op = Buffer.from("BT /F1 10 Tf 40 800 Td (Python developer SQL Docker) Tj ET\n");
  const comp = zlib.deflateSync(Buffer.alloc(Math.floor((mbPerPage * MB) / op.length) * op.length).fill(op), { level: 6 });
  const objs: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from(`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${pages} >>`),
  ];
  for (let p = 0; p < pages; p++) {
    objs.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents ${objs.length + 2} 0 R /Resources << /Font << /F1 ${3 + pages * 2} 0 R >> >> >>`));
    objs.push(Buffer.concat([Buffer.from(`<< /Length ${comp.length} /Filter /FlateDecode >>\nstream\n`), comp, Buffer.from("\nendstream")]));
  }
  objs.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
  const parts = [Buffer.from("%PDF-1.4\n")];
  let len = parts[0].length;
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(len);
    const record = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from("\nendobj\n")]);
    parts.push(record);
    len += record.length;
  });
  parts.push(
    Buffer.from(
      `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`
    )
  );
  return Buffer.concat(parts);
}

const parsers: WorkerPoolDocumentParser[] = [];
const newParser = (...args: ConstructorParameters<typeof WorkerPoolDocumentParser>) => {
  const p = new WorkerPoolDocumentParser(...args);
  parsers.push(p);
  return p;
};
after(async () => {
  await Promise.all(parsers.map((p) => p.close()));
});

async function timed<T>(job: ExtractJob) {
  const t0 = Date.now();
  let outcome: { ok: true; text: string } | { ok: false; err: { status?: number; code?: string } };
  try {
    outcome = { ok: true, text: await job.text };
  } catch (err) {
    outcome = { ok: false, err: err as { status?: number; code?: string } };
  }
  const textMs = Date.now() - t0;
  await job.settled;
  return { outcome, textMs, settledMs: Date.now() - t0 };
}

describe("D-11 parse deadline", () => {
  it("uses the documented 20 s deadline and one parse worker", () => {
    assert.equal(config.upload.parseTimeoutMs, 20_000);
    assert.equal(PARSE_WORKERS, 1);
    assert.equal(config.upload.maxConcurrentParses, 2, "parse slots are unchanged");
  });

  it("extracts normal documents in the worker, without the native canvas addon", async () => {
    const parser = newParser();
    const pdf = await timed(parser.extract({ buffer: makePdf(SAMPLE_RESUME), filename: "cv.pdf", allowed: ["pdf"] }, Date.now() + 60_000));
    assert.equal(parser.inProcessReason, null, "the worker started; it refuses to start if the native canvas addon was loaded");
    assert.ok(pdf.outcome.ok && pdf.outcome.text.includes("Priya Sharma"));
    const docx = await timed(parser.extract({ buffer: makeDocx(SAMPLE_RESUME), filename: "cv.docx", allowed: ["docx"] }, Date.now() + 60_000));
    assert.ok(docx.outcome.ok && docx.outcome.text.includes("Developed a Python ETL pipeline"));
    const bad = await timed(parser.extract({ buffer: Buffer.from("MZ not a pdf"), filename: "cv.pdf", allowed: ["pdf"] }, Date.now() + 60_000));
    assert.ok(!bad.outcome.ok && bad.outcome.err.code === "file_type", "errors from the worker keep their public code");
  });

  it("stops a slow PDF at its deadline by terminating the worker, then recovers with a fresh worker", async () => {
    const parser = newParser();
    await timed(parser.extract({ buffer: makePdf(SAMPLE_RESUME), filename: "cv.pdf", allowed: ["pdf"] }, Date.now() + 60_000)); // warm
    const slow = await timed(parser.extract({ buffer: slowPdf(), filename: "cv.pdf", allowed: ["pdf"] }, Date.now() + 1_000));
    assert.ok(!slow.outcome.ok);
    assert.equal(slow.outcome.err.status, 422);
    assert.equal(slow.outcome.err.code, "file_too_complex");
    assert.ok(slow.textMs < 3_000, `rejected after ${slow.textMs} ms (parsing it fully takes ~10 s)`);
    assert.ok(slow.settledMs < 4_000, `worker gone after ${slow.settledMs} ms`);
    assert.equal(parser.workerThreads, 0, "no thread left running");

    const next = await timed(parser.extract({ buffer: makePdf(SAMPLE_RESUME), filename: "cv.pdf", allowed: ["pdf"] }, Date.now() + 60_000));
    assert.ok(next.outcome.ok, "the next document is parsed by a new worker");
  });

  it("counts time spent waiting for the worker against the deadline", async () => {
    const parser = newParser(1);
    const first = parser.extract({ buffer: slowPdf(), filename: "cv.pdf", allowed: ["pdf"] }, Date.now() + 1_500);
    const queued = parser.extract({ buffer: makePdf(SAMPLE_RESUME), filename: "cv.pdf", allowed: ["pdf"] }, Date.now() + 500);
    const q = await timed(queued);
    assert.ok(!q.outcome.ok && q.outcome.err.code === "file_too_complex");
    assert.ok(q.textMs < 1_500, `queued document rejected after ${q.textMs} ms`);
    const f = await timed(first);
    assert.ok(!f.outcome.ok && f.outcome.err.code === "file_too_complex");
  });

  it("falls back to in-process parsing when the worker can't start, and says why", async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    try {
      const parser = newParser(1, new URL("./missing-parse-worker.ts", import.meta.url));
      const job = await timed(parser.extract({ buffer: makeDocx(SAMPLE_RESUME), filename: "cv.docx", allowed: ["docx"] }, Date.now() + 60_000));
      assert.ok(job.outcome.ok, "documents are still parsed");
      assert.equal(parser.inProcessReason, "start_failed");
      const noWorker = newParser(1, null);
      assert.equal(noWorker.inProcessReason, "missing_worker_file");
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(warnings.some((w) => /\[parse\] worker unavailable: start_failed/.test(w)));
  });
});

describe("D-11 through the upload route", () => {
  it("answers 422 at the deadline, keeps the parse slot until the worker exits, and doesn't use the guest's free analysis", async () => {
    const slots = new ParseSlots(2);
    const parser = newParser();
    const ctx = testApp({ parseSlots: slots, documentParser: parser, parseTimeoutMs: 1_000 });
    const guestCookie = `s2h_guest=${"ab".repeat(24)}`;
    const t0 = Date.now();
    const res = await request(ctx.app).post("/api/analyses").set(CSRF).set("Cookie", guestCookie).field("jdText", SAMPLE_JD).attach("resume", slowPdf(), "cv.pdf");
    const elapsed = Date.now() - t0;
    assert.equal(res.status, 422);
    assert.deepEqual(res.body, SAFETY);
    assert.ok(elapsed < 4_000, `response after ${elapsed} ms`);
    for (let i = 0; i < 50 && slots.inUse > 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(slots.inUse, 0, "slot released once the worker exited");
    assert.equal(count(ctx.db, "SELECT COUNT(*) AS n FROM guest_free_use"), 0);

    // The next upload (normal deadline) is served by a fresh worker.
    const later = testApp({ parseSlots: slots, documentParser: parser });
    const ok = await request(later.app).post("/api/analyses").set(CSRF).set("Cookie", guestCookie).field("jdText", SAMPLE_JD).attach("resume", makePdf(SAMPLE_RESUME), "cv.pdf");
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  });

  it("applies one deadline to all documents of a request (resume + JD file)", async () => {
    const calls: number[] = [];
    const fake: DocumentParser = {
      extract: (_request, deadline) => {
        calls.push(deadline);
        return { text: Promise.resolve("Experience\nDeveloped Python services with SQL and Docker for data pipelines"), settled: Promise.resolve() };
      },
      close: async () => undefined,
    };
    const ctx = testApp({ documentParser: fake, parseTimeoutMs: 20_000 });
    const res = await request(ctx.app)
      .post("/api/analyses")
      .set(CSRF)
      .attach("resume", makePdf(SAMPLE_RESUME), "cv.pdf")
      .attach("jdFile", Buffer.from(SAMPLE_JD), "jd.txt");
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(calls.length, 2);
    assert.equal(calls[0], calls[1], "the JD file gets the same deadline, not a new 20 s");
    assert.ok(Math.abs(calls[0] - (Date.now() + 20_000)) < 20_000);
  });
});
