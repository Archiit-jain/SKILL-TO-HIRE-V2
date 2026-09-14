// P0 DOCX guard (C-1 memory exhaustion, H-1 declared-size lie). Every archive is synthetic and built in memory; size caps
// are exercised with lowered limits so no test inflates more than a few MB.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import mammoth from "mammoth";
import { config } from "../src/config.js";
import { checkDocx, defaultDocxLimits, UNSAFE_DOCUMENT_MESSAGE, type DocxLimits } from "../src/analysis/docx-guard.js";
import { extractText } from "../src/analysis/extract.js";
import { HttpError } from "../src/http.js";
import { docxEntries, documentXml, makeDocx, makeZip, PACKAGE_RELS, SAMPLE_RESUME, type ZipEntrySpec } from "./fixtures.js";

const KB = 1024;
const MB = 1024 * KB;

const limits = (over: Partial<DocxLimits> = {}): DocxLimits => ({ ...defaultDocxLimits(), ...over });

function expectCode(fn: () => unknown, code: "file_too_complex" | "file_corrupt") {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof HttpError, `expected HttpError, got ${err}`);
    assert.equal(err.status, 422);
    assert.equal(err.code, code);
    if (code === "file_too_complex") assert.equal(err.message, UNSAFE_DOCUMENT_MESSAGE);
    return true;
  });
}
const unsafe = (buf: Buffer, l?: DocxLimits) => expectCode(() => checkDocx(buf, l), "file_too_complex");
const corrupt = (buf: Buffer, l?: DocxLimits) => expectCode(() => checkDocx(buf, l), "file_corrupt");

const originalExtract = mammoth.extractRawText;
afterEach(() => {
  mammoth.extractRawText = originalExtract;
});
function forbidMammoth() {
  mammoth.extractRawText = (() => assert.fail("mammoth must not run for a rejected document")) as typeof mammoth.extractRawText;
}

