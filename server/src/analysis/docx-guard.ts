import zlib from "node:zlib";
import { config } from "../config.js";
import { HttpError } from "../http.js";

/**
 * DOCX safety guard (security remediation P0: C-1, H-1). Runs on the upload buffer BEFORE mammoth/JSZip decompress
 * anything. Nothing is extracted to disk and entry names are never used as paths.
 *
 *  - ZIP structure: one end-of-central-directory record, no ZIP64, no split archives, central directory exactly where
 *    the record says, at most `maxZipEntries` entries, stored/deflate only, no encryption, no duplicate names, no
 *    Info-ZIP Unicode Path fields (JSZip would use that name instead of the one checked here), local headers that
 *    match the central directory.
 *  - Size: declared sizes of all entries <= `maxDocxUncompressedBytes`. Every part mammoth may read as XML
 *    (.xml/.rels names plus every relationship target except images) <= `maxDocxXmlPartBytes` each and
 *    <= `maxDocxXmlTotalBytes` together. mammoth builds a full XML DOM, which is where memory explodes.
 *  - Size lies: each XML part is actually inflated with a hard output cap of its declared size + 1 byte, and its real
 *    length and CRC-32 must match the central directory. JSZip otherwise inflates everything before noticing.
 *  - No XML part may contain a DTD (<!DOCTYPE / <!ENTITY); Office Open XML never uses one.
 *
 * This is structural and resource validation, not malware scanning.
 */

export const UNSAFE_DOCUMENT_MESSAGE = "This document is too large or complex to process safely.";
const CORRUPT_DOCX_MESSAGE = "Could not read DOCX file. Is it corrupt or password-protected?";

const unsafe = () => new HttpError(422, UNSAFE_DOCUMENT_MESSAGE, "file_too_complex");
const corrupt = () => new HttpError(422, CORRUPT_DOCX_MESSAGE, "file_corrupt");

export interface DocxLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxXmlPartBytes: number;
  maxXmlTotalBytes: number;
}

export const defaultDocxLimits = (): DocxLimits => ({
  maxEntries: config.upload.maxZipEntries,
  maxTotalBytes: config.upload.maxDocxUncompressedBytes,
  maxXmlPartBytes: config.upload.maxDocxXmlPartBytes,
  maxXmlTotalBytes: config.upload.maxDocxXmlTotalBytes,
});

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const EOCD_MIN = 22;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const EXTRA_ZIP64 = 0x0001;
const EXTRA_UNICODE_PATH = 0x7075;

const IMAGE_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|ico|webp)$/i;
const DTD_MARKERS = ["<!doctype", "<!entity"];

interface Entry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  dataStart: number;
}

function inBounds(buf: Buffer, start: number, length: number) {
  return start >= 0 && length >= 0 && start + length <= buf.length;
}

function extraFieldIds(buf: Buffer, start: number, length: number): number[] {
  const ids: number[] = [];
  let pos = start;
  const end = start + length;
  while (pos + 4 <= end) {
    ids.push(buf.readUInt16LE(pos));
    pos += 4 + buf.readUInt16LE(pos + 2);
  }
  return ids;
}

/** File names as JSZip exposes them: UTF-8 when the language-encoding flag is set, otherwise one char per byte. */
function decodeName(bytes: Buffer, flags: number) {
  return flags & FLAG_UTF8 ? bytes.toString("utf8") : bytes.toString("latin1");
}

