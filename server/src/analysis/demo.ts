import { analyze } from "./analyze.js";
import type { AnalysisResult } from "./types.js";

/**
 * Built-in sample for "Try Demo Analysis" and the homepage preview. Both documents are synthetic (fictional person,
 * fictional companies, example.com addresses). The result is computed by the real engine on every request; nothing in
 * it is hardcoded. The date is fixed so experience years, and therefore the score, are the same for every visitor.
 */
export const DEMO_RESUME = `Alex Rivera (synthetic sample)
alex.rivera@example.com | github.com/example

Summary
Final-year computer science student who builds data pipelines and analytics tools.

Skills
Python, SQL, PostgreSQL, Docker, Pandas, Apache Spark, GitHub, Communication

Experience
Data Engineering Intern, Example Retail Labs - Jan 2025 - Jun 2025
• Developed Python ETL jobs that load daily sales data into PostgreSQL
• Wrote SQL queries that power the weekly revenue dashboard
• Packaged the ETL jobs as Docker images for the team's test environment

Teaching Assistant, Example University - Aug 2025 - Present
• Explained database concepts to students in weekly lab sessions

Projects
Transit Delay Tracker
• Built a Python data pipeline with Pandas that cleans public transit data and publishes delay reports
• Scheduled the pipeline with cron on a Linux virtual machine

Education
B.Tech in Computer Science, Example Institute of Technology, expected 2026

Certifications
Coursera course: Cloud Computing Basics (AWS)
`;

export const DEMO_JD = `Job Title: Junior Data Engineer

Northwind Analytics (a fictional company) is hiring a Junior Data Engineer to build and run data pipelines on AWS.

Requirements:
• 1+ years of experience building data pipelines (internships count)
• Strong Python and SQL skills
• Hands-on experience with Apache Airflow
• Experience with Docker and Kubernetes
• Git for version control
• Bachelor's degree in Computer Science or a related field, or equivalent practical experience

Preferred:
• Experience with Apache Spark
• Familiarity with Terraform
• AWS certification is a plus
• Clear written communication

Benefits:
• Learning budget and mentoring from senior engineers
`;

/** Fixed analysis date for the sample (see above). */
export const DEMO_NOW = new Date("2026-03-01T00:00:00.000Z");

export function demoAnalysis(): AnalysisResult {
  return {
    ...analyze({
      resumeText: DEMO_RESUME,
      jdText: DEMO_JD,
      resumeName: "sample-resume.pdf",
      privacyMode: false,
      now: DEMO_NOW,
    }),
    // Stable id: the sample is never stored, and the id must not look like a saved analysis.
    id: "00000000-0000-4000-8000-000000000000",
    demo: true,
  };
}
