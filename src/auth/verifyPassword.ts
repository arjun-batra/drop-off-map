import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time password comparison (design.md section 5.2: "Password
 * compared with constant-time comparison"). Both inputs are hashed to a
 * fixed-length digest first so the comparison itself never leaks the
 * submitted or configured password's length via early-exit timing.
 */
export function verifyPassword(submitted: string, configuredPassword: string | null): boolean {
  if (!configuredPassword || !submitted) return false;
  const submittedDigest = createHash("sha256").update(submitted).digest();
  const configuredDigest = createHash("sha256").update(configuredPassword).digest();
  return timingSafeEqual(submittedDigest, configuredDigest);
}
