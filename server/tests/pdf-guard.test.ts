// P0 PDF pre-scan (C-2 compression bomb). PDFs are synthetic and built in memory; caps are lowered for the size tests so
// nothing inflates more than a few MB, except one committed-cap test whose stream is 11 MB of spaces.
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { afterEach, describe, it } from "node:test";
import { PDFParse } from "pdf-parse";
import { config } from "../src/config.js";
import { UNSAFE_DOCUMENT_MESSAGE } from "../src/analysis/docx-guard.js";
import { extractText } from "../src/analysis/extract.js";
import { checkPdf, decodeTextStage, defaultPdfLimits, ENCRYPTED_PDF_MESSAGE, type PdfLimits } from "../src/analysis/pdf-guard.js";
import { makePdf, makePdfWithStreams, SAMPLE_RESUME } from "./fixtures.js";

const KB = 1024;
const MB = 1024 * KB;
const LOW: PdfLimits = { maxStreamBytes: 64 * KB, maxTotalBytes: 160 * KB };

const spaces = (n: number) => Buffer.alloc(n, 0x20);
const flate = (data: Buffer) => zlib.deflateSync(data, { level: 9 });

/** ASCII85 encoder (with "z" for zero groups, a line break every 75 characters and the "~>" end marker). */
function ascii85(data: Buffer): Buffer {
  let out = "";
  for (let i = 0; i < data.length; i += 4) {
    const n = Math.min(4, data.length - i);
    const chunk = Buffer.alloc(4);
    data.copy(chunk, 0, i, i + n);
    let v = chunk.readUInt32BE(0);
    if (v === 0 && n === 4) {
      out += "z";
      continue;
    }
    const chars: string[] = [];
    for (let k = 0; k < 5; k++) {
      chars.unshift(String.fromCharCode((v % 85) + 33));
      v = Math.floor(v / 85);
    }
    out += chars.join("").slice(0, n + 1);
  }
  return Buffer.from(out.replace(/(.{75})/g, "$1\n") + "~>", "latin1");
}
const asciiHex = (data: Buffer) => Buffer.from(data.toString("hex").replace(/(.{64})/g, "$1\n") + ">", "latin1");

async function unsafe(pdf: Buffer, limits?: PdfLimits) {
  await assert.rejects(checkPdf(pdf, limits), { status: 422, code: "file_too_complex", message: UNSAFE_DOCUMENT_MESSAGE });
}

const originalGetText = PDFParse.prototype.getText;
afterEach(() => {
  PDFParse.prototype.getText = originalGetText;
});
function forbidPdfJs() {
  PDFParse.prototype.getText = (() => assert.fail("pdf.js must not parse a rejected PDF")) as typeof PDFParse.prototype.getText;
}

describe("PDF guard: accepted documents", () => {
  it("uses the approved D-3 caps", () => {
    assert.deepEqual(defaultPdfLimits(), { maxStreamBytes: 10 * MB, maxTotalBytes: 30 * MB });
    assert.equal(config.upload.maxPdfTotalInflatedBytes, 30 * MB);
  });

  it("accepts the existing uncompressed fixture and a normal Flate-compressed PDF, and still extracts text", async () => {
    await checkPdf(makePdf(SAMPLE_RESUME));
    const content = Buffer.from("BT /F1 10 Tf 40 800 Td (Developed Python services with SQL) Tj ET");
    const pdf = makePdfWithStreams("", [], { contentDict: "/Filter /FlateDecode", contentData: flate(content) });
    await checkPdf(pdf);
    assert.match(await extractText(pdf, "cv.pdf", ["pdf"]), /Developed Python services with SQL/);
  });

  it("accepts a stream that inflates to exactly the per-stream cap", async () => {
    await checkPdf(makePdfWithStreams("x", [{ dict: "/Filter /FlateDecode", data: flate(spaces(LOW.maxStreamBytes)) }]), LOW);
  });

  it("accepts single image codecs without inflating them", async () => {
    for (const codec of ["DCTDecode", "DCT", "JPXDecode", "CCITTFaxDecode", "CCF", "JBIG2Decode"]) {
      await checkPdf(makePdfWithStreams("x", [{ dict: `/Subtype /Image /Filter /${codec}`, data: Buffer.alloc(200 * KB, 0xff) }]), LOW);
    }
    await checkPdf(makePdfWithStreams("x", [{ dict: "/Filter [ /DCTDecode ]", data: Buffer.alloc(10) }]), LOW);
  });

  it("does not decode inline images during text extraction (R-3), so they can't get around the caps", async () => {
    const img = flate(Buffer.alloc(4000 * 4000, 0)); // 16 MB of pixels, ~16 KB compressed
    const content = Buffer.concat([
      Buffer.from("BT /F1 10 Tf 40 800 Td (Inline image resume) Tj ET\nq 100 0 0 100 50 50 cm\nBI /W 4000 /H 4000 /CS /G /BPC 8 /F /Fl ID "),
      img,
      Buffer.from("\nEI Q\n"),
    ]);
    const pdf = makePdfWithStreams("", [], { contentData: content });
    await checkPdf(pdf);
    assert.match(await extractText(pdf, "cv.pdf", ["pdf"]), /Inline image resume/);
  });
});

