import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listSourceFiles } from "../helpers/listSourceFiles";

/**
 * NFR-003 spot check (design.md section 10, INC-1 QA note: "no persistence
 * layer exists anywhere"). This is a heuristic static scan, not exhaustive --
 * it looks for the telltale signs of a database/file-persistence layer
 * creeping into the backend (src/, api/) that would violate the stateless,
 * request-scoped architecture (design.md section 2).
 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bfs\.writeFile/,
  /\bfs\.appendFile/,
  /require\(["']mongodb["']\)/,
  /from ["']mongodb["']/,
  /from ["']mongoose["']/,
  /from ["']pg["']/,
  /from ["']redis["']/,
  /from ["']ioredis["']/,
  /from ["']@prisma\/client["']/,
  /from ["']better-sqlite3["']/,
  /from ["']sqlite3["']/,
  /localStorage\./, // acceptable in frontend UX convenience (sessionFlag.ts uses sessionStorage,
  // not localStorage), but should never appear in backend (src/config, src/auth, api/) code.
];

describe("NFR-003 spot check -- no persistence layer in the backend", () => {
  const backendRoots = [
    path.resolve(__dirname, "../../src/config"),
    path.resolve(__dirname, "../../src/auth"),
    path.resolve(__dirname, "../../api"),
  ];

  it("contains no database/file-persistence imports or calls in backend source", () => {
    const offenders: string[] = [];
    for (const root of backendRoots) {
      for (const file of listSourceFiles(root)) {
        const contents = readFileSync(file, "utf-8");
        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.test(contents)) {
            offenders.push(`${file} matches ${pattern}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the session mechanism is a pure function of (token, password) -- no session store lookup", () => {
    // Re-assert at the source level: session.ts must not import any storage client.
    const sessionSource = readFileSync(path.resolve(__dirname, "../../src/auth/session.ts"), "utf-8");
    expect(sessionSource).not.toMatch(/\bdb\./);
    expect(sessionSource).not.toMatch(/\bstore\./);
    expect(sessionSource).toContain("createHmac");
  });
});
