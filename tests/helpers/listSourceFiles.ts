import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Recursively lists .ts/.tsx source files under a directory (no node_modules traversal needed here). */
export function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (/\.tsx?$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}
