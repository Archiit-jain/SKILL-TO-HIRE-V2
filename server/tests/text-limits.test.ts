// P1 D-4: text and page limits are enforced by rejection (422 document_too_long), never by silent truncation.
// All documents are synthetic; the only large inputs are the boundary texts themselves (~100 KB).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { PDFParse } from "pdf-parse";
import request from "supertest";
import {
  extractText,
  JD_TOO_LONG_MESSAGE,
  normalizeText,
  PDF_TOO_MANY_PAGES_MESSAGE,
  RESUME_TOO_LONG_MESSAGE,
} from "../src/analysis/extract.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb } from "../src/db.js";
import { MemoryMailer } from "../src/email/mailer.js";
import { makeDocx, makeMultiPagePdf, makePdf, SAMPLE_JD, SAMPLE_RESUME } from "./fixtures.js";

const CSRF = { "X-Requested-With": "skill2hire" };
const app = createApp(openDb(":memory:"), { mailer: new MemoryMailer() });

/** Each request without a cookie is a new guest, so every call gets its own free analysis. */
function analyse(resume: { data: Buffer; name: string }, jd: { text?: string; file?: { data: Buffer; name: string } }) {
  const req = request(app).post("/api/analyses").set(CSRF);
  if (jd.text !== undefined) req.field("jdText", jd.text);
  if (jd.file) req.attach("jdFile", jd.file.data, jd.file.name);
  return req.attach("resume", resume.data, resume.name);
}

const expectTooLong = (res: request.Response, message: string) => {
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.deepEqual(res.body, { error: { code: "document_too_long", message } });
};

/** Resume text padded with plain words so its CLEANED length is exactly `length` (verified through extractText). */
async function resumeDocxOfLength(length: number): Promise<Buffer> {
  const base = SAMPLE_RESUME.trim();
  // mammoth separates paragraphs with "\n\n"; the filler is one extra paragraph of single-spaced words.
  const baseLength = (await extractText(makeDocx(base), "cv.docx", ["docx"])).length;
  const fillerLength = length - baseLength - 2;
  const filler = "python ".repeat(Math.ceil(fillerLength / 7)).slice(0, fillerLength).replace(/ $/, "x");
  const docx = makeDocx(`${base}\n${filler}`);
  assert.equal((await extractText(docx, "cv.docx", ["docx"])).length, length, "fixture has the intended cleaned length");
  return docx;
}

/** A .txt JD whose CLEANED length is exactly `length` (cleaning expands "•" bullets, so the raw length differs). */
async function jdTxtOfLength(length: number): Promise<Buffer> {
  const base = SAMPLE_JD.trim();
  const baseLength = (await extractText(Buffer.from(base), "jd.txt", ["txt"])).length;
  const data = Buffer.from(textOfLength(base, base.length + (length - baseLength)));
  assert.equal((await extractText(data, "jd.txt", ["txt"])).length, length, "fixture has the intended cleaned length");
  return data;
}

function textOfLength(prefix: string, length: number): string {
  const filler = "sql ".repeat(Math.ceil(length / 4)).slice(0, length - prefix.length - 1).replace(/ $/, "y");
  const text = `${prefix}\n${filler}`;
  assert.equal(text.length, length);
  return text;
}

const originalGetText = PDFParse.prototype.getText;
afterEach(() => {
  PDFParse.prototype.getText = originalGetText;
});