const relsFor = (...rels: Array<[type: string, target: string]>) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
    .map(([type, target], i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`)
    .join("")}</Relationships>`;

const withReplaced = (name: string, spec: Partial<ZipEntrySpec>, extra: ZipEntrySpec[] = []) =>
  makeZip(docxEntries(SAMPLE_RESUME, extra).map((e) => (e.name === name ? { ...e, ...spec } : e)));

describe("DOCX guard: accepted documents", () => {
  it("uses the approved D-2 caps", () => {
    assert.deepEqual(defaultDocxLimits(), { maxEntries: 2000, maxTotalBytes: 20 * MB, maxXmlPartBytes: 4 * MB, maxXmlTotalBytes: 4 * MB });
    assert.equal(config.upload.maxDocxUncompressedBytes, 20 * MB);
  });

  it("accepts a normal DOCX and still extracts its text", async () => {
    const docx = makeDocx(SAMPLE_RESUME);
    checkDocx(docx);
    const text = await extractText(docx, "cv.docx", ["pdf", "docx"]);
    assert.match(text, /Developed a Python ETL pipeline/);
  });

  it("accepts XML exactly at the part and total caps", () => {
    const docx = makeDocx(SAMPLE_RESUME);
    const xmlTotal = docxEntries(SAMPLE_RESUME).reduce((s, e) => s + Buffer.byteLength(e.data), 0);
    const biggest = Math.max(...docxEntries(SAMPLE_RESUME).map((e) => Buffer.byteLength(e.data)));
    checkDocx(docx, limits({ maxXmlPartBytes: biggest, maxXmlTotalBytes: xmlTotal, maxTotalBytes: xmlTotal, maxEntries: 3 }));
  });

  it("does not count images referenced by image relationships as XML", () => {
    const rels = relsFor(["image", "media/photo.png"]);
    const docx = makeDocx("Experience\nBuilt things", [
      { name: "word/_rels/document.xml.rels", data: rels },
      { name: "word/media/photo.png", data: Buffer.alloc(3 * KB, 1), method: 0 },
    ]);
    checkDocx(docx, limits({ maxXmlPartBytes: 2 * KB, maxXmlTotalBytes: 3 * KB }));
  });
});

describe("DOCX guard: resource limits (C-1)", () => {
  it("rejects an XML part one byte over the part cap", () => {
    const size = documentXml(SAMPLE_RESUME.split("\n")).length;
    checkDocx(makeDocx(SAMPLE_RESUME), limits({ maxXmlPartBytes: size }));
    unsafe(makeDocx(SAMPLE_RESUME), limits({ maxXmlPartBytes: size - 1 }));
  });

  it("rejects XML parts that are each small but together exceed the total cap", () => {
    const docx = makeDocx(SAMPLE_RESUME, [
      { name: "word/footnotes.xml", data: `<?xml version="1.0"?><x>${"a".repeat(3 * KB)}</x>` },
      { name: "word/comments.xml", data: `<?xml version="1.0"?><x>${"a".repeat(3 * KB)}</x>` },
    ]);
    unsafe(docx, limits({ maxXmlPartBytes: 4 * KB, maxXmlTotalBytes: 6 * KB }));
  });

  it("rejects archives whose declared total exceeds the archive cap", () => {
    const docx = makeDocx(SAMPLE_RESUME, [{ name: "word/media/big.png", data: Buffer.alloc(50 * KB, 7) }]);
    unsafe(docx, limits({ maxTotalBytes: 40 * KB }));
  });

  it("rejects more entries than the entry cap", () => {
    const extras = Array.from({ length: 5 }, (_, i) => ({ name: `word/media/i${i}.png`, data: "x" }));
    unsafe(makeDocx(SAMPLE_RESUME, extras), limits({ maxEntries: 7 }));
    checkDocx(makeDocx(SAMPLE_RESUME, extras), limits({ maxEntries: 8 }));
  });

  it("rejects the audit's C-1 shape (dense XML just over 4 MB) with the committed caps, before mammoth runs", async () => {
    const para = Buffer.from("<w:p><w:r><w:t>Python developer</w:t></w:r></w:p>");
    const dense = Buffer.alloc(para.length * Math.ceil((4 * MB + 1) / para.length)).fill(para);
    const docx = makeZip(docxEntries("x").map((e) => (e.name === "word/document.xml" ? { ...e, data: documentXml(dense) } : e)));
    assert.ok(docx.length < 200 * KB, "the bomb is tiny on the wire");
    forbidMammoth();
    await assert.rejects(extractText(docx, "cv.docx", ["pdf", "docx"]), { status: 422, code: "file_too_complex", message: UNSAFE_DOCUMENT_MESSAGE });
  });
});

describe("DOCX guard: declared-size lies (H-1)", () => {
  it("rejects a part that inflates to more than it declares, without inflating past the declaration", async () => {
    const big = documentXml(Buffer.alloc(3 * MB, 0x61));
    const docx = withReplaced("word/document.xml", { data: big, declaredSize: 1000 });
    unsafe(docx);
    forbidMammoth();
    await assert.rejects(extractText(docx, "cv.docx", ["docx"]), { code: "file_too_complex" });
  });

  it("rejects a part that declares more than it contains", () => {
    const xml = documentXml(SAMPLE_RESUME.split("\n"));
    corrupt(withReplaced("word/document.xml", { data: xml, declaredSize: xml.length + 10 }));
  });

  it("rejects a CRC-32 mismatch", () => {
    corrupt(withReplaced("word/document.xml", { crc: 0x12345678 }));
  });

  it("rejects stored parts whose declared size differs from their stored bytes", () => {
    const xml = documentXml(SAMPLE_RESUME.split("\n"));
    unsafe(withReplaced("word/document.xml", { data: xml, method: 0, declaredSize: xml.length - 5 }));
  });
});

describe("DOCX guard: hostile structure", () => {
  it("rejects ZIP64 markers and ZIP64 extra fields", () => {
    unsafe(withReplaced("word/media/x.png", { declaredSize: 0xffffffff }, [{ name: "word/media/x.png", data: "x" }]));
    const zip64Extra = Buffer.from([0x01, 0x00, 0x00, 0x00]);
    unsafe(withReplaced("word/document.xml", { extra: zip64Extra }));
  });

  it("rejects split archives", () => {
    const docx = makeDocx(SAMPLE_RESUME);
    docx.writeUInt16LE(1, docx.length - 22 + 4);
    unsafe(docx);
  });

  it("rejects encrypted entries", () => {
    unsafe(withReplaced("word/document.xml", { flags: 0x0001 }));
  });

  for (const [label, method] of [["bzip2", 12], ["lzma", 14]] as const) {
    it(`rejects ${label} entries`, () => {
      unsafe(withReplaced("word/document.xml", { method }));
    });
  }

  it("rejects duplicate entry names", () => {
    unsafe(makeDocx(SAMPLE_RESUME, [{ name: "word/document.xml", data: documentXml(["other"]) }]));
  });

  it("rejects Info-ZIP Unicode Path fields (JSZip would read a different name)", () => {
    unsafe(withReplaced("word/media/a.png", { extra: Buffer.from([0x75, 0x70, 0x01, 0x00, 0x01]) }, [{ name: "word/media/a.png", data: "x" }]));
  });

  it("caps a text part reached through a relationship even when it isn't named .xml", () => {
    const styles = `<?xml version="1.0"?><w:styles ${'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'}>${"<w:style/>".repeat(400)}</w:styles>`;
    const docx = makeDocx(SAMPLE_RESUME, [
      { name: "word/_rels/document.xml.rels", data: relsFor(["styles", "styles.dat"]) },
      { name: "word/styles.dat", data: styles },
    ]);
    unsafe(docx, limits({ maxXmlPartBytes: 3 * KB }));
  });

  it("caps a main document redirected by the package relationships, including absolute and image-typed targets", () => {
    const main = documentXml(Buffer.alloc(5 * KB, 0x61));
    const redirected = (target: string, type = "officeDocument") =>
      makeZip(docxEntries(SAMPLE_RESUME).map((e) => (e.name === "_rels/.rels" ? { ...e, data: relsFor([type, target]) } : e)).concat([{ name: "word/main.bin", data: main }]));
    unsafe(redirected("word/main.bin"), limits({ maxXmlPartBytes: 4 * KB, maxXmlTotalBytes: 20 * KB }));
    unsafe(redirected("/word/main.bin"), limits({ maxXmlPartBytes: 4 * KB, maxXmlTotalBytes: 20 * KB }));
    // A non-image file reached through an "image" relationship is still treated as XML.
    unsafe(redirected("word/main.bin", "image"), limits({ maxXmlPartBytes: 4 * KB, maxXmlTotalBytes: 20 * KB }));
    assert.ok(PACKAGE_RELS.includes("officeDocument"));
  });

  it("rejects DOCTYPE and ENTITY declarations, including UTF-16 encoded parts", () => {
    const lol = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">]><w:document/>`;
    unsafe(withReplaced("word/document.xml", { data: lol }));
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`<?xml version="1.0" encoding="UTF-16"?><!ENTITY a "b"><x/>`, "utf16le")]);
    unsafe(makeDocx(SAMPLE_RESUME, [{ name: "customXml/item9.xml", data: utf16 }]));
    const utf16be = Buffer.from(`﻿<!DOCTYPE x><x/>`, "utf16le").swap16();
    unsafe(makeDocx(SAMPLE_RESUME, [{ name: "customXml/item8.xml", data: utf16be }]));
  });
});

