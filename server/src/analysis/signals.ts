/** Years of experience, degree level and title extraction. Pure functions over plain text. */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const YEAR = "((?:19|20)\\d{2})";
// 5 capture groups per point: month name, its year, numeric month, its year, bare year
const POINT = `(?:\\b${MONTH_RE}\\.?,?\\s+${YEAR}|\\b(\\d{1,2})\\s*[/.-]\\s*${YEAR}|\\b${YEAR})\\b`;
const END = `(?:${POINT}|\\b(present|current|now|till\\s+date|ongoing)\\b)`;
const RANGE_RE = new RegExp(`${POINT}\\s*(?:-|–|—|to|until)\\s*${END}`, "gi");

function toMonthIndex(m: RegExpMatchArray, offset: number, now: Date, present?: string): number | null {
  const [monName, monYear, numMon, numYear, yearOnly] = [m[offset], m[offset + 1], m[offset + 2], m[offset + 3], m[offset + 4]];
  if (present) return now.getFullYear() * 12 + now.getMonth();
  if (monName && monYear) return Number(monYear) * 12 + MONTHS[monName.toLowerCase().slice(0, 3)];
  if (numMon && numYear) {
    const month = Number(numMon) - 1;
    return month >= 0 && month < 12 ? Number(numYear) * 12 + month : null;
  }
  if (yearOnly) return Number(yearOnly) * 12;
  return null;
}

/** Total months covered by date ranges, with overlapping ranges merged. */
export function monthsFromDateRanges(text: string, now = new Date()): number {
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const ranges: Array<[number, number]> = [];
  for (const m of text.matchAll(RANGE_RE)) {
    const start = toMonthIndex(m, 1, now);
    const end = toMonthIndex(m, 6, now, m[11]);
    if (start === null || end === null) continue;
    const s = Math.max(start, 1970 * 12);
    const e = Math.min(end, nowIdx);
    if (e > s) ranges.push([s, e]);
    else if (e === s) ranges.push([s, s + 1]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const r of ranges) {
    if (!cur || r[0] > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [...r];
    } else cur[1] = Math.max(cur[1], r[1]);
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}

const YEARS_RE = /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+\w+){0,4}?\s+(?:experience|exp\b)/i;

/** Minimum years stated in a job description ("3+ years of experience", "2-4 years experience"). */
export function requiredYears(jd: string): number | null {
  const m = jd.match(YEARS_RE);
  return m ? Number(m[1]) : null;
}

/** Years stated explicitly by the candidate ("5 years of experience"). */
export function statedYears(resume: string): number | null {
  return requiredYears(resume);
}

export const DEGREE_LEVELS = ["", "Diploma", "Bachelor's", "Master's", "PhD"] as const;

const DEGREE_PATTERNS: Array<[number, RegExp]> = [
  [4, /\b(ph\.?\s?d|doctorate|doctoral)\b/i],
  [3, /\b(master'?s?|m\.?\s?tech|m\.?\s?e\.|m\.?\s?sc|m\.?\s?s\.|mba|mca|m\.?com|postgraduate|post-graduate)\b/i],
  [2, /\b(bachelor'?s?|b\.?\s?tech|b\.?\s?e\.|b\.?\s?sc|b\.?\s?s\.|b\.?\s?a\.|bca|bba|b\.?com|undergraduate|graduate\s+degree|engineering\s+degree)\b/i],
  [1, /\b(diploma|associate'?s?\s+degree)\b/i],
];

export function highestDegree(text: string): number {
  for (const [level, re] of DEGREE_PATTERNS) if (re.test(text)) return level;
  return 0;
}

/** Lowest degree level a JD asks for, e.g. "Bachelor's or Master's in CS" -> Bachelor's. */
export function requiredDegree(jd: string): number {
  const lines = jd.split(/\n|(?<=[.;])\s+/).filter((l) => /\b(degree|bachelor|master|ph\.?\s?d|b\.?\s?tech|b\.?e\.|m\.?\s?tech|diploma|graduate)\b/i.test(l));
  let min = 0;
  for (const line of lines) {
    const levels = DEGREE_PATTERNS.filter(([, re]) => re.test(line)).map(([lvl]) => lvl);
    if (levels.length) {
      const lvl = Math.min(...levels);
      min = min === 0 ? lvl : Math.min(min, lvl);
    }
  }
  return min;
}

export function guessJobTitle(jd: string): string {
  const explicit = jd.match(/^\s*(?:job\s+title|position|role|title|designation)\s*[:\-–]\s*(.{3,80})$/im);
  if (explicit) return explicit[1].trim();
  const first = jd.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (first.length <= 80 && first.split(/\s+/).length <= 10 && !/[.!?]$/.test(first)) return first;
  return "Target Role";
}
