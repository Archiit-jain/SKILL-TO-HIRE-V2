/**
 * Curated skill dictionary. A skill is only recognised if one of its aliases appears as a whole token.
 * Ambiguous short names (R, Go, C) are only matched through unambiguous phrasings to avoid false positives.
 * An alias must mean the same skill: related but different technologies (Git and GitHub, Docker and Kubernetes,
 * SQL and PostgreSQL, OAuth and JWT) are separate skills, linked only through RELATED below, which never gives credit.
 * Extend this list freely - see docs/SCORING.md.
 */
export interface SkillDef {
  name: string;
  aliases: string[];
  category: SkillCategory;
}

export type SkillCategory =
  | "language"
  | "frontend"
  | "backend"
  | "database"
  | "cloud"
  | "devops"
  | "data"
  | "ai_ml"
  | "mobile"
  | "testing"
  | "tools"
  | "security"
  | "practice"
  | "soft";

const S = (name: string, category: SkillCategory, ...aliases: string[]): SkillDef => ({
  name,
  category,
  aliases: [name, ...aliases],
});

export const SKILLS: SkillDef[] = [
  // Languages
  S("Python", "language"),
  S("Java", "language"),
  S("JavaScript", "language", "JS", "ECMAScript", "ES6"),
  S("TypeScript", "language"),
  S("C++", "language", "cpp", "C/C++"),
  S("C", "language", "C programming", "C language", "ANSI C", "C/C++"),
  S("C#", "language", "csharp", "C sharp"),
  S("Go", "language", "Golang", "Go language", "Go programming"),
  S("Rust", "language"),
  S("Kotlin", "language"),
  S("Swift", "language"),
  S("PHP", "language"),
  S("Ruby", "language"),
  S("Scala", "language"),
  S("R", "language", "R programming", "R language", "RStudio", "tidyverse"),
  S("MATLAB", "language"),
  S("Bash", "language", "shell scripting", "shell script", "Bash scripting"),
  S("PowerShell", "language"),
  S("Dart", "language"),
  // Frontend
  S("HTML", "frontend", "HTML5"),
  S("CSS", "frontend", "CSS3"),
  S("React", "frontend", "React.js", "ReactJS"),
  S("Next.js", "frontend", "NextJS"),
  S("Angular", "frontend", "AngularJS"),
  S("Vue.js", "frontend", "Vue", "VueJS"),
  S("Svelte", "frontend"),
  S("Redux", "frontend"),
  S("Tailwind CSS", "frontend", "Tailwind", "TailwindCSS"),
  S("Bootstrap", "frontend"),
  // Backend
  S("Node.js", "backend", "NodeJS", "Node"),
  S("Express.js", "backend", "ExpressJS"),
  S("Django", "backend"),
  S("Flask", "backend"),
  S("FastAPI", "backend"),
  S("Spring Boot", "backend", "Spring Framework"),
  S(".NET", "backend", "dotnet", "ASP.NET", ".NET Core"),
  S("Laravel", "backend"),
  S("Ruby on Rails", "backend", "Rails"),
  S("REST APIs", "backend", "REST", "RESTful", "REST API", "RESTful APIs"),
  S("GraphQL", "backend"),
  S("gRPC", "backend"),
  S("Microservices", "backend", "microservice", "microservices architecture"),
  // Databases
  S("SQL", "database"),
  S("PostgreSQL", "database", "Postgres"),
  S("MySQL", "database"),
  S("SQLite", "database"),
  S("Oracle Database", "database", "Oracle DB", "PL/SQL"),
  S("SQL Server", "database", "MSSQL", "T-SQL"),
  S("MongoDB", "database", "Mongo"),
  S("Redis", "database"),
  S("Cassandra", "database"),
  S("DynamoDB", "database"),
  S("Elasticsearch", "database", "Elastic Search", "OpenSearch"),
  S("Firebase", "database", "Firestore"),
  // Cloud
  S("AWS", "cloud", "Amazon Web Services", "EC2", "S3", "AWS Lambda"),
  S("Azure", "cloud", "Microsoft Azure"),
  S("Google Cloud", "cloud", "GCP", "Google Cloud Platform", "BigQuery"),
  S("Serverless", "cloud"),
  // DevOps
  S("Docker", "devops", "Dockerfile", "Docker Compose"),
  S("Kubernetes", "devops", "K8s", "kubectl", "Helm", "EKS", "AKS", "GKE"),
  S("Terraform", "devops"),
  S("Ansible", "devops"),
  S("CI/CD", "devops", "continuous integration", "continuous delivery", "continuous deployment"),
  S("Jenkins", "devops"),
  S("GitHub Actions", "devops"),
  S("GitLab CI", "devops"),
  S("Linux", "devops", "Ubuntu", "Debian", "CentOS"),
  S("Unix", "devops"),
  S("Nginx", "devops"),
  S("Prometheus", "devops"),
  S("Grafana", "devops"),
  // Data
  S("Pandas", "data"),
  S("NumPy", "data"),
  S("Apache Spark", "data", "Spark", "PySpark"),
  S("Hadoop", "data"),
  S("Kafka", "data", "Apache Kafka"),
  S("Airflow", "data", "Apache Airflow"),
  S("ETL", "data", "ELT", "data pipeline", "data pipelines"),
  S("Data Warehousing", "data", "data warehouse", "Snowflake", "Redshift"),
  S("dbt", "data"),
  S("Tableau", "data"),
  S("Power BI", "data", "PowerBI"),
  S("Excel", "data", "Microsoft Excel"),
  S("Data Visualization", "data", "Matplotlib", "Seaborn", "Plotly"),
  S("Statistics", "data", "statistical analysis", "hypothesis testing"),
  S("Data Analysis", "data", "data analytics", "exploratory data analysis", "EDA"),
  // AI / ML
  S("Machine Learning", "ai_ml", "ML", "machine-learning"),
  S("Deep Learning", "ai_ml", "neural networks", "neural network"),
  S("Scikit-learn", "ai_ml", "sklearn", "scikit learn"),
  S("TensorFlow", "ai_ml", "Keras"),
  S("PyTorch", "ai_ml", "Torch"),
  S("Natural Language Processing", "ai_ml", "NLP", "spaCy", "NLTK"),
  S("Computer Vision", "ai_ml", "OpenCV", "image classification", "object detection"),
  S("Large Language Models", "ai_ml", "LLM", "LLMs", "GPT", "generative AI", "GenAI"),
  S("Hugging Face", "ai_ml", "HuggingFace", "Transformers"),
  S("LangChain", "ai_ml"),
  S("RAG", "ai_ml", "retrieval augmented generation", "retrieval-augmented generation"),
  S("MLOps", "ai_ml", "MLflow", "Kubeflow"),
  S("Feature Engineering", "ai_ml"),
  // Mobile
  S("Android", "mobile", "Android SDK"),
  S("iOS", "mobile"),
  S("React Native", "mobile"),
  S("Flutter", "mobile"),
  // Testing
  S("Unit Testing", "testing", "unit tests", "Jest", "JUnit", "pytest", "Mocha", "Vitest"),
  S("Test Automation", "testing", "Selenium", "Cypress", "Playwright"),
  // Tools
  S("Git", "tools"),
  S("GitHub", "tools"),
  S("GitLab", "tools"),
  S("Bitbucket", "tools"),
  S("Jira", "tools"),
  S("Figma", "tools"),
  S("Postman", "tools"),
  // Security
  S("Cybersecurity", "security", "information security", "network security"),
  S("OAuth", "security", "OAuth2", "OAuth 2.0", "OpenID Connect", "OIDC"),
  S("JWT", "security", "JSON Web Token", "JSON Web Tokens"),
  S("OWASP", "security"),
  // Practices
  S("Agile", "practice", "Scrum", "Kanban"),
  S("Data Structures", "practice", "data structures and algorithms", "DSA", "algorithms"),
  S("Object-Oriented Programming", "practice", "OOP", "object oriented", "object-oriented"),
  S("System Design", "practice", "distributed systems", "scalable systems"),
  // Soft skills (only counted when the JD asks for them)
  S("Communication", "soft", "communication skills", "verbal and written communication"),
  S("Teamwork", "soft", "collaboration", "team player", "cross-functional"),
  S("Problem Solving", "soft", "problem-solving", "analytical skills"),
  S("Leadership", "soft", "mentoring", "team lead"),
];

