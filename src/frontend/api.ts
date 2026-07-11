import type { PublicConfig } from "../config/schema";
import type { GeoResult } from "../geocoding/types";

export interface VerifyPasswordResult {
  ok: boolean;
  errorCode?: "invalid_password" | "not_applicable" | "config_error" | "network_error";
}

export type GeocodeErrorCode = "provider_error" | "unauthorized" | "network_error";

export interface GeocodeResult {
  ok: boolean;
  results: GeoResult[];
  errorCode?: GeocodeErrorCode;
}

async function callGeocodeEndpoint(params: Record<string, string>): Promise<GeocodeResult> {
  try {
    const search = new URLSearchParams(params).toString();
    const res = await fetch(`/api/geocode?${search}`, {
      credentials: "same-origin",
    });

    if (res.status === 401) {
      return { ok: false, results: [], errorCode: "unauthorized" };
    }
    if (!res.ok) {
      return { ok: false, results: [], errorCode: "provider_error" };
    }

    const body = (await res.json()) as { results: GeoResult[] };
    return { ok: true, results: body.results };
  } catch {
    return { ok: false, results: [], errorCode: "network_error" };
  }
}

/** GET /api/geocode?query=... -- forward geocode / address autocomplete (FR-003, FR-015). */
export function geocodeQuery(query: string): Promise<GeocodeResult> {
  return callGeocodeEndpoint({ query });
}

/** GET /api/geocode?lat=&lng= -- reverse geocode for "use my current location" (FR-015). */
export function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult> {
  return callGeocodeEndpoint({ lat: String(lat), lng: String(lng) });
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
