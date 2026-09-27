import zlib from "node:zlib";
import { config } from "../config.js";
import { HttpError } from "../http.js";
import { UNSAFE_DOCUMENT_MESSAGE } from "./docx-guard.js";

/**
 * PDF pre-scan (security remediation P0: C-2). Runs on the raw upload BEFORE pdf.js is loaded; pdf.js has no limit on
 * how much a compressed stream may expand, so this is the only protection layer.
 *
 *  - Encrypted PDFs (an /Encrypt entry) are refused: their stream sizes can't be checked before decryption.
 *  - Every stream object ("N G obj << dict >> stream") is found by tokenising its dictionary. Allowed filters: none,
 *    a single FlateDecode (which is size-checked), or a single image codec that text extraction doesn't expand
 *    (DCT, JPX, CCITTFax, JBIG2). LZW, RunLength, ASCII85, ASCIIHex, Crypt, unknown names, chains and indirect
 *    /Filter values are refused.
 *  - Flate streams are inflated in 64 KB chunks, counting and discarding the output, from where pdf.js starts reading
 *    until the deflate stream really ends. /Length and "endstream" are NOT trusted: an attacker can put a fake
 *    "endstream" inside compressed data or declare a short /Length while pdf.js decodes the whole stream.
 *    One stream > maxPdfStreamInflatedBytes, or all streams > maxPdfTotalInflatedBytes -> rejected immediately.
 *
 * This is resource validation, not malware scanning.
 */

export const ENCRYPTED_PDF_MESSAGE = "Encrypted or password-protected PDFs aren't supported. Please upload an unprotected PDF.";

const unsafe = () => new HttpError(422, UNSAFE_DOCUMENT_MESSAGE, "file_too_complex");

export interface PdfLimits {
  maxStreamBytes: number;
  maxTotalBytes: number;
}

export const defaultPdfLimits = (): PdfLimits => ({
  maxStreamBytes: config.upload.maxPdfStreamInflatedBytes,
  maxTotalBytes: config.upload.maxPdfTotalInflatedBytes,
});

const CHUNK = 64 * 1024;
const FLATE = new Set(["FlateDecode", "Fl"]);
const NON_EXPANDING_IMAGE_CODECS = new Set(["DCTDecode", "DCT", "JPXDecode", "CCITTFaxDecode", "CCF", "JBIG2Decode"]);
/**
 * Text encodings of binary data (owner decision 2026-09-27, extends SEC-D3). Allowed on their own or as the single
 * stage in front of FlateDecode, e.g. [/ASCII85Decode /FlateDecode] as written by ReportLab. The guard decodes them
 * itself, with the same caps, so the Flate output is still measured.
 */
const TEXT_ENCODINGS: Record<string, "ascii85" | "asciihex"> = {
  ASCII85Decode: "ascii85",
  A85: "ascii85",
  ASCIIHexDecode: "asciihex",
  AHx: "asciihex",
};

// ---------------------------------------------------------------------------------------------- tokeniser
const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]); // ( ) < > [ ] { } / %
const isRegular = (c: number) => !WHITESPACE.has(c) && !DELIMITERS.has(c);

type Token =
  | { type: "name"; value: string; end: number }
  | { type: "number" | "keyword"; value: string; end: number }
  | { type: "dictOpen" | "dictClose" | "arrOpen" | "arrClose" | "string" | "eof" | "other"; end: number };

function skipSpace(b: Buffer, i: number): number {
  while (i < b.length) {
    if (WHITESPACE.has(b[i])) i++;
    else if (b[i] === 0x25) {
      while (i < b.length && b[i] !== 0x0a && b[i] !== 0x0d) i++; // % comment to end of line
    } else break;
  }
  return i;
}

