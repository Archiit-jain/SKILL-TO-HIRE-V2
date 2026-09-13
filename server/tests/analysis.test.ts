import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyze, extractRequirements } from "../src/analysis/analyze.js";
import { assertSafeZip, detectKind, extractText } from "../src/analysis/extract.js";
import { anonymiseFilename, redactPII, safeFilename } from "../src/analysis/redact.js";
import { headingOf, splitSections } from "../src/analysis/sections.js";
import { guessJobTitle, highestDegree, monthsFromDateRanges, requiredDegree, requiredYears } from "../src/analysis/signals.js";
import { findSkills } from "../src/analysis/skills.js";
import { answerFromAnalysis } from "../src/assistant/engine.js";
import { makePdf, SAMPLE_JD, SAMPLE_RESUME } from "./fixtures.js";

const NOW = new Date("2026-09-13T00:00:00Z");

describe("skill matching", () => {
  it("finds skills with punctuation-heavy names and aliases", () => {
    const found = findSkills("Worked with C++, C#, Node.js, K8s and scikit-learn; deployed to GCP.");
    for (const s of ["C++", "C#", "Node.js", "Kubernetes", "Scikit-learn", "Google Cloud"]) assert.ok(found.has(s), s);
  });

  it("does not match ambiguous English words", () => {
    const found = findSkills("I go to meetings, excel at rest and can swiftly rust-proof a spring bootstrap.");
    for (const s of ["Go", "Excel", "REST APIs", "Swift", "Rust", "Spring Boot", "Bootstrap", "R", "C"]) {
      assert.ok(!found.has(s), `unexpected ${s}`);
    }
  });

  it("does not match Java inside JavaScript", () => {
    const found = findSkills("Built UIs in JavaScript");
    assert.ok(found.has("JavaScript"));
    assert.ok(!found.has("Java"));
  });
});

describe("sections and signals", () => {
  it("detects common headings", () => {
    assert.equal(headingOf("WORK EXPERIENCE"), "experience");
    assert.equal(headingOf("Technical Skills:"), "skills");
    assert.equal(headingOf("Academic Projects"), "projects");
    assert.equal(headingOf("Developed a Python pipeline"), null);
  });

  it("tags lines with their section", () => {
    const lines = splitSections(SAMPLE_RESUME);
    assert.equal(lines.find((l) => l.text.startsWith("Built machine learning"))?.section, "projects");
    assert.equal(lines.find((l) => l.text.startsWith("Python, SQL"))?.section, "skills");
  });

  it("merges overlapping date ranges", () => {
    const months = monthsFromDateRanges("Jan 2020 - Dec 2020\nJun 2020 - Jun 2021", NOW);
    assert.equal(months, 17);
    assert.equal(monthsFromDateRanges("Mar 2025 - Present", NOW), 18);
  });

  it("reads years and degree requirements", () => {
    assert.equal(requiredYears("3+ years of professional experience"), 3);
    assert.equal(requiredYears("2-4 years experience in Python"), 2);
    assert.equal(requiredYears("Great team"), null);
    assert.equal(requiredDegree("Bachelor's or Master's degree in CS"), 2);
    assert.equal(highestDegree("M.Tech in AI, B.Tech in CSE"), 3);
  });

  it("guesses a job title", () => {
    assert.equal(guessJobTitle(SAMPLE_JD), "Data Engineer");
    assert.equal(guessJobTitle("Backend Developer\nWe build things."), "Backend Developer");
  });
});

describe("requirement extraction", () => {
  it("separates required and preferred skills", () => {
    const reqs = Object.fromEntries(extractRequirements(SAMPLE_JD).map((r) => [r.skill, r.requirementType]));
    assert.equal(reqs["Python"], "required");
    assert.equal(reqs["Kubernetes"], "required");
    assert.equal(reqs["Terraform"], "preferred");
    assert.equal(reqs["AWS"], "preferred");
  });
});