// Aliases only trusted with exact casing, because in lower case they are ordinary English words.
const CASE_SENSITIVE = new Set([
  "ML", "JS", "Node", "Rails", "Torch", "Lambda", "S3", "REST", "GPT", "Helm", "Spark", "Vue", "Mongo", "Unix",
  "Transformers", "Excel", "Swift", "Rust", "Dart", "Bootstrap", "Tableau", "RAG", "Jest", "Mocha", "Playwright",
  "Cypress", "Snowflake", "Jenkins", "Flutter", "Angular", "Tailwind", "Azure", "EDA", "Spring Boot",
]);

// Aliases so generic that they are never matched on their own. The canonical name is kept as a display label only.
const NEVER_MATCH_ALONE = new Set(["C", "R", "Go"]);

/**
 * Case-sensitive aliases that are still ordinary English words when capitalised ("Swift delivery", "Spark interest").
 * A line that matches a skill only through one of these, with no other recognised skill on the same line, is weak
 * evidence: the rating is kept but marked low confidence.
 */
const WORD_LIKE = new Set([
  "Swift", "Rust", "Dart", "Spark", "Excel", "Bootstrap", "Snowflake", "Jest", "Mocha", "Cypress", "Playwright",
  "Flutter", "Angular", "Azure", "Torch", "Transformers", "Helm", "Node", "Rails", "Vue", "Mongo", "Tableau", "Jenkins",
  "REST", "Unix",
]);