function nextToken(b: Buffer, start: number): Token {
  let i = skipSpace(b, start);
  if (i >= b.length) return { type: "eof", end: i };
  const c = b[i];
  if (c === 0x3c && b[i + 1] === 0x3c) return { type: "dictOpen", end: i + 2 };
  if (c === 0x3e && b[i + 1] === 0x3e) return { type: "dictClose", end: i + 2 };
  if (c === 0x5b) return { type: "arrOpen", end: i + 1 };
  if (c === 0x5d) return { type: "arrClose", end: i + 1 };
  if (c === 0x3c) {
    while (i < b.length && b[i] !== 0x3e) i++; // <hex string>
    return { type: "string", end: i + 1 };
  }
  if (c === 0x28) {
    let depth = 0; // (literal string) with nesting and backslash escapes, scanned iteratively
    for (; i < b.length; i++) {
      if (b[i] === 0x5c) i++;
      else if (b[i] === 0x28) depth++;
      else if (b[i] === 0x29 && --depth === 0) return { type: "string", end: i + 1 };
    }
    return { type: "eof", end: b.length };
  }
  if (c === 0x2f) {
    let j = i + 1;
    while (j < b.length && isRegular(b[j])) j++;
    const raw = b.toString("latin1", i + 1, j);
    return { type: "name", value: raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), end: j };
  }
  if (!isRegular(c)) return { type: "other", end: i + 1 };
  let j = i;
  while (j < b.length && isRegular(b[j])) j++;
  const word = b.toString("latin1", i, j);
  return { type: /^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) ? "number" : "keyword", value: word, end: j };
}

/** Skips one complete object starting at `start` (nested dictionaries/arrays counted iteratively). */
function skipObject(b: Buffer, start: number): number {
  let depth = 0;
  let pos = start;
  do {
    const t = nextToken(b, pos);
    if (t.type === "eof") return b.length;
    if (t.type === "dictOpen" || t.type === "arrOpen") depth++;
    else if (t.type === "dictClose" || t.type === "arrClose") depth--;
    pos = t.end;
  } while (depth > 0);
  return pos;
}

type FilterSpec = { kind: "none" } | { kind: "names"; names: string[] } | { kind: "unsupported" };

interface StreamDict {
  filter: FilterSpec;
  /** Offset just after the "stream" keyword. */
  afterKeyword: number;
}

/** Parses "<< ... >> stream" starting at `start` (just after "obj"). Returns null if this object isn't a stream. */
function readStreamDict(b: Buffer, start: number): StreamDict | null {
  let t = nextToken(b, start);
  if (t.type !== "dictOpen") return null;
  let pos = t.end;
  let filter: FilterSpec = { kind: "none" };
  for (;;) {
    t = nextToken(b, pos);
    if (t.type === "eof") return null;
    if (t.type === "dictClose") {
      pos = t.end;
      break;
    }
    if (t.type !== "name") {
      pos = skipObject(b, pos);
      continue;
    }
    const key = t.value;
    pos = t.end;
    if (key !== "Filter") {
      pos = skipObject(b, pos);
      continue;
    }
    const v = nextToken(b, pos);
    if (v.type === "name") {
      filter = { kind: "names", names: [v.value] };
      pos = v.end;
    } else if (v.type === "arrOpen") {
      const names: string[] = [];
      let p = v.end;
      let ok = true;
      for (;;) {
        const e = nextToken(b, p);
        if (e.type === "arrClose") {
          p = e.end;
          break;
        }
        if (e.type === "eof") return null;
        if (e.type === "name") {
          names.push(e.value);
          p = e.end;
        } else {
          ok = false;
          p = skipObject(b, p);
        }
      }
      filter = ok ? (names.length ? { kind: "names", names } : { kind: "none" }) : { kind: "unsupported" };
      pos = p;
    } else {
      filter = { kind: "unsupported" }; // indirect reference, null or anything else pdf.js might resolve later
      pos = skipObject(b, pos);
    }
  }
  const kw = nextToken(b, pos);
  if (kw.type !== "keyword" || kw.value !== "stream") return null;
  return { filter, afterKeyword: kw.end };
}

/** pdf.js Lexer.skipToNextLine(): stream data starts after the first CR, LF or CRLF following the keyword. */
function dataStart(b: Buffer, afterKeyword: number): number {
  let i = afterKeyword;
  while (i < b.length) {
    if (b[i] === 0x0d) return b[i + 1] === 0x0a ? i + 2 : i + 1;
    if (b[i] === 0x0a) return i + 1;
    i++;
  }
  return b.length;
}

/** Offsets just after every "obj" keyword that is preceded by "<digits> <digits> ". Linear, no regex backtracking. */
function objectBodies(b: Buffer): number[] {
  const out: number[] = [];
  for (let at = b.indexOf("obj", 0, "latin1"); at >= 0; at = b.indexOf("obj", at + 3, "latin1")) {
    const after = at + 3;
    if (after < b.length && isRegular(b[after])) continue;
    let i = at - 1;
    let fields = 0;
    while (fields < 2) {
      const wsEnd = i;
      while (i >= 0 && WHITESPACE.has(b[i]) && wsEnd - i < 64) i--;
      if (i === wsEnd) break;
      const digitsEnd = i;
      while (i >= 0 && b[i] >= 0x30 && b[i] <= 0x39 && digitsEnd - i < 20) i--;
      if (i === digitsEnd) break;
      fields++;
    }
    if (fields === 2 && (i < 0 || !isRegular(b[i]))) out.push(after);
  }
  return out;
}

