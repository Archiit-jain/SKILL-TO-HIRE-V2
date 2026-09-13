const STOPWORDS = new Set(
  (
    "a about above after again against all also am an and any are as at be because been before being below between both but by " +
    "can could did do does doing down during each etc few for from further had has have having he her here hers him his how i if " +
    "in into is it its itself just me more most my no nor not now of off on once only or other our ours out over own per same she " +
    "should so some such than that the their theirs them then there these they this those through to too under until up us very " +
    "via was we were what when where which while who whom why will with within without would you your yours " +
    "role job candidate candidates position team work working company looking ability strong good excellent year years plus"
  ).split(/\s+/)
);

/** Very light suffix stripping so "pipelines"/"pipeline" and "deployed"/"deploying" line up. */
function stem(t: string): string {
  if (/[^a-z]/.test(t)) return t;
  if (t.length > 5 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[a-z0-9]/g) ?? [])
    .filter((t) => !STOPWORDS.has(t) && !/^\d+$/.test(t))
    .map(stem);
}

type Vector = Map<string, number>;

/** Smoothed TF-IDF over a small corpus (resume + JD fragments), L2-normalised. */
export function tfidfVectors(docs: string[]): Vector[] {
  const tokenized = docs.map(tokenize);
  const df = new Map<string, number>();
  for (const tokens of tokenized) for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  return tokenized.map((tokens) => {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vec: Vector = new Map();
    let norm = 0;
    for (const [t, count] of tf) {
      const w = (1 + Math.log(count)) * (Math.log((1 + n) / (1 + (df.get(t) ?? 0))) + 1);
      vec.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of vec) vec.set(t, w / norm);
    return vec;
  });
}

export function cosine(a: Vector, b: Vector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) dot += w * (large.get(t) ?? 0);
  return Math.max(0, Math.min(1, dot));
}

export function similarity(a: string, b: string, corpus: string[] = []): number {
  const vectors = tfidfVectors([a, b, ...corpus]);
  return cosine(vectors[0], vectors[1]);
}