describe("DOCX guard: malformed archives never crash", () => {
  it("rejects truncated, headerless, relocated and incomplete archives as corrupt", () => {
    const docx = makeDocx(SAMPLE_RESUME);
    corrupt(docx.subarray(0, docx.length - 30)); // end-of-central-directory record cut off
    corrupt(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]));
    corrupt(Buffer.concat([Buffer.from("junk bytes before the archive"), docx])); // offsets no longer line up
    corrupt(makeZip(docxEntries(SAMPLE_RESUME).filter((e) => e.name !== "word/document.xml")));
    corrupt(makeZip(docxEntries(SAMPLE_RESUME).filter((e) => e.name !== "[Content_Types].xml")));
    const garbage = Buffer.from(docx);
    garbage.writeUInt32LE(0xdeadbeef, garbage.length - 22 + 16); // central directory offset points nowhere
    corrupt(garbage);
    corrupt(withReplaced("word/document.xml", { rawBody: Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]), declaredSize: 50 })); // broken deflate data
  });

  it("maps every guard failure through extractText to the generic 422 responses", async () => {
    await assert.rejects(extractText(withReplaced("word/document.xml", { flags: 1 }), "cv.docx", ["docx"]), {
      status: 422,
      code: "file_too_complex",
      message: UNSAFE_DOCUMENT_MESSAGE,
    });
    const docx = makeDocx(SAMPLE_RESUME);
    await assert.rejects(extractText(docx.subarray(0, docx.length - 30), "cv.docx", ["docx"]), { status: 422, code: "file_corrupt" });
  });
});
