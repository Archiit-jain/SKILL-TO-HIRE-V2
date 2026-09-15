// Engine 2.0 (hackathon release): JD decomposition, false-equivalence rules, evidence classification with reasons and
// confidence, score breakdown, education/certification nuances, recommendations, roadmap and the rules assistant.
// Synthetic documents only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyze, WEIGHTS } from "../src/analysis/analyze.js";
import { DEMO_JD, DEMO_NOW, DEMO_RESUME, demoAnalysis } from "../src/analysis/demo.js";
import { decomposeJd, jdSentences } from "../src/analysis/requirements.js";
import { findSkills, getSkill, isAmbiguousMention, RELATED } from "../src/analysis/skills.js";
import type { AnalysisResult, SkillStatus } from "../src/analysis/types.js";
import { answerFromAnalysis } from "../src/assistant/engine.js";
import { SAMPLE_JD, SAMPLE_RESUME } from "./fixtures.js";

const NOW = new Date("2026-09-13T00:00:00Z");
const run = (resumeText: string, jdText: string) => analyze({ resumeText, jdText, resumeName: "cv.pdf", privacyMode: false, now: NOW });
const allSkills = (r: AnalysisResult): SkillStatus[] => [...r.strongSkills, ...r.partialSkills, ...r.missingSkills];
const skill = (r: AnalysisResult, name: string) => {
  const s = allSkills(r).find((x) => x.skill === name);
  assert.ok(s, `${name} is in the analysis`);
  return s;
};

