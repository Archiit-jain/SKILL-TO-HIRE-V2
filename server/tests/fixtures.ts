// Synthetic sample documents for tests. Not real people.

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
