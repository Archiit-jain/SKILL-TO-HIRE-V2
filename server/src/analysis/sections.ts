export type SectionName = "summary" | "skills" | "experience" | "projects" | "education" | "certifications" | "other";

const HEADINGS: Array<[SectionName, RegExp]> = [
  ["summary", /^(professional\s+)?(summary|profile|objective|about\s+me|career\s+objective|overview)$/],
  ["skills", /^(technical\s+|core\s+|key\s+)?(skills?|competenc(y|ies)|technologies|tech\s+stack|tools(\s+(and|&)\s+technologies)?|expertise)$/],
  ["experience", /^(professional\s+|work\s+|relevant\s+)?(experience|employment(\s+history)?|work\s+history|internships?|career\s+history)$/],
  ["projects", /^(academic\s+|personal\s+|key\s+|selected\s+)?projects?(\s+(work|experience))?$/],
  ["education", /^(education(al)?(\s+(background|qualifications?))?|academic\s+(background|qualifications?)|qualifications?)$/],
  ["certifications", /^(certifications?|licen[cs]es?(\s+(and|&)\s+certifications?)?|courses?(\s+(and|&)\s+certifications?)?|certifications?\s+(and|&)\s+(courses?|training))$/],
];

export interface Line {
  text: string;
  section: SectionName;
}

export function headingOf(line: string): SectionName | null {
  const cleaned = line
    .toLowerCase()
    .replace(/[:\-–—_|•*#=]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.split(" ").length > 5) return null;
  for (const [name, re] of HEADINGS) if (re.test(cleaned)) return name;
  return null;
}

/** Split a resume into lines tagged with the section heading they fall under. */
export function splitSections(text: string): Line[] {
  let current: SectionName = "other";
  const lines: Line[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[•\-*\s]+/, "").trim();
    if (!line) continue;
    const heading = headingOf(line);
    if (heading) {
      current = heading;
      continue;
    }
    lines.push({ text: line, section: current });
  }
  return lines;
}

export const SECTION_LABEL: Record<SectionName, string> = {
  summary: "Summary",
  skills: "Skills",
  experience: "Experience",
  projects: "Projects",
  education: "Education",
  certifications: "Certifications",
  other: "General",
};