describe("PDF guard: compression bombs (C-2)", () => {
  it("rejects a stream one byte over the per-stream cap before pdf.js runs", async () => {
    const pdf = makePdfWithStreams("x", [{ dict: "/Filter /FlateDecode", data: flate(spaces(LOW.maxStreamBytes + 1)) }]);
    await unsafe(pdf, LOW);
  });

  it("rejects the audit's C-2 shape with the committed caps (11 MB stream in a tiny file)", async () => {
    const pdf = makePdfWithStreams("Experience", [{ dict: "/Filter /FlateDecode", data: flate(spaces(11 * MB)) }]);
    assert.ok(pdf.length < 100 * KB);
    forbidPdfJs();
    await assert.rejects(extractText(pdf, "cv.pdf", ["pdf"]), { status: 422, code: "file_too_complex", message: UNSAFE_DOCUMENT_MESSAGE });
  });

  it("rejects streams that are each under the stream cap but together exceed the total cap", async () => {
    const each = { dict: "/Filter /FlateDecode", data: flate(spaces(60 * KB)) };
    await checkPdf(makePdfWithStreams("x", [each, each]), LOW);
    await unsafe(makePdfWithStreams("x", [each, each, each]), LOW);
  });

  it("counts past a fake endstream inside the compressed data", async () => {
    // Stored (level 0) deflate blocks carry the plaintext, so "endstream" appears literally inside the stream data.
    const payload = Buffer.concat([Buffer.from("\nendstream\nendobj\n"), spaces(LOW.maxStreamBytes + KB)]);
    const data = zlib.deflateSync(payload, { level: 0 });
    assert.ok(data.includes("endstream"));
    await unsafe(makePdfWithStreams("x", [{ dict: "/Filter /FlateDecode", data }]), LOW);
  });

  it("ignores a short /Length and an indirect /Length", async () => {
    const data = flate(spaces(LOW.maxStreamBytes + 1));
    await unsafe(makePdfWithStreams("x", [{ dict: "/Filter /FlateDecode", data, length: "5" }]), LOW);
    await unsafe(makePdfWithStreams("x", [{ dict: "/Filter /FlateDecode", data, length: "9 0 R" }]), LOW);
  });

  it("treats escaped names like pdf.js does (/Fl#61teDecode, /Fil#74er)", async () => {
    const data = flate(spaces(LOW.maxStreamBytes + 1));
    await unsafe(makePdfWithStreams("x", [{ dict: "/Filter /Fl#61teDecode", data }]), LOW);
    await unsafe(makePdfWithStreams("x", [{ dict: "/Fil#74er /FlateDecode", data }]), LOW);
    await unsafe(makePdfWithStreams("x", [{ dict: "/Filter /Fl", data }]), LOW);
  });

  it("finds streams whose dictionaries contain comments, nested dictionaries and strings", async () => {
    const data = flate(spaces(LOW.maxStreamBytes + 1));
    const dict = "/Type /XObject % comment >> stream\n /DecodeParms << /Predictor 1 /Name (a >> (nested) stream) >> /Filter /FlateDecode";
    await unsafe(makePdfWithStreams("x", [{ dict, data }]), LOW);
  });
});