/**
 * Different-but-related skills. When a job description asks for the key skill and the resume only shows a related one,
 * the result says so, but the skill stays Missing: related experience is never counted as a match.
 */
export const RELATED: Record<string, Array<{ skill: string; note: string }>> = (() => {
  const map: Record<string, Array<{ skill: string; note: string }>> = {};
  const add = (key: string, skills: string[], note: string) => {
    map[key] = [...(map[key] ?? []), ...skills.map((skill) => ({ skill, note }))];
  };
  add("Git", ["GitHub", "GitLab", "Bitbucket"], "is a hosting platform for Git repositories; naming it doesn't show that you use Git itself");
  for (const host of ["GitHub", "GitLab", "Bitbucket"]) add(host, ["Git"], "is the version control tool; it doesn't show which hosting platform you use");
  add("Docker", ["Kubernetes"], "orchestrates containers, but isn't evidence of building or running Docker images");
  add("Kubernetes", ["Docker"], "builds and runs containers; orchestrating them with Kubernetes is a separate skill");
  add("JavaScript", ["TypeScript", "React", "Node.js", "Next.js", "Vue.js", "Angular"], "is built on JavaScript, but isn't the same as JavaScript experience");
  add("TypeScript", ["JavaScript"], "is related, but TypeScript adds a type system you'd need to show separately");
  add("React", ["Next.js", "React Native", "JavaScript"], "is related to React, but isn't React web development itself");
  const sqlDatabases = ["PostgreSQL", "MySQL", "SQLite", "SQL Server", "Oracle Database"];
  add("SQL", sqlDatabases, "is a database that uses SQL; say explicitly that you write SQL if you do");
  for (const db of sqlDatabases) add(db, ["SQL", ...sqlDatabases.filter((d) => d !== db)], "is related, but general SQL or another database doesn't show this specific database");
  add("C", ["C++"], "is a different language from C");
  add("C++", ["C", "C#"], "is a different language from C++");
  add("C#", ["C++", "Java"], "is a different language from C#");
  add("Java", ["Kotlin", "Scala"], "also runs on the JVM, but is a different language from Java");
  for (const [cloud, others] of [["AWS", ["Azure", "Google Cloud"]], ["Azure", ["AWS", "Google Cloud"]], ["Google Cloud", ["AWS", "Azure"]]] as const) {
    add(cloud, [...others], "is a different cloud provider");
  }
  add("Deep Learning", ["TensorFlow", "PyTorch"], "is a deep learning framework; describe the models you built to show deep learning");
  add("CI/CD", ["GitHub Actions", "Jenkins", "GitLab CI"], "is a CI/CD tool; describe the pipeline you set up to show CI/CD");
  for (const tool of ["GitHub Actions", "Jenkins", "GitLab CI"]) add(tool, ["CI/CD", ...["GitHub Actions", "Jenkins", "GitLab CI"].filter((t) => t !== tool)], "is related, but isn't this specific CI/CD tool");
  add("Terraform", ["Ansible"], "is a different infrastructure automation tool");
  add("Ansible", ["Terraform"], "is a different infrastructure automation tool");
  add("Linux", ["Unix"], "is a related operating system family, not Linux itself");
  add("Unix", ["Linux"], "is a Unix-like system, but not the same as Unix experience");
  add("OAuth", ["JWT"], "is a token format; it isn't the OAuth authorisation protocol");
  add("JWT", ["OAuth"], "is an authorisation protocol; it doesn't show JWT handling by itself");
  add("Apache Spark", ["Hadoop"], "is a different big-data framework");
  add("Hadoop", ["Apache Spark"], "is a different big-data framework");
  add("REST APIs", ["GraphQL", "gRPC"], "is a different API style");
  add("GraphQL", ["REST APIs"], "is a different API style");
  add("Express.js", ["Node.js"], "is the runtime; it doesn't show the Express framework");
  add("Node.js", ["Express.js"], "runs on Node.js, but the runtime itself should be named");
  add("Pandas", ["NumPy"], "is a related library, but not Pandas");
  add("NumPy", ["Pandas"], "is a related library, but not NumPy");
  add("Tableau", ["Power BI"], "is a different BI tool");
  add("Power BI", ["Tableau"], "is a different BI tool");
  add("Machine Learning", ["Data Analysis", "Statistics"], "is related groundwork, but isn't machine learning");
  return map;
})();

