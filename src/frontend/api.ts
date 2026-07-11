import type { PublicConfig } from "../config/schema";

export interface VerifyPasswordResult {
  ok: boolean;
  errorCode?: "invalid_password" | "not_applicable" | "config_error" | "network_error";
}

/** Thin fetch wrapper around GET /api/config/public (design.md section 5.2). */
export async function fetchPublicConfig(): Promise<PublicConfig> {
  const res = await fetch("/api/config/public");
  if (!res.ok) {
    throw new Error(`/api/config/public returned ${res.status}`);
  }
  return (await res.json()) as PublicConfig;
}

/** Thin fetch wrapper around POST /api/auth/verify-password (design.md section 5.2). */
export async function verifyPassword(password: string): Promise<VerifyPasswordResult> {
  try {
    const res = await fetch("/api/auth/verify-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ password }),
    });

    if (res.ok) return { ok: true };

    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const errorCode =
      body.error === "invalid_password" || body.error === "not_applicable" || body.error === "config_error"
        ? body.error
        : "network_error";
    return { ok: false, errorCode };
  } catch {
    return { ok: false, errorCode: "network_error" };
  }
}