describe("PDF guard: encryption and filter policy (D-3)", () => {
  it("rejects encrypted PDFs with the specific message, including an escaped /Encrypt name", async () => {
    for (const trailerExtra of ["/Encrypt 9 0 R", "/Encr#79pt 9 0 R"]) {
      await assert.rejects(checkPdf(makePdfWithStreams("x", [], { trailerExtra })), {
        status: 422,
        code: "file_too_complex",
        message: ENCRYPTED_PDF_MESSAGE,
      });
    }
    assert.equal(ENCRYPTED_PDF_MESSAGE, "Encrypted or password-protected PDFs aren't supported. Please upload an unprotected PDF.");
    await checkPdf(makePdfWithStreams("x", [{ dict: "/EncryptMetadata false", data: Buffer.from("x") }]));
  });

  // ASCII85/ASCIIHex on their own or in front of FlateDecode are accepted since 2026-09-27 (see the suite below).
  const rejected = [
    "/Filter /LZWDecode", "/Filter /LZW", "/Filter /RunLengthDecode", "/Filter /RL", "/Filter /Crypt", "/Filter /BrandNewDecode",
    "/Filter [ /FlateDecode /DCTDecode ]", "/Filter [ /FlateDecode /ASCII85Decode ]", "/Filter [ /ASCII85Decode /LZWDecode ]",
    "/Filter [ /ASCII85Decode /RunLengthDecode ]", "/Filter [ /ASCII85Decode /DCTDecode ]",
    "/Filter [ /ASCII85Decode /ASCIIHexDecode /FlateDecode ]", "/Filter [ /ASCIIHexDecode /ASCIIHexDecode ]",
    "/Filter [ /ASCII85Decode /FlateDecode /FlateDecode ]", "/Filter 9 0 R", "/Filter [ 9 0 R ]", "/Filter null",
  ];
  for (const dict of rejected) {
    it(`rejects ${dict}`, async () => {
      await unsafe(makePdfWithStreams("x", [{ dict, data: Buffer.from("00") }]));
    });
  }
});

