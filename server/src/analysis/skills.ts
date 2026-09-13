/**
 * Curated skill dictionary. A skill is only recognised if one of its aliases appears as a whole token.
 * Ambiguous short names (R, Go, C) are only matched through unambiguous phrasings to avoid false positives.
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
  S("AWS", "cloud", "Amazon Web Services", "EC2", "S3", "Lambda", "AWS Lambda"),
  S("Azure", "cloud", "Microsoft Azure"),
  S("Google Cloud", "cloud", "GCP", "Google Cloud Platform", "BigQuery"),
  S("Serverless", "cloud"),
  // DevOps
  S("Docker", "devops", "containerization", "containerized", "Dockerfile"),
  S("Kubernetes", "devops", "K8s", "kubectl", "Helm", "EKS", "AKS", "GKE"),
  S("Terraform", "devops"),
  S("Ansible", "devops"),
  S("CI/CD", "devops", "continuous integration", "continuous delivery", "continuous deployment"),
  S("Jenkins", "devops"),
  S("GitHub Actions", "devops"),
  S("GitLab CI", "devops"),
  S("Linux", "devops", "Unix", "Ubuntu"),
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
  S("Git", "tools", "GitHub", "GitLab", "Bitbucket", "version control"),
  S("Jira", "tools"),
  S("Figma", "tools"),
  S("Postman", "tools"),
  // Security
  S("Cybersecurity", "security", "information security", "network security"),
  S("OAuth", "security", "OAuth2", "OpenID Connect", "JWT"),
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
}

export const COMPILED_SKILLS: CompiledSkill[] = SKILLS.map((def) => {
  const usable = def.aliases.filter((a) => !NEVER_MATCH_ALONE.has(a));
  const patterns = [
    buildPattern(usable.filter((a) => !CASE_SENSITIVE.has(a)), "gi"),
    buildPattern(usable.filter((a) => CASE_SENSITIVE.has(a)), "g"),
  ].filter((p): p is RegExp => p !== null);
  return { ...def, patterns };
});

export function mentionsSkill(skill: CompiledSkill, text: string): boolean {
  return skill.patterns.some((p) => {
    p.lastIndex = 0;
    return p.test(text);
  });
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