describe("no false equivalence between different skills", () => {
  const cases: Array<[resume: string, jdSkill: string, related: string]> = [
    ["Experience\n• Built and deployed services with Docker", "Kubernetes", "Docker"],
    ["Experience\n• Orchestrated services with Kubernetes", "Docker", "Kubernetes"],
    ["Skills\nGitHub, GitHub Actions", "Git", "GitHub"],
    ["Experience\n• Built dashboards with React", "JavaScript", "React"],
    ["Experience\n• Designed PostgreSQL schemas", "SQL", "PostgreSQL"],
    ["Experience\n• Wrote SQL reports", "PostgreSQL", "SQL"],
    ["Experience\n• Wrote a game engine in C++", "C", "C++"],
    ["Experience\n• Issued JWT tokens for the API", "OAuth", "JWT"],
  ];
  for (const [resume, jdSkill, related] of cases) {
    it(`${related} is not counted as ${jdSkill}`, () => {
      const jd = `Requirements:\n• Hands-on ${jdSkill === "C" ? "C programming" : jdSkill} experience`;
      const s = skill(run(resume, jd), jdSkill);
      assert.equal(s.status, "missing");
      assert.deepEqual(s.related.map((x) => x.skill), [related], "related skill is shown for context");
      assert.match(s.reason, /isn't counted/);
    });
  }

  it("keeps aliases that really are the same skill", () => {
    const found = findSkills("Deployed to EKS with kubectl; Postgres; ReactJS; Golang; scikit-learn; OAuth 2.0");
    for (const s of ["Kubernetes", "PostgreSQL", "React", "Go", "Scikit-learn", "OAuth"]) assert.ok(found.has(s), s);
    for (const s of ["Docker", "SQL", "JavaScript", "JWT"]) assert.ok(!found.has(s), `unexpected ${s}`);
  });

  it("no longer reads version control, containerisation or a lambda expression as a named tool", () => {
    const found = findSkills("Used version control, containerization and Lambda expressions in Java");
    for (const s of ["Git", "Docker", "AWS"]) assert.ok(!found.has(s), `unexpected ${s}`);
  });

  it("every related-skill link points at a known skill", () => {
    for (const [key, list] of Object.entries(RELATED)) {
      assert.doesNotThrow(() => getSkill(key));
      for (const r of list) assert.doesNotThrow(() => getSkill(r.skill), `${key} -> ${r.skill}`);
    }
  });
});

describe("job description decomposition", () => {
  it("records each requirement with its sentence, type reason and confidence", () => {
    const jd = decomposeJd(SAMPLE_JD);
    const byLabel = Object.fromEntries(jd.all.map((r) => [r.label, r]));
    assert.equal(byLabel["Python"].requirementType, "required");
    assert.equal(byLabel["Python"].jdEvidence, "Strong Python and SQL skills");
    assert.equal(byLabel["Python"].typeReason, 'Listed under "Requirements"');
    assert.equal(byLabel["Python"].confidence, "high");
    assert.equal(byLabel["Terraform"].typeReason, 'Listed under "Preferred"');
    assert.equal(byLabel["2+ years of experience"].kind, "experience");
    assert.equal(byLabel["Bachelor's degree"].kind, "education");
    assert.equal(byLabel["AWS certification"].requirementType, "preferred");
    assert.match(byLabel["AWS certification"].typeReason, /a plus/);
  });

  it("marks requirements outside a requirements heading as medium confidence", () => {
    const jd = decomposeJd("Backend Developer\nWe build our APIs with FastAPI.\nRequirements:\n• Python");
    const fastapi = jd.skills.find((s) => s.skill === "FastAPI")!;
    assert.equal(fastapi.requirementType, "required");
    assert.equal(fastapi.confidence, "medium");
    assert.equal(jd.skills.find((s) => s.skill === "Python")!.confidence, "high");
  });

  it("ignores skills mentioned only under benefits", () => {
    const jd = decomposeJd("Requirements:\n• Python\nBenefits:\n• Free AWS training budget");
    assert.deepEqual(jd.skills.map((s) => s.skill), ["Python"]);
  });

  it("reads inline headings and explicit preferred wording", () => {
    const sentences = jdSentences("Preferred: Terraform\nKubernetes experience is a plus");
    assert.equal(sentences[0].text, "Terraform");
    assert.equal(sentences[0].heading?.kind, "preferred");
    assert.equal(sentences[1].preferredCue, "a plus");
  });

  it("detects degree equivalence and field of study", () => {
    const edu = decomposeJd("Requirements:\n• Bachelor's degree in Computer Science or equivalent practical experience").education!;
    assert.equal(edu.equivalentAccepted, true);
    assert.equal(edu.fieldMentioned, true);
  });
});

describe("evidence classification", () => {
  it("explains Strong, Partial and Missing with evidence and confidence", () => {
    const r = run(SAMPLE_RESUME, SAMPLE_JD);
    const python = skill(r, "Python");
    assert.equal(python.status, "strong");
    assert.equal(python.confidence, "high");
    assert.match(python.reason, /Experience section/);
    assert.equal(python.jdEvidence, "Strong Python and SQL skills");
    const docker = skill(r, "Docker");
    assert.equal(docker.status, "partial");
    assert.match(docker.reason, /Only listed in your Skills section/);
    assert.equal(docker.evidence, "Python, SQL, Docker, Pandas, Git, Communication");
    const kube = skill(r, "Kubernetes");
    assert.match(kube.reason, /^Not found anywhere in your resume\./);
    assert.deepEqual(kube.related.map((x) => x.skill), ["Docker"], "Docker is only listed, and is related context, not a match");
  });

  it("marks a Strong skill without an action verb as medium confidence", () => {
    const s = skill(run("Experience\nPython - internal tooling team", "Requirements:\n• Python"), "Python");
    assert.equal(s.status, "strong");
    assert.equal(s.confidence, "medium");
  });

  it("marks matches on ordinary English words as low confidence, but not when the line is clearly technical", () => {
    const vague = skill(run("Experience\n• Delivered Swift turnaround on customer tickets", "Requirements:\n• Swift"), "Swift");
    assert.equal(vague.status, "strong");
    assert.equal(vague.confidence, "low");
    assert.match(vague.reason, /ordinary English/);
    assert.equal(skill(run("Experience\n• Built iOS apps in Swift", "Requirements:\n• Swift for iOS"), "Swift").confidence, "high");
    assert.equal(isAmbiguousMention(getSkill("Swift"), "Built iOS apps in Swift"), false);
  });

  it("lowers overall confidence when the resume has no recognisable sections", () => {
    const r = run("I like Python and SQL a lot and use them daily.", SAMPLE_JD);
    assert.equal(r.confidence.level, "low");
    assert.ok(r.confidence.reasons.some((x) => /headings/.test(x)));
    assert.equal(run(SAMPLE_RESUME, SAMPLE_JD).confidence.level, "high");
  });
});

describe("score breakdown", () => {
  const r = run(SAMPLE_RESUME, SAMPLE_JD);

  it("names the TF-IDF component for what it is", () => {
    const wording = r.components.find((c) => c.key === "wording")!;
    assert.equal(wording.name, "Wording Similarity");
    assert.match(wording.description, /TF-IDF/);
    assert.match(wording.description, /not meaning/);
    assert.ok(!JSON.stringify(r).includes("Semantic"));
  });

  it("contributions add up to the whole-number overall score", () => {
    assert.equal(Number.isInteger(r.overallScore), true);
    const sum = r.components.reduce((s, c) => s + c.contribution, 0);
    assert.ok(Math.abs(sum - r.overallScore) <= 0.5 + r.components.length * 0.05, `sum ${sum} vs ${r.overallScore}`);
    for (const c of r.components) assert.ok(Math.abs(c.contribution - c.score * c.weight) < 0.2, c.name);
  });

  it("keeps the prototype component weights", () => {
    assert.deepEqual(WEIGHTS, { skills: 0.35, wording: 0.25, experience: 0.15, education: 0.1, projects: 0.1, certifications: 0.05 });
  });

  it("does not assess education when equivalent experience is accepted and no degree is found", () => {
    const res = run("Experience\n• Built Python services, Jan 2020 - Dec 2024", "Requirements:\n• Python\n• Bachelor's degree or equivalent experience");
    assert.ok(!res.components.some((c) => c.key === "education"));
    assert.ok(res.notAssessed.some((n) => /equivalent experience/.test(n)));
    const rec = res.recommendations.find((x) => x.kind === "education")!;
    assert.equal(rec.impactPoints, 0);
  });

  it("counts a degree in progress, at medium confidence", () => {
    const res = run("Education\nB.Tech in Computer Science, expected 2027", "Requirements:\n• Python\n• Bachelor's degree");
    const edu = res.components.find((c) => c.key === "education")!;
    assert.equal(edu.score, 100);
    assert.equal(edu.confidence, "medium");
    assert.match(edu.description, /in progress/);
  });

  it("does not count a course as a certification", () => {
    const res = run("Certifications\nUdemy course: AWS for beginners", "Requirements:\n• AWS certification required");
    const cert = res.components.find((c) => c.key === "certifications")!;
    assert.equal(cert.score, 0);
    assert.match(cert.description, /course/);
    const real = run("Certifications\nAWS Certified Cloud Practitioner", "Requirements:\n• AWS certification required");
    assert.equal(real.components.find((c) => c.key === "certifications")!.score, 100);
  });

  it("asks for dates instead of claiming zero experience when no dated roles exist", () => {
    const res = run("Experience\n• Built Python tools for a local shop", "Requirements:\n• 2+ years of experience with Python");
    const exp = res.components.find((c) => c.key === "experience")!;
    assert.equal(exp.confidence, "low");
    assert.match(exp.description, /Add start and end dates/);
  });
});

describe("recommendations", () => {
  const r = run(SAMPLE_RESUME, SAMPLE_JD);

  it("orders required gaps first, then preferred, and numbers the priorities", () => {
    const targets = r.recommendations.map((x) => x.target);
    assert.ok(targets.indexOf("Kubernetes") < targets.indexOf("Docker"), "required missing before required partial");
    assert.ok(targets.indexOf("Docker") < targets.indexOf("Terraform"), "required before preferred");
    assert.deepEqual(r.recommendations.map((x) => x.priority), r.recommendations.map((_, i) => i + 1));
  });

  it("gives every recommendation the structured fields", () => {
    for (const rec of r.recommendations) {
      for (const field of ["whyItMatters", "jdEvidence", "gap", "action", "evidenceToAdd", "impactNote"] as const) {
        assert.ok(rec[field].length > 0, `${rec.target}.${field}`);
      }
      assert.ok(Number.isInteger(rec.impactPoints) && rec.impactPoints >= 0);
    }
  });

  it("computes impact from the scoring weights", () => {
    const kube = r.recommendations.find((x) => x.target === "Kubernetes")!;
    const skillsWeight = r.components.find((c) => c.key === "skills")!.weight;
    const projectsWeight = r.components.find((c) => c.key === "projects")!.weight;
    const skillTotal = allSkills(r).reduce((s, x) => s + x.importanceWeight, 0);
    const technicalTotal = allSkills(r).filter((x) => x.skill !== "Communication").reduce((s, x) => s + x.importanceWeight, 0);
    const expected = Math.round((skillsWeight / skillTotal + projectsWeight / technicalTotal) * 100);
    assert.ok(Math.abs(kube.impactPoints - expected) <= 1, `${kube.impactPoints} vs ${expected}`);
    // Closing a required gap is worth more than the same preferred gap.
    assert.ok(kube.impactPoints > r.recommendations.find((x) => x.target === "Terraform")!.impactPoints);
  });
});

describe("career roadmap", () => {
  it("follows required missing, required partial, preferred missing, preferred partial, then maintain", () => {
    const r = run(SAMPLE_RESUME, SAMPLE_JD);
    const rank = { "required-missing": 0, "required-partial": 1, "preferred-missing": 2, "preferred-partial": 3, maintain: 4 };
    // Items pulled forward as prerequisites are the only allowed exceptions to the group order.
    const ranks = r.roadmap.filter((i) => !i.movedEarlierFor).map((i) => rank[i.group]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
    const kube = r.roadmap.find((i) => i.skill === "Kubernetes")!;
    assert.deepEqual(kube.steps.map((s) => s.phase), ["learn", "build", "demonstrate", "document", "reanalyze"]);
    assert.ok(!JSON.stringify(r.roadmap).match(/\b(week|month|day)s?\b/i), "no invented timelines");
  });

  it("moves a prerequisite that is itself a gap before the skill that needs it", () => {
    const r = run("Skills\nPython", "Requirements:\n• Kubernetes\nPreferred:\n• Docker");
    const order = r.roadmap.map((i) => i.skill);
    assert.ok(order.indexOf("Docker") < order.indexOf("Kubernetes"));
    assert.equal(r.roadmap.find((i) => i.skill === "Docker")!.movedEarlierFor, "Kubernetes");
    assert.deepEqual(r.roadmap.find((i) => i.skill === "Kubernetes")!.prerequisites, ["Docker"]);
  });
});

describe("rules assistant with engine 2.0 evidence", () => {
  const r = run(SAMPLE_RESUME, SAMPLE_JD);

  it("answers a skill question with the reason, JD sentence, resume evidence and next step", () => {
    const reply = answerFromAnalysis("Why is Docker partial?", r);
    assert.match(reply.content, /\*\*Partial\*\*/);
    assert.match(reply.content, /Experience with Docker and Kubernetes/);
    assert.match(reply.content, /Resume evidence used/);
    assert.match(reply.content, /Next step/);
  });

  it("explains the calculation with contributions and reports confidence", () => {
    assert.match(answerFromAnalysis("How was my score calculated?", r).content, /points/);
    assert.match(answerFromAnalysis("How confident is this analysis?", r).content, /Confidence in this analysis: \*\*high\*\*/);
  });

  it("still answers from results saved by engine 1.0", () => {
    const legacy = JSON.parse(JSON.stringify(r));
    for (const key of ["recommendations", "roadmap", "requirements", "confidence"]) delete legacy[key];
    for (const s of [...legacy.strongSkills, ...legacy.partialSkills, ...legacy.missingSkills]) delete s.reason;
    assert.match(answerFromAnalysis("Why is Docker partial?", legacy).content, /Partial/);
    assert.match(answerFromAnalysis("What should I improve first?", legacy).content, /Kubernetes/);
    assert.match(answerFromAnalysis("What should I learn?", legacy).content, /learning path/);
  });
});

describe("demo sample", () => {
  it("is the real engine's output on the synthetic documents, not a stored result", () => {
    const demo = demoAnalysis();
    const direct = analyze({ resumeText: DEMO_RESUME, jdText: DEMO_JD, resumeName: "sample-resume.pdf", privacyMode: false, now: DEMO_NOW });
    assert.equal(demo.demo, true);
    assert.deepEqual({ ...demo, id: direct.id, demo: undefined }, { ...direct, demo: undefined });
  });

  it("is deterministic and shows every kind of rating", () => {
    const a = demoAnalysis();
    assert.equal(a.overallScore, demoAnalysis().overallScore);
    assert.ok(a.strongSkills.length && a.partialSkills.length && a.missingSkills.length);
    assert.ok(a.missingSkills.some((s) => s.related.length), "includes a related-but-different skill");
  });

  it("uses only synthetic contact details", () => {
    const emails = `${DEMO_RESUME}\n${DEMO_JD}`.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [];
    assert.ok(emails.every((e) => e.endsWith("@example.com")));
    assert.match(DEMO_RESUME, /synthetic sample/);
    assert.match(DEMO_JD, /fictional/);
  });
});
