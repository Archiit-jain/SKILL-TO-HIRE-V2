// Synthetic sample documents for tests. Not real people.
import zlib from "node:zlib";

/** Builds a minimal, valid single-page PDF (Helvetica, one text line per input line) with a correct xref table. */
export function makePdf(text: string): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, " ");
  const lines = text.split("\n");
  const stream = ["BT", "/F1 10 Tf", "12 TL", "40 800 Td", ...lines.map((l) => `(${esc(l)}) '`), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

export const SAMPLE_RESUME = `Priya Sharma
priya.sharma@example.com | +91 98765 43210 | github.com/priya-example

Summary
Data engineer with a focus on reliable pipelines. Familiar with AWS.

Skills
Python, SQL, Docker, Pandas, Git, Communication

Experience
Data Engineering Intern, Example Analytics - Jun 2023 - Present
• Developed a Python ETL pipeline that loads 2M rows daily into PostgreSQL
• Designed and optimised complex SQL queries for reporting dashboards

Software Developer, Sample Corp - Jan 2021 - Dec 2022
• Built REST APIs with FastAPI and deployed them on AWS EC2

Projects
Churn Predictor
• Built machine learning models with scikit-learn to predict customer churn

Education
B.Tech in Computer Science and Engineering, Example Institute of Technology, 2019 - 2023

Certifications
AWS Certified Cloud Practitioner
`;

export const SAMPLE_JD = `Job Title: Data Engineer

We are looking for a Data Engineer to join our platform team.

Requirements:
• 2+ years of experience building data pipelines
• Strong Python and SQL skills
• Experience with Docker and Kubernetes
• Machine Learning fundamentals
• Bachelor's degree in Computer Science or related field

Preferred:
• Terraform
• AWS certification is a plus
`;

// ---- Synthetic ZIP / DOCX builder (no JSZip: every header is written by hand so tests can craft hostile archives) ----

export interface ZipEntrySpec {
  name: string;
  data: Buffer | string;
  /** 0 = stored, 8 = deflate (default), anything else is written as-is for "unsupported method" tests. */
  method?: number;
  /** Override the uncompressed size written in the central directory and local header (size-lie tests). */
  declaredSize?: number;
  /** Override the CRC-32 written in both headers. */
  crc?: number;
  flags?: number;
  /** Raw extra field bytes, written to both headers. */
  extra?: Buffer;
  /** Bytes written as the entry body instead of the (deflated) data, e.g. a broken deflate stream. */
  rawBody?: Buffer;
}

export function makeZip(specs: ZipEntrySpec[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const spec of specs) {
    const raw = Buffer.isBuffer(spec.data) ? spec.data : Buffer.from(spec.data, "utf8");
    const method = spec.method ?? 8;
    const body = spec.rawBody ?? (method === 8 ? zlib.deflateRawSync(raw) : raw);
    const name = Buffer.from(spec.name, "utf8");
    const extra = spec.extra ?? Buffer.alloc(0);
    const crc = spec.crc ?? zlib.crc32(raw);
    const size = spec.declaredSize ?? raw.length;
    const flags = spec.flags ?? 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const localRecord = Buffer.concat([local, name, extra, body]);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name, extra]));

    locals.push(localRecord);
    offset += localRecord.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(specs.length, 8);
  eocd.writeUInt16LE(specs.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
export const PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

export function documentXml(paragraphs: string[] | Buffer): Buffer {
  const body = Buffer.isBuffer(paragraphs)
    ? paragraphs
    : Buffer.from(paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/[<&]/g, " ")}</w:t></w:r></w:p>`).join(""));
  return Buffer.concat([Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>`), body, Buffer.from("</w:body></w:document>")]);
}

/** Minimal valid DOCX entries; `extra` entries are appended. */
export function docxEntries(text: string, extra: ZipEntrySpec[] = []): ZipEntrySpec[] {
  return [
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: PACKAGE_RELS },
    { name: "word/document.xml", data: documentXml(text.split("\n")) },
    ...extra,
  ];
}

export const makeDocx = (text: string, extra: ZipEntrySpec[] = []) => makeZip(docxEntries(text, extra));

// ---- Synthetic PDF builder with arbitrary stream objects (compression-bomb and filter tests) ----

export interface PdfStreamSpec {
  /** Dictionary entries other than /Length, e.g. "/Filter /FlateDecode". */
  dict: string;
  /** Bytes written between "stream" and "endstream". */
  data: Buffer;
  /** Override the /Length value (default: data length). */
  length?: string;
}

/** One-page PDF whose page content is `text`; `streams` are appended as extra (unreferenced) stream objects. */
export function makePdfWithStreams(text: string, streams: PdfStreamSpec[] = [], opts: { trailerExtra?: string; contentDict?: string; contentData?: Buffer } = {}): Buffer {
  const esc = (s: string) => s.replace(/[\()]/g, (c) => "\\" + c);
  const content = opts.contentData ?? Buffer.from(["BT", "/F1 10 Tf", "12 TL", "40 800 Td", ...text.split("\n").map((l) => `(${esc(l)}) '`), "ET"].join("\n"), "latin1");
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} ${opts.contentDict ?? ""} >>\nstream\n`, "latin1"), content, Buffer.from("\nendstream")]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    ...streams.map((s) => Buffer.concat([Buffer.from(`<< /Length ${s.length ?? s.data.length} ${s.dict} >>\nstream\n`, "latin1"), s.data, Buffer.from("\nendstream")])),
  ];
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  let len = parts[0].length;
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(len);
    const record = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), obj, Buffer.from("\nendobj\n")]);
    parts.push(record);
    len += record.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${opts.trailerExtra ?? ""} >>\nstartxref\n${len}\n%%EOF\n`));
  return Buffer.concat(parts);
}

/** Valid PDF with one text page per entry of `pages` (each page's lines separated by "\n"). */
export function makeMultiPagePdf(pages: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, " ");
  const fontObj = 3 + pages.length * 2;
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const kids: number[] = [];
  pages.forEach((text, i) => {
    const pageObj = 3 + i * 2;
    kids.push(pageObj);
    const stream = ["BT", "/F1 10 Tf", "12 TL", "40 800 Td", ...text.split("\n").map((l) => `(${esc(l)}) '`), "ET"].join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents ${pageObj + 1} 0 R /Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
