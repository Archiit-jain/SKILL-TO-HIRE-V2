import mammoth from "mammoth";
import { config } from "../config.js";
import { HttpError } from "../http.js";
import { checkDocx, UNSAFE_DOCUMENT_MESSAGE } from "./docx-guard.js";
import { checkPdf } from "./pdf-guard.js";

export type DocKind = "pdf" | "docx" | "txt";

const EXT_KIND: Record<string, DocKind> = { ".pdf": "pdf", ".docx": "docx", ".txt": "txt" };

// Security remediation P1 (D-4): documents over a limit are rejected, never silently truncated or partly read.
export const RESUME_TOO_LONG_MESSAGE = "Your resume has more text than we can analyse (limit: 100,000 characters).";
export const JD_TOO_LONG_MESSAGE = "The job description has more text than we can analyse (limit: 50,000 characters).";
export const PDF_TOO_MANY_PAGES_MESSAGE = "This PDF has more than 20 pages. Please upload a shorter document.";

export const documentTooLong = (message: string) => new HttpError(422, message, "document_too_long");

/** D-11 (P2): the upload's parse deadline passed and parsing was stopped. Same public error as other safety limits. */
export const parseDeadlineExceeded = () => new HttpError(422, UNSAFE_DOCUMENT_MESSAGE, "file_too_complex");

/** Throws 422 document_too_long when `text` (already cleaned) is longer than `maxChars`. */
export function assertTextWithinLimit(text: string, maxChars: number, message: string): string {
  if (text.length > maxChars) throw documentTooLong(message);
  return text;
}

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

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[\u2022\u25CF\u25AA\u2023\u2043\uF0B7]/g, "\n• ")
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractText(buffer: Buffer, filename: string, allowed: DocKind[]): Promise<string> {
  const kind = detectKind(buffer, filename, allowed);
  let raw: string;
  try {
    if (kind === "pdf") {
      await checkPdf(buffer); // encryption, filter policy and inflated-size caps (before pdf.js is even loaded)
      // Loaded lazily so a PDF-library problem can only break PDF parsing, never the whole API.
      await import("./pdf-polyfill.js");
      const { PDFParse } = await import("pdf-parse");
      // Use the worker embedded as a data URL: bundlers don't trace pdf.js's worker file path on serverless hosts.
      const { getData } = await import("pdf-parse/worker");
      PDFParse.setWorker(getData());
      const parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 });
      try {
        // pdf-parse 2.4.5: getInfo() loads the document and reports doc.numPages without extracting any page text;
        // getText() then reuses the same loaded document and reads every page.
        const { total } = await parser.getInfo();
        if (total > config.upload.maxPdfPages) throw documentTooLong(PDF_TOO_MANY_PAGES_MESSAGE);
        const result = await parser.getText();
        raw = result.text;
      } finally {
        await parser.destroy();
      }
    } else if (kind === "docx") {
      checkDocx(buffer); // structure, declared + real sizes, relationship-aware XML caps, DTD (before mammoth)
      raw = (await mammoth.extractRawText({ buffer })).value;
    } else {
      raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // Only the document kind and the error class are logged (P2 log hardening): library messages can quote document
    // content or internal paths.
    console.warn(`[extract] ${kind} parse failed: ${(err as Error)?.name ?? "error"}`);
    throw new HttpError(422, `Could not read ${kind.toUpperCase()} file. Is it corrupt or password-protected?`, "file_corrupt");
  }
  // pdf-parse inserts "-- 1 of 3 --" page markers
  return normalizeText(raw.replace(/^-- \d+ of \d+ --$/gm, ""));
}