/** Skills that are usually learned first. Used to order the roadmap; never used for scoring. */
export const PREREQUISITES: Record<string, string[]> = {
  Kubernetes: ["Docker", "Linux"],
  Docker: ["Linux"],
  React: ["JavaScript", "HTML", "CSS"],
  "Next.js": ["React"],
  Redux: ["React"],
  "React Native": ["React"],
  "Vue.js": ["JavaScript"],
  Angular: ["TypeScript"],
  TypeScript: ["JavaScript"],
  "Node.js": ["JavaScript"],
  "Express.js": ["Node.js"],
  Django: ["Python"],
  Flask: ["Python"],
  FastAPI: ["Python"],
  Pandas: ["Python"],
  NumPy: ["Python"],
  "Scikit-learn": ["Python", "Machine Learning"],
  "Machine Learning": ["Python", "Statistics"],
  "Deep Learning": ["Machine Learning"],
  TensorFlow: ["Deep Learning"],
  PyTorch: ["Deep Learning"],
  "Natural Language Processing": ["Machine Learning"],
  "Computer Vision": ["Deep Learning"],
  LangChain: ["Python", "Large Language Models"],
  RAG: ["Large Language Models"],
  MLOps: ["Machine Learning", "Docker"],
  "Apache Spark": ["Python", "SQL"],
  Airflow: ["Python"],
  dbt: ["SQL"],
  "Data Warehousing": ["SQL"],
  PostgreSQL: ["SQL"],
  MySQL: ["SQL"],
  "SQL Server": ["SQL"],
  "Oracle Database": ["SQL"],
  "GitHub Actions": ["Git", "CI/CD"],
  "GitLab CI": ["Git", "CI/CD"],
  Jenkins: ["CI/CD"],
  "CI/CD": ["Git"],
  "Spring Boot": ["Java"],
  ".NET": ["C#"],
  Laravel: ["PHP"],
  "Ruby on Rails": ["Ruby"],
  Flutter: ["Dart"],
  Microservices: ["REST APIs", "Docker"],
  "System Design": ["Data Structures"],
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Token boundaries that understand C++, C#, .NET and Node.js
const BEFORE = "(?<![A-Za-z0-9+#])";
const AFTER = "(?![A-Za-z0-9+#]|\\.[A-Za-z])";

function buildPattern(aliases: string[], flags: string): RegExp | null {
  if (aliases.length === 0) return null;
  const body = aliases.map((a) => escapeRe(a).replace(/\s+/g, "[\\s-]+")).join("|");
  return new RegExp(`${BEFORE}(?:${body})${AFTER}`, flags);
}

export interface CompiledSkill extends SkillDef {
  patterns: RegExp[];
  /** Case-sensitive aliases that are also ordinary words (see WORD_LIKE). */
  wordLikePattern: RegExp | null;
}

export const COMPILED_SKILLS: CompiledSkill[] = SKILLS.map((def) => {
  const usable = def.aliases.filter((a) => !NEVER_MATCH_ALONE.has(a));
  const patterns = [
    buildPattern(usable.filter((a) => !CASE_SENSITIVE.has(a)), "gi"),
    buildPattern(usable.filter((a) => CASE_SENSITIVE.has(a) && !WORD_LIKE.has(a)), "g"),
  ].filter((p): p is RegExp => p !== null);
  return { ...def, patterns, wordLikePattern: buildPattern(usable.filter((a) => CASE_SENSITIVE.has(a) && WORD_LIKE.has(a)), "g") };
});

const test = (p: RegExp, text: string) => {
  p.lastIndex = 0;
  return p.test(text);
};

export function mentionsSkill(skill: CompiledSkill, text: string): boolean {
  return skill.patterns.some((p) => test(p, text)) || (!!skill.wordLikePattern && test(skill.wordLikePattern, text));
}

/**
 * True when `text` mentions the skill only through an alias that is also an ordinary word, and nothing else on the line
 * is a recognised skill - e.g. "Swift turnaround on support tickets". "Built iOS apps in Swift" is not ambiguous.
 */
export function isAmbiguousMention(skill: CompiledSkill, text: string): boolean {
  if (skill.patterns.some((p) => test(p, text))) return false;
  if (!skill.wordLikePattern || !test(skill.wordLikePattern, text)) return false;
  return !COMPILED_SKILLS.some((other) => other !== skill && other.patterns.some((p) => test(p, text)));
}

export function findSkills(text: string): Set<string> {
  const found = new Set<string>();
  for (const s of COMPILED_SKILLS) if (mentionsSkill(s, text)) found.add(s.name);
  return found;
}

export function getSkill(name: string): CompiledSkill {
  const s = COMPILED_SKILLS.find((k) => k.name === name);
  if (!s) throw new Error(`Unknown skill ${name}`);
  return s;
}

export function skillCategory(name: string): SkillCategory | undefined {
  return SKILLS.find((k) => k.name === name)?.category;
}

export const CATEGORY_LABEL: Record<SkillCategory, string> = {
  language: "Programming language",
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  cloud: "Cloud",
  devops: "DevOps",
  data: "Data",
  ai_ml: "AI / ML",
  mobile: "Mobile",
  testing: "Testing",
  tools: "Tools",
  security: "Security",
  practice: "Engineering practice",
  soft: "Soft skill",
};