/**
 * Inflates zlib data from `start` in 64 KB input chunks, counting output without keeping it, until the deflate stream
 * ends, the data is invalid, or the count passes `cap`. Returns the count and whether the cap was exceeded.
 */
function countInflated(b: Buffer, start: number, cap: number): Promise<{ size: number; over: boolean }> {
  return new Promise((resolve) => {
    const inflater = zlib.createInflate({ chunkSize: CHUNK });
    let size = 0;
    let done = false;
    const finish = (over: boolean) => {
      if (done) return;
      done = true;
      inflater.destroy();
      resolve({ size, over });
    };
    inflater.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > cap) finish(true);
    });
    inflater.on("end", () => finish(false));
    inflater.on("error", () => finish(false)); // corrupt/truncated data: count what was produced, pdf.js fails too

    let offset = start;
    const feed = () => {
      while (!done && offset < b.length) {
        const chunk = b.subarray(offset, Math.min(offset + CHUNK, b.length));
        offset += chunk.length;
        if (!inflater.write(chunk)) {
          inflater.once("drain", feed);
          return;
        }
      }
      if (!done && offset >= b.length) inflater.end();
    };
    feed();
  });
}

/** pdf.js's isWhiteSpace(): only space, tab, CR and LF. NUL and form feed are ASCII85 digits to pdf.js. */
const isPdfJsSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0a;
const ENDSTREAM = Buffer.from("endstream", "latin1");
const atEndstream = (b: Buffer, i: number) =>
  b[i] === 0x65 && i + ENDSTREAM.length <= b.length && b.compare(ENDSTREAM, 0, ENDSTREAM.length, i, i + ENDSTREAM.length) === 0;

export interface TextStageResult {
  data: Buffer;
  /** Output went past `cap`. */
  over: boolean;
  /** The stage's end marker ("~" or ">") was found before the next "endstream" and before the end of the file. */
  complete: boolean;
  /** Input bytes read, including the end marker. */
  scanned: number;
}

/**
 * Decodes an ASCII85 or ASCIIHex stage exactly like pdf.js 5.4 (Ascii85Stream / AsciiHexStream), from `start` to the
 * stage's end marker. pdf.js does not stop at invalid characters: ASCII85 folds every non-whitespace byte into the
 * arithmetic, ASCIIHex skips every non-hex byte. It stops only at the marker ("~" / ">") or the end of the stream
 * data, so decoding up to the marker yields at least what pdf.js decodes, never less.
 *
 * A stream whose marker doesn't come before the next "endstream" (or the end of the file) is reported as incomplete
 * and refused by the caller: pdf.js's stream end is always at or after that first "endstream", so the marker would
 * be the only stop both sides agree on. Output beyond `cap` stops decoding with `over`; the only expanding form is
 * ASCII85's "z" (one character for four zero bytes). Linear in the bytes scanned.
 */
