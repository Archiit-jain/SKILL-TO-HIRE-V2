// Architecture/security test (P1): every prepared SQL statement that reads, changes or deletes rows of an owned table
// must be scoped to the owner, because V2's isolation is application-level ownership in the queries (SQLite has no
// row-level security). The SQL is taken from the real `.prepare(...)` call sites via the TypeScript compiler API.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import ts from "typescript";
import { SERVER_ROOT } from "../src/config.js";

/** Owned tables and the column that identifies the owner. */
const OWNER_COLUMN: Record<string, string> = {
  analyses: "user_id",
  sessions: "user_id",
  assistant_usage: "user_id",
  email_verifications: "user_id",
  guest_analyses: "guest_id",
  guest_free_use: "guest_id",
};

/** Statements that intentionally don't filter by owner, with the reason. Matched on whitespace-normalised SQL. */
const ALLOWED_UNSCOPED: Record<string, string> = {
  "DELETE FROM sessions WHERE expires_at <= ?": "D-7 cleanup of expired sessions of all users",
  "DELETE FROM assistant_usage WHERE day < ?": "D-9 cleanup of previous UTC days' counters",
  "DELETE FROM guest_analyses WHERE created_at < ?": "D-6 30-day retention",
  "DELETE FROM guest_free_use WHERE used_at < ?": "D-6 365-day retention",
  "SELECT user_id, expires_at FROM email_verifications WHERE token_hash = ?": "the secret verification token is the lookup key",
};

const normalise = (sql: string) => sql.replace(/\s+/g, " ").trim();

/** Returns a problem description for one SQL statement, or null when it follows the ownership rule. */
export function ownershipProblem(rawSql: string): string | null {
  const sql = normalise(rawSql);
  if (ALLOWED_UNSCOPED[sql]) return null;
  const tables = [...sql.matchAll(/\b(?:FROM|UPDATE|INTO|JOIN)\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase()).filter((t) => t in OWNER_COLUMN);
  for (const table of new Set(tables)) {
    const owner = OWNER_COLUMN[table];
    if (/^\s*INSERT\b/i.test(sql)) {
      const columns = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+\w+\s*\(([^)]*)\)/i)?.[1] ?? "";
      if (!new RegExp(`\\b${owner}\\b`).test(columns)) return `INSERT into ${table} must set ${owner}`;
      continue;
    }
    const where = sql.match(/\bWHERE\b(.*)$/i)?.[1];
    if (!where) return `${table} query has no WHERE clause scoped to ${owner}`;
    if (!new RegExp(`\\b${owner}\\s*=\\s*\\?`).test(where)) return `${table} query must filter by ${owner} = ?`;
    if (/\bOR\b/i.test(where)) return `${table} query must not use OR next to the ${owner} filter`;
  }
  return null;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []
  );
}

interface Statement {
  file: string;
  line: number;
  sql: string | null; // null = the argument isn't a literal string
}

function preparedStatements(): Statement[] {
  const out: Statement[] = [];
  for (const file of sourceFiles(path.join(SERVER_ROOT, "src"))) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "prepare") {
        const arg = node.arguments[0];
        const sql = arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) ? arg.text : null;
        out.push({ file: path.relative(SERVER_ROOT, file), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, sql });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return out;
}

describe("ownership of owned-table queries", () => {
  const statements = preparedStatements();

  it("finds the application's prepared statements", () => {
    assert.ok(statements.length > 40, `found ${statements.length}`);
    assert.ok(statements.some((s) => s.sql?.includes("FROM analyses WHERE id = ? AND user_id = ?")));
  });

  it("uses only literal SQL (no dynamically built statements that could drop the owner filter)", () => {
    const dynamic = statements.filter((s) => s.sql === null).map((s) => `${s.file}:${s.line}`);
    assert.deepEqual(dynamic, []);
  });

  it("scopes every read, update and delete of an owned table to its owner", () => {
    const problems = statements
      .filter((s) => s.sql !== null)
      .map((s) => ({ at: `${s.file}:${s.line}`, problem: ownershipProblem(s.sql!) }))
      .filter((p) => p.problem);
    assert.deepEqual(problems, []);
  });

  it("every allow-listed unscoped statement still exists (the list can't go stale)", () => {
    const present = new Set(statements.map((s) => s.sql && normalise(s.sql)));
    for (const sql of Object.keys(ALLOWED_UNSCOPED)) assert.ok(present.has(sql), sql);
  });

  it("the rule catches IDOR-shaped queries", () => {
    assert.match(ownershipProblem("SELECT result_json FROM analyses WHERE id = ?")!, /user_id/);
    assert.match(ownershipProblem("DELETE FROM analyses WHERE id = ?")!, /user_id/);
    assert.match(ownershipProblem("SELECT * FROM sessions")!, /no WHERE/);
    assert.match(ownershipProblem("SELECT 1 FROM sessions WHERE id = ? OR user_id = ?")!, /OR/);
    assert.match(ownershipProblem("SELECT result_json FROM guest_analyses WHERE id = ?")!, /guest_id/);
    assert.match(ownershipProblem("INSERT INTO analyses (id, result_json) VALUES (?, ?)")!, /must set user_id/);
    assert.equal(ownershipProblem("SELECT result_json FROM analyses WHERE id = ? AND user_id = ?"), null);
  });
});