describe("analyze()", () => {
  const result = analyze({ resumeText: SAMPLE_RESUME, jdText: SAMPLE_JD, resumeName: "Priya_Sharma.pdf", privacyMode: true, now: NOW });

  it("classifies strong, partial and missing skills from evidence", () => {
    const names = (xs: { skill: string }[]) => xs.map((x) => x.skill).sort();
    assert.ok(names(result.strongSkills).includes("Python"));
    assert.ok(names(result.strongSkills).includes("Machine Learning"));
    assert.deepEqual(names(result.partialSkills), ["Docker"]);
    assert.deepEqual(names(result.missingSkills), ["Kubernetes", "Terraform"]);
  });

  it("produces a weighted overall score from normalised weights", () => {
    const weightSum = result.components.reduce((s, c) => s + c.weight, 0);
    assert.ok(Math.abs(weightSum - 1) < 0.01);
    const recomputed = result.components.reduce((s, c) => s + c.score * c.weight, 0);
    assert.ok(Math.abs(recomputed - result.overallScore) < 0.5);
    assert.ok(result.overallScore >= 0 && result.overallScore <= 100);
  });

  it("is deterministic", () => {
    const again = analyze({ resumeText: SAMPLE_RESUME, jdText: SAMPLE_JD, resumeName: "x.pdf", privacyMode: true, now: NOW });
    assert.equal(again.overallScore, result.overallScore);
  });

  it("applies privacy mode", () => {
    assert.equal(result.resumeName, "resume.pdf");
    const withContact = analyze({
      resumeText: "Experience\nBuilt Python tools, contact me at a.b@example.com or +91 98765 43210\n" + SAMPLE_RESUME,
      jdText: SAMPLE_JD,
      resumeName: "cv.pdf",
      privacyMode: true,
      now: NOW,
    });
    const evidence = JSON.stringify(withContact);
    assert.ok(!evidence.includes("a.b@example.com"));
    assert.ok(!evidence.includes("98765 43210"));
  });

  it("excludes components the JD gives no basis for", () => {
    const r = analyze({ resumeText: SAMPLE_RESUME, jdText: "Frontend Developer\nWe need React and TypeScript skills for our web app.", resumeName: "cv.pdf", privacyMode: false, now: NOW });
    const names = r.components.map((c) => c.name);
    assert.ok(!names.includes("Experience"));
    assert.ok(!names.includes("Education"));
    assert.ok(r.notAssessed.some((n) => n.startsWith("Experience")));
  });
});

describe("assistant (rules mode)", () => {
  const result = analyze({ resumeText: SAMPLE_RESUME, jdText: SAMPLE_JD, resumeName: "cv.pdf", privacyMode: false, now: NOW });

  it("explains a specific skill using stored evidence", () => {
    const reply = answerFromAnalysis("Why is Docker only partial?", result);
    assert.match(reply.content, /Docker/);
    assert.match(reply.content, /Partial/);
  });

  it("prioritises required gaps", () => {
    const reply = answerFromAnalysis("What should I improve first?", result);
    assert.ok(reply.content.indexOf("Kubernetes") < reply.content.indexOf("Terraform"));
  });

  it("handles no analysis", () => {
    assert.match(answerFromAnalysis("hello", null).content, /New Analysis/);
  });
});

describe("file handling", () => {
  it("extracts text from a PDF", async () => {
    const text = await extractText(makePdf("Experience\nDeveloped Python services"), "cv.pdf", ["pdf"]);
    assert.match(text, /Developed Python services/);
  });

  it("rejects mismatched content and extensions", () => {
    assert.throws(() => detectKind(Buffer.from("hello"), "cv.pdf", ["pdf"]), /does not match/);
    assert.throws(() => detectKind(makePdf("x"), "cv.exe", ["pdf", "docx"]), /Unsupported/);
    assert.throws(() => detectKind(makePdf("x"), "jd.txt", ["txt"]), /does not match/);
  });

  it("rejects zip bombs by declared size", () => {
    // Local header + one central directory entry claiming 4GB uncompressed + EOCD
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt32LE(0xfffffff0, 24);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(4, 16);
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), cd, eocd]);
    assert.throws(() => assertSafeZip(zip), /unsafe size/);
  });

  it("sanitises filenames and PII", () => {
    assert.equal(safeFilename("..\\..\\evil<script>.pdf"), "evil_script_.pdf");
    assert.equal(anonymiseFilename("Priya Sharma CV.docx"), "resume.docx");
    assert.equal(redactPII("mail x@y.io, call 9876543210, see https://x.dev/me"), "mail [email], call [phone], see [link]");
  });
});