export function decodeTextStage(b: Buffer, start: number, kind: "ascii85" | "asciihex", cap: number): TextStageResult {
  const remaining = Math.max(0, b.length - start);
  const out = Buffer.allocUnsafe(Math.max(0, Math.min(cap + 4, kind === "ascii85" ? remaining * 4 : Math.ceil(remaining / 2))));
  let o = 0;
  let i = start;
  const result = (over: boolean, complete: boolean): TextStageResult => ({ data: out.subarray(0, o), over, complete, scanned: i - start });

  if (kind === "asciihex") {
    let hi = -1;
    for (; i < b.length; i++) {
      if (atEndstream(b, i)) return result(false, false);
      const c = b[i];
      const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 0x37 : c >= 0x61 && c <= 0x66 ? c - 0x57 : -1;
      if (v < 0) {
        if (c !== 0x3e) continue; // pdf.js skips every other byte
        i++;
        if (hi >= 0) {
          if (o + 1 > cap) return result(true, true);
          out[o++] = hi << 4; // an odd final digit, completed by ">"
        }
        return result(false, true);
      }
      if (hi < 0) {
        hi = v;
        continue;
      }
      if (o + 1 > cap) return result(true, false);
      out[o++] = (hi << 4) | v;
      hi = -1;
    }
    return result(false, false);
  }

  // ASCII85: groups of five digits (any non-whitespace byte, value = byte - 33), "z" at a group start = four zeros.
  const next = (): number => {
    for (; i < b.length; i++) {
      if (atEndstream(b, i)) return -2;
      if (!isPdfJsSpace(b[i])) return b[i++];
    }
    return -1;
  };
  const digits = [0, 0, 0, 0, 0];
  for (;;) {
    const first = next();
    if (first < 0) return result(false, false); // no "~" before endstream / end of file
    if (first === 0x7e) return result(false, true); // "~"
    if (first === 0x7a) {
      if (o + 4 > cap) return result(true, false);
      out.fill(0, o, o + 4);
      o += 4;
      continue;
    }
    digits[0] = first;
    let n = 1;
    let ended = false;
    for (; n < 5; n++) {
      const c = next();
      if (c < 0) return result(false, false);
      if (c === 0x7e) {
        ended = true;
        break;
      }
      digits[n] = c;
    }
    for (let k = n; k < 5; k++) digits[k] = 0x75; // a partial group is padded with "u"
    let s = 0;
    for (let k = 0; k < 5; k++) s = s * 85 + (digits[k] - 33);
    const word = ((s % 0x100000000) + 0x100000000) % 0x100000000; // pdf.js keeps the low 32 bits
    const bytes = ended ? n - 1 : 4;
    if (o + bytes > cap) return result(true, false);
    for (let k = 0; k < bytes; k++) out[o++] = (word >>> (24 - 8 * k)) & 0xff;
    if (ended) return result(false, true);
  }
}

// A PDF name: "/" then regular characters, where "#hh" is an escaped byte. The alternatives can't overlap, so matching
// stays linear on hostile input.
const NAME = /\/((?:[^\s/<>[\]()%{}#\x00]|#[0-9a-fA-F]{2})+)/g;

/** True if any name in the file decodes to /Encrypt (pdf.js decodes #hh escapes, so "/Encr#79pt" counts too). */
function hasEncryptEntry(latin1: string): boolean {
  if (/\/Encrypt(?![^\s/<>[\]()%{}\x00])/.test(latin1)) return true;
  if (!latin1.includes("#")) return false;
  for (const m of latin1.matchAll(NAME)) {
    const name = m[1];
    if (name.includes("#") && name.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) === "Encrypt") {
      return true;
    }
  }
  return false;
}

export async function checkPdf(buf: Buffer, limits: PdfLimits = defaultPdfLimits()): Promise<void> {
  if (hasEncryptEntry(buf.toString("latin1"))) {
    throw new HttpError(422, ENCRYPTED_PDF_MESSAGE, "file_too_complex");
  }
  let total = 0;
  // Text stages of well-formed files never overlap, so together they read at most the whole file. Crafted files with
  // streams nested inside other streams' data could make each decode rescan the same bytes; this budget keeps the
  // guard linear and refuses them.
  let textScanned = 0;
  const decodeText = (start: number, kind: "ascii85" | "asciihex", cap: number) => {
    const decoded = decodeTextStage(buf, start, kind, cap);
    textScanned += decoded.scanned;
    if (decoded.over || !decoded.complete || textScanned > buf.length) throw unsafe();
    return decoded.data;
  };
  for (const body of objectBodies(buf)) {
    const stream = readStreamDict(buf, body);
    if (!stream) continue;
    const { filter } = stream;
    if (filter.kind === "unsupported") throw unsafe();
    if (filter.kind === "none") continue;
    const names = [...filter.names];
    // At most one text-encoding stage, and only in front (it is decoded first).
    const text = TEXT_ENCODINGS[names[0]];
    if (text) names.shift();
    if (names.length > 1) throw unsafe(); // any other chain
    const start = dataStart(buf, stream.afterKeyword);
    const cap = Math.min(limits.maxStreamBytes, limits.maxTotalBytes - total);
    if (!names.length) {
      // A text encoding on its own.
      total += decodeText(start, text!, cap).length;
      continue;
    }
    const [name] = names;
    if (NON_EXPANDING_IMAGE_CODECS.has(name)) {
      if (text) throw unsafe(); // [/ASCII85Decode /DCTDecode] and similar stay outside the approved policy
      continue;
    }
    if (!FLATE.has(name)) throw unsafe(); // LZW, RunLength, Crypt, a second text encoding, unknown
    let source = buf;
    let from = start;
    if (text) {
      source = decodeText(start, text, cap);
      from = 0;
    }
    const { size, over } = await countInflated(source, from, cap);
    if (over) throw unsafe();
    total += size;
  }
}