function readEntries(buf: Buffer, limits: DocxLimits): Entry[] {
  if (buf.length < EOCD_MIN) throw corrupt();
  let eocd = -1;
  for (let i = buf.length - EOCD_MIN; i >= Math.max(0, buf.length - (EOCD_MIN + 0xffff)); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw corrupt();

  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const entriesOnDisk = buf.readUInt16LE(eocd + 8);
  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const zip64 =
    entryCount === 0xffff || entriesOnDisk === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff ||
    (eocd >= 20 && buf.readUInt32LE(eocd - 20) === SIG_ZIP64_LOCATOR);
  if (zip64) throw unsafe();
  if (disk !== 0 || cdDisk !== 0 || entriesOnDisk !== entryCount) throw unsafe(); // split/spanned archives
  if (entryCount > limits.maxEntries) throw unsafe();
  // The central directory must end exactly at the EOCD record: no prepended bytes that make readers disagree on offsets.
  if (cdOffset + cdSize !== eocd) throw corrupt();

  const entries: Entry[] = [];
  const seen = new Set<string>();
  let total = 0;
  let pos = cdOffset;
  for (let n = 0; n < entryCount; n++) {
    if (!inBounds(buf, pos, 46) || buf.readUInt32LE(pos) !== SIG_CENTRAL) throw corrupt();
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const size = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    if (!inBounds(buf, pos + 46, nameLen + extraLen + commentLen)) throw corrupt();

    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) throw unsafe();
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) throw unsafe();
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw unsafe();
    const extras = extraFieldIds(buf, pos + 46 + nameLen, extraLen);
    if (extras.includes(EXTRA_ZIP64) || extras.includes(EXTRA_UNICODE_PATH)) throw unsafe();

    const nameBytes = buf.subarray(pos + 46, pos + 46 + nameLen);
    const name = decodeName(nameBytes, flags);
    if (seen.has(name)) throw unsafe();
    seen.add(name);

    total += size;
    if (total > limits.maxTotalBytes) throw unsafe();

    // Local header: signature, same name, and the data range inside the buffer.
    if (!inBounds(buf, localOffset, 30) || buf.readUInt32LE(localOffset) !== SIG_LOCAL) throw corrupt();
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    if (!inBounds(buf, localOffset + 30, localNameLen + localExtraLen)) throw corrupt();
    if (!buf.subarray(localOffset + 30, localOffset + 30 + localNameLen).equals(nameBytes)) throw corrupt();
    const localExtras = extraFieldIds(buf, localOffset + 30 + localNameLen, localExtraLen);
    if (localExtras.includes(EXTRA_ZIP64) || localExtras.includes(EXTRA_UNICODE_PATH)) throw unsafe();
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (!inBounds(buf, dataStart, compressedSize)) throw corrupt();
    if (method === METHOD_STORED && compressedSize !== size) throw unsafe();

    entries.push({ name, method, crc, compressedSize, size, dataStart });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflates one entry with a hard output cap and checks that its real length and CRC-32 match the central directory. */
function verifiedContent(buf: Buffer, entry: Entry): Buffer {
  const data = buf.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  let out: Buffer;
  if (entry.method === METHOD_STORED) {
    out = data;
  } else {
    try {
      out = zlib.inflateRawSync(data, { maxOutputLength: entry.size + 1 });
    } catch (err) {
      // More output than declared = a size lie; anything else = broken deflate data.
      if ((err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") throw unsafe();
      throw corrupt();
    }
  }
  if (out.length > entry.size) throw unsafe();
  if (out.length !== entry.size || zlib.crc32(out) !== entry.crc) throw corrupt();
  return out;
}

function hasDtd(xml: Buffer) {
  const utf8 = xml.toString("latin1").toLowerCase();
  if (DTD_MARKERS.some((m) => utf8.includes(m))) return true;
  const utf16 = (xml.length >= 2 && xml[0] === 0xfe ? swap16(xml) : xml).toString("utf16le").toLowerCase();
  return DTD_MARKERS.some((m) => utf16.includes(m));
}

function swap16(xml: Buffer) {
  const copy = Buffer.from(xml.subarray(0, xml.length - (xml.length % 2)));
  return copy.swap16();
}

/** mammoth's path rules (lib/zipfile.js joinPath + docx-reader stripPrefix): a leading "/" resets the base. */
function joinPartPath(base: string, target: string) {
  const parts: string[] = [];
  for (const p of [base, target]) {
    if (!p) continue;
    if (p.startsWith("/")) parts.length = 0;
    parts.push(p);
  }
  return parts.join("/").replace(/^\/+/, "");
}

/** The part a relationships file belongs to: "word/_rels/document.xml.rels" -> base directory "word". */
function relationshipBase(relsName: string) {
  const idx = relsName.lastIndexOf("_rels/");
  return idx <= 0 ? "" : relsName.slice(0, idx - 1);
}

const isXmlName = (name: string) => /\.(xml|rels)$/i.test(name) || name === "[Content_Types].xml";

function attribute(tag: string, attr: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  return m ? (m[2] ?? m[3]) : undefined;
}

/**
 * Returns the names of every entry mammoth may parse as XML: .xml/.rels names, plus every existing entry that a
 * relationship points to, except image relationships to image files (mammoth's raw-text extraction never reads those).
 */
function relationshipTargets(buf: Buffer, entries: Map<string, Entry>, verified: Map<string, Buffer>): Set<string> {
  const xml = new Set<string>();
  for (const [name, entry] of entries) {
    if (!/\.rels$/i.test(name)) continue;
    const content = verifiedContent(buf, entry);
    verified.set(name, content);
    const base = relationshipBase(name);
    for (const tag of content.toString("utf8").match(/<(?:\w+:)?Relationship\b[^>]*>/g) ?? []) {
      const target = attribute(tag, "Target");
      if (!target || attribute(tag, "TargetMode")?.toLowerCase() === "external") continue;
      const type = attribute(tag, "Type") ?? "";
      for (const candidate of [joinPartPath(base, target), joinPartPath("", target)]) {
        if (!entries.has(candidate)) continue;
        if (type === IMAGE_RELATIONSHIP && IMAGE_EXTENSIONS.test(candidate)) continue;
        xml.add(candidate);
      }
    }
  }
  return xml;
}

export function checkDocx(buf: Buffer, limits: DocxLimits = defaultDocxLimits()): void {
  const list = readEntries(buf, limits);
  const entries = new Map(list.map((e) => [e.name, e]));
  if (!entries.has("[Content_Types].xml") || !entries.has("word/document.xml")) throw corrupt();

  const enforceXmlCaps = (names: Set<string>) => {
    let xmlTotal = 0;
    for (const name of names) {
      const entry = entries.get(name)!;
      if (entry.size > limits.maxXmlPartBytes) throw unsafe();
      xmlTotal += entry.size;
      if (xmlTotal > limits.maxXmlTotalBytes) throw unsafe();
    }
  };

  // 1. Declared caps on everything named like XML (this includes every .rels file) BEFORE anything is inflated.
  const xmlNames = new Set([...entries.keys()].filter(isXmlName));
  enforceXmlCaps(xmlNames);
  // 2. Only then read the (now size-verified, capped) relationship files and add every part they point at.
  const verified = new Map<string, Buffer>();
  for (const target of relationshipTargets(buf, entries, verified)) xmlNames.add(target);
  enforceXmlCaps(xmlNames);
  // 3. Real-size + CRC verification and DTD check of every XML part.
  for (const name of xmlNames) {
    const content = verified.get(name) ?? verifiedContent(buf, entries.get(name)!);
    if (hasDtd(content)) throw unsafe();
  }
}