describe("PDF guard: ASCII85/ASCIIHex text encodings (owner decision 2026-09-27)", () => {
  const content = Buffer.from("BT /F1 10 Tf 40 800 Td (Built data pipelines with Python and SQL) Tj ET");

  it("accepts a ReportLab-style [/ASCII85Decode /FlateDecode] page and still extracts its text", async () => {
    const pdf = makePdfWithStreams("", [], { contentDict: "/Filter [ /ASCII85Decode /FlateDecode ]", contentData: ascii85(flate(content)) });
    await checkPdf(pdf);
    assert.match(await extractText(pdf, "cv.pdf", ["pdf"]), /Built data pipelines with Python and SQL/);
  });

  it("accepts the abbreviations and ASCIIHex, in front of Flate or on their own", async () => {
    for (const [dict, data] of [
      ["/Filter [ /A85 /Fl ]", ascii85(flate(content))],
      ["/Filter [ /ASCIIHexDecode /FlateDecode ]", asciiHex(flate(content))],
      ["/Filter [ /AHx /FlateDecode ]", asciiHex(flate(content))],
      ["/Filter /ASCII85Decode", ascii85(content)],
      ["/Filter /A85", ascii85(content)],
      ["/Filter /ASCIIHexDecode", asciiHex(content)],
      ["/Filter [ /AHx ]", asciiHex(content)],
    ] as const) {
      await checkPdf(makePdfWithStreams("x", [{ dict, data }]), LOW);
    }
  });

  it("still measures the Flate output after decoding the text stage, against the same caps", async () => {
    const atCap = ascii85(flate(spaces(LOW.maxStreamBytes)));
    await checkPdf(makePdfWithStreams("x", [{ dict: "/Filter [ /ASCII85Decode /FlateDecode ]", data: atCap }]), LOW);
    const overCap = ascii85(flate(spaces(LOW.maxStreamBytes + 1)));
    forbidPdfJs();
    await unsafe(makePdfWithStreams("x", [{ dict: "/Filter [ /ASCII85Decode /FlateDecode ]", data: overCap }]), LOW);
    await unsafe(makePdfWithStreams("x", [{ dict: "/Filter [ /ASCIIHexDecode /FlateDecode ]", data: asciiHex(flate(spaces(LOW.maxStreamBytes + 1))) }]), LOW);
  });

  it("rejects the committed-cap bomb hidden behind ASCII85 (11 MB of spaces in a tiny file)", async () => {
    const pdf = makePdfWithStreams("Experience", [{ dict: "/Filter [ /ASCII85Decode /FlateDecode ]", data: ascii85(flate(spaces(11 * MB))) }]);
    assert.ok(pdf.length < 100 * KB);
    forbidPdfJs();
    await assert.rejects(extractText(pdf, "cv.pdf", ["pdf"]), { status: 422, code: "file_too_complex", message: UNSAFE_DOCUMENT_MESSAGE });
  });

  it("caps ASCII85's only expanding form, 'z' (four zero bytes per character)", async () => {
    const zeros = (count: number) => Buffer.from("z".repeat(count) + "~>", "latin1");
    await checkPdf(makePdfWithStreams("x", [{ dict: "/Filter /ASCII85Decode", data: zeros(LOW.maxStreamBytes / 4) }]), LOW);
    await unsafe(makePdfWithStreams("x", [{ dict: "/Filter /ASCII85Decode", data: zeros(LOW.maxStreamBytes / 4 + 1) }]), LOW);
  });

  it("counts decoded text-stage output toward the total cap", async () => {
    const each = { dict: "/Filter [ /ASCII85Decode /FlateDecode ]", data: ascii85(flate(spaces(60 * KB))) };
    await checkPdf(makePdfWithStreams("x", [each, each]), LOW);
    await unsafe(makePdfWithStreams("x", [each, each, each]), LOW);
  });

  it("decodes both encodings exactly like pdf.js: whitespace, markers, partial groups, invalid bytes", () => {
    const decode = (text: string | Buffer, kind: "ascii85" | "asciihex", cap = 1024) =>
      decodeTextStage(Buffer.isBuffer(text) ? text : Buffer.from(text, "latin1"), 0, kind, cap);
    const sample = Buffer.from("Resume text: Python, SQL \u0000\u0000\u0000\u0000 and more.", "latin1");
    assert.deepEqual(decode(ascii85(sample), "ascii85").data, sample);
    assert.deepEqual(decode(asciiHex(sample), "asciihex").data, sample);
    assert.deepEqual(decode("87cURD]i,\"Ebo80~>", "ascii85").data, Buffer.from("Hello World!"));
    // ASCIIHex: every non-hex byte is skipped (pdf.js does the same); ">" ends it; an odd last digit gets a 0 nibble.
    assert.deepEqual(decode("4 1 4>", "asciihex").data, Buffer.from([0x41, 0x40]));
    assert.deepEqual(decode("41zz~42>", "asciihex").data, Buffer.from("AB"));
    // ASCII85: "<~" is not special to pdf.js ("<" is a digit, "~" ends the stage), so it decodes to nothing.
    assert.deepEqual(decode("<~87cURD~>", "ascii85"), { data: Buffer.alloc(0), over: false, complete: true, scanned: 2 });
    // NUL and form feed are digits to pdf.js, not whitespace.
    assert.equal(decode("\u0000\u0000\u0000\u0000\u0000~>", "ascii85").data.length, 4);
    assert.equal(decode("zz~>", "ascii85", 7).over, true, "cap applies mid-stream");
    // An "e" in the last bytes of the file must not be compared past the end (it used to throw instead of answering).
    assert.deepEqual(decode("41e", "asciihex"), { data: Buffer.from("A"), over: false, complete: false, scanned: 3 });
    assert.equal(decode("87cURDe", "ascii85").complete, false);
  });

  it("decodes an out-of-range ASCII85 digit the way pdf.js does, so a bomb can't hide behind one", async () => {
    // Borrow one from the first digit into the second: "bc" and "a" + String.fromCharCode("c".charCodeAt(0) + 85) encode
    // the same value, but the second digit is outside "!".."u". pdf.js still decodes it; a decoder that stopped there
    // would measure almost nothing.
    const withBorrow = (encoded: Buffer) => {
      const s = encoded.toString("latin1");
      const i = s.search(/[#-u][!-u]{4}/); // first full group whose first digit can lend 1
      assert.ok(i >= 0);
      const shifted = String.fromCharCode(s.charCodeAt(i) - 1, s.charCodeAt(i + 1) + 85);
      return Buffer.from(s.slice(0, i) + shifted + s.slice(i + 2), "latin1");
    };
    const page = withBorrow(ascii85(flate(content)));
    assert.match(page.toString("latin1"), /[\x76-\xff]/);
    const pdf = makePdfWithStreams("", [], { contentDict: "/Filter [ /ASCII85Decode /FlateDecode ]", contentData: page });
    await checkPdf(pdf);
    assert.match(await extractText(pdf, "cv.pdf", ["pdf"]), /Built data pipelines with Python and SQL/, "pdf.js decodes it the same way");

    const bomb = withBorrow(ascii85(flate(spaces(LOW.maxStreamBytes + 1))));
    forbidPdfJs();
    await unsafe(makePdfWithStreams("x", [{ dict: "/Filter [ /ASCII85Decode /FlateDecode ]", data: bomb }]), LOW);
  });

  it("refuses text stages whose end marker doesn't come before endstream", async () => {
    const noMarker = (data: Buffer) => data.subarray(0, data.lastIndexOf(data.includes("~>") ? "~>" : ">"));
    for (const [dict, data] of [
      ["/Filter /ASCII85Decode", noMarker(ascii85(content))],
      ["/Filter [ /ASCII85Decode /FlateDecode ]", noMarker(ascii85(flate(content)))],
      ["/Filter /ASCIIHexDecode", noMarker(asciiHex(content))],
      ["/Filter [ /ASCIIHexDecode /FlateDecode ]", noMarker(asciiHex(flate(content)))],
      // "endstream" inside the data before the marker: pdf.js could end the stream there or later, so refuse.
      ["/Filter /ASCII85Decode", Buffer.concat([Buffer.from("87cURDendstream"), ascii85(content)])],
    ] as const) {
      await unsafe(makePdfWithStreams("x", [{ dict, data }]));
    }
  });

  it("stays linear when streams are nested inside another stream's data (no repeated rescans)", async () => {
    // Thousands of fake ASCII85 streams whose data all runs to the same far-away "~": each would rescan the rest of
    // the file. The scan budget (at most the file size in total) refuses the file after a couple of passes.
    const fake = Buffer.from("7 0 obj << /Filter /A85 >> stream\n", "latin1");
    const body = Buffer.concat([...Array.from({ length: 4000 }, () => fake), Buffer.alloc(200 * KB, 0x41), Buffer.from("~>")]);
    const pdf = makePdfWithStreams("x", [{ dict: "/Filter /ASCII85Decode", data: body }]);
    const started = Date.now();
    await unsafe(pdf);
    assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  });
});

describe("PDF guard: malformed input never crashes", () => {
  it("lets a corrupt Flate stream through the guard (pdf.js reports it) without throwing", async () => {
    await checkPdf(makePdfWithStreams("x", [{ dict: "/Filter /FlateDecode", data: Buffer.from("x\x9c definitely not deflate") }]), LOW);
    await checkPdf(makePdfWithStreams("x", [{ dict: "/Filter /FlateDecode", data: flate(spaces(10 * KB)).subarray(0, 20) }]), LOW);
  });

  it("maps truncated and garbage PDFs to 422 file_corrupt", async () => {
    const pdf = makePdf(SAMPLE_RESUME);
    await assert.rejects(extractText(pdf.subarray(0, 60), "cv.pdf", ["pdf"]), { status: 422, code: "file_corrupt" });
    await assert.rejects(extractText(Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(4000, 0x41)]), "cv.pdf", ["pdf"]), { status: 422 });
  });

  it("stays linear on hostile token soup (long digit runs, many 'obj' keywords, unterminated strings)", async () => {
    const soup = Buffer.concat([
      Buffer.from("%PDF-1.4\n"),
      Buffer.from("1".repeat(2 * MB)),
      Buffer.from(" 0 obj << /Filter /FlateDecode (unterminated".repeat(2000)),
      Buffer.from(" obj".repeat(50_000)),
    ]);
    const start = Date.now();
    await checkPdf(soup, LOW);
    assert.ok(Date.now() - start < 5000, `pre-scan took ${Date.now() - start} ms`);
  });
});