describe("D-4 text limits", () => {
  it("keeps the approved limits and messages", () => {
    assert.equal(config.upload.maxExtractedChars, 100_000);
    assert.equal(config.text.maxJdChars, 50_000);
    assert.equal(config.upload.maxPdfPages, 20);
    assert.equal(RESUME_TOO_LONG_MESSAGE, "Your resume has more text than we can analyse (limit: 100,000 characters).");
    assert.equal(JD_TOO_LONG_MESSAGE, "The job description has more text than we can analyse (limit: 50,000 characters).");
    assert.equal(PDF_TOO_MANY_PAGES_MESSAGE, "This PDF has more than 20 pages. Please upload a shorter document.");
  });

  it("no longer truncates cleaned text", async () => {
    const long = "word ".repeat(40_000).trim(); // 199,999 characters
    assert.equal(normalizeText(long).length, long.length);
    const txt = await extractText(Buffer.from(long), "jd.txt", ["txt"]);
    assert.equal(txt.length, long.length);
  });

  it("accepts a resume of exactly 100,000 cleaned characters", async () => {
    const res = await analyse({ data: await resumeDocxOfLength(100_000), name: "cv.docx" }, { text: SAMPLE_JD });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  it("rejects a resume over 100,000 cleaned characters", async () => {
    const res = await analyse({ data: await resumeDocxOfLength(100_001), name: "cv.docx" }, { text: SAMPLE_JD });
    expectTooLong(res, RESUME_TOO_LONG_MESSAGE);
  });

  it("accepts a pasted JD of exactly 50,000 characters and analyses all of it", async () => {
    // "GraphQL" appears only in the last characters, where the old code would have cut the text.
    const tail = "\nMust know GraphQL";
    const exact = textOfLength(SAMPLE_JD.trim(), 50_000 - tail.length) + tail;
    assert.equal(exact.length, 50_000);
    const res = await analyse({ data: makePdf(SAMPLE_RESUME), name: "cv.pdf" }, { text: exact });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const skills = [...res.body.result.strongSkills, ...res.body.result.partialSkills, ...res.body.result.missingSkills].map((s: { skill: string }) => s.skill);
    assert.ok(skills.includes("GraphQL"), "text at the very end of the JD is still analysed");
  });

  it("rejects a pasted JD over 50,000 characters with 422 before parsing the resume", async () => {
    const res = await analyse({ data: Buffer.from("not even a real pdf"), name: "cv.pdf" }, { text: textOfLength(SAMPLE_JD.trim(), 50_001) });
    expectTooLong(res, JD_TOO_LONG_MESSAGE);
  });

  it("counts the pasted JD after trimming surrounding whitespace", async () => {
    const res = await analyse({ data: makePdf(SAMPLE_RESUME), name: "cv.pdf" }, { text: `   ${textOfLength(SAMPLE_JD.trim(), 50_000)}\n\n  ` });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  it("accepts an uploaded JD of exactly 50,000 cleaned characters and rejects one over", async () => {
    const ok = await analyse({ data: makePdf(SAMPLE_RESUME), name: "cv.pdf" }, { file: { data: await jdTxtOfLength(50_000), name: "jd.txt" } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const tooLong = await analyse({ data: makePdf(SAMPLE_RESUME), name: "cv.pdf" }, { file: { data: await jdTxtOfLength(50_001), name: "jd.txt" } });
    expectTooLong(tooLong, JD_TOO_LONG_MESSAGE);
  });

  it("applies the JD limit to DOCX JD files too", async () => {
    const res = await analyse({ data: makePdf(SAMPLE_RESUME), name: "cv.pdf" }, { file: { data: makeDocx(textOfLength(SAMPLE_JD.trim(), 60_000)), name: "jd.docx" } });
    expectTooLong(res, JD_TOO_LONG_MESSAGE);
  });
});

describe("D-4 PDF page limit", () => {
  const pages = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? SAMPLE_RESUME : `Page marker ${i + 1} Terraform`));

  it("accepts a 20-page PDF and reads every page, without a page range", async () => {
    const calls: unknown[] = [];
    PDFParse.prototype.getText = function (this: PDFParse, params?: Parameters<typeof originalGetText>[0]) {
      calls.push(params);
      return originalGetText.call(this, params);
    };
    const pdf = makeMultiPagePdf(pages(20));
    const text = await extractText(pdf, "cv.pdf", ["pdf"]);
    assert.match(text, /Priya Sharma/);
    assert.match(text, /Page marker 20 Terraform/, "the last allowed page is extracted");
    assert.deepEqual(calls, [undefined], "getText is called once, with no first/last/partial page selection");

    const res = await analyse({ data: pdf, name: "cv.pdf" }, { text: SAMPLE_JD });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  it("rejects a 21-page PDF before extracting any page text", async () => {
    PDFParse.prototype.getText = (() => assert.fail("page text must not be extracted for a PDF over the page limit")) as typeof originalGetText;
    const pdf = makeMultiPagePdf(pages(21));
    await assert.rejects(extractText(pdf, "cv.pdf", ["pdf"]), { status: 422, code: "document_too_long", message: PDF_TOO_MANY_PAGES_MESSAGE });

    const res = await analyse({ data: pdf, name: "cv.pdf" }, { text: SAMPLE_JD });
    expectTooLong(res, PDF_TOO_MANY_PAGES_MESSAGE);
    // As a JD file: the (valid, 1-page) resume is extracted normally first, so restore getText for that request.
    PDFParse.prototype.getText = originalGetText;
    const asJd = await analyse({ data: makePdf(SAMPLE_RESUME), name: "cv.pdf" }, { file: { data: pdf, name: "jd.pdf" } });
    expectTooLong(asJd, PDF_TOO_MANY_PAGES_MESSAGE);
  });
});
