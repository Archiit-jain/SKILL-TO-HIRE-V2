import mammoth from "mammoth";
import { config } from "../config.js";
import { HttpError } from "../http.js";

export type DocKind = "pdf" | "docx" | "txt";

const EXT_KIND: Record<string, DocKind> = { ".pdf": "pdf", ".docx": "docx", ".txt": "txt" };

/** Identify the file by its bytes, and require the extension to agree. Never trust the client MIME type. */
export function detectKind(buffer: Buffer, filename: string, allowed: DocKind[]): DocKind {
  const ext = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  const claimed = EXT_KIND[ext];
  if (!claimed || !allowed.includes(claimed)) {
    throw new HttpError(415, `Unsupported file type. Allowed: ${allowed.map((k) => "." + k).join(", ")}`, "file_type");
  }
  const isPdf = buffer.subarray(0, 5).toString("latin1") === "%PDF-";
  const isZip = buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
  const ok =
    (claimed === "pdf" && isPdf) ||
    (claimed === "docx" && isZip) ||
    (claimed === "txt" && !isPdf && !isZip && !buffer.includes(0));
  if (!ok) throw new HttpError(415, "File content does not match its extension", "file_type");
  return claimed;
}

/** Reject zip bombs before mammoth inflates anything: sum declared uncompressed sizes from the central directory. */
export function assertSafeZip(buf: Buffer) {
  const minEocd = 22;
  const searchStart = Math.max(0, buf.length - (minEocd + 0xffff));
  let eocd = -1;
  for (let i = buf.length - minEocd; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new HttpError(422, "Corrupt DOCX file", "file_corrupt");
  const entries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) throw new HttpError(422, "ZIP64 DOCX files are not supported", "file_corrupt");
  if (entries > config.upload.maxZipEntries) throw new HttpError(422, "DOCX has too many parts", "file_too_complex");

  let pos = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) {
      throw new HttpError(422, "Corrupt DOCX file", "file_corrupt");
    }
    total += buf.readUInt32LE(pos + 24);
    if (total > config.upload.maxDocxUncompressedBytes) {
      throw new HttpError(422, "DOCX expands to an unsafe size", "file_too_complex");
    }
    pos += 46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[\u2022\u25CF\u25AA\u2023\u2043\uF0B7]/g, "\n• ")
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, config.upload.maxExtractedChars);
}

export async function extractText(buffer: Buffer, filename: string, allowed: DocKind[]): Promise<string> {
  const kind = detectKind(buffer, filename, allowed);
  let raw: string;
  try {
    if (kind === "pdf") {
      // Loaded lazily so a PDF-library problem can only break PDF parsing, never the whole API.
      await import("./pdf-polyfill.js");
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 });
      try {
        const result = await parser.getText({ first: config.upload.maxPdfPages });
        raw = result.text;
      } finally {
        await parser.destroy();
      }
    } else if (kind === "docx") {
      assertSafeZip(buffer);
      raw = (await mammoth.extractRawText({ buffer })).value;
    } else {
      raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, `Could not read ${kind.toUpperCase()} file. Is it corrupt or password-protected?`, "file_corrupt");
  }
  // pdf-parse inserts "-- 1 of 3 --" page markers
  return normalizeText(raw.replace(/^-- \d+ of \d+ --$/gm, ""));
}
