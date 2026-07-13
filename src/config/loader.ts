import type { AppConfig, AppMode, GeoPoint, MapRoutingProvider, TransitModesIncluded } from "./schema.js";

export type Env = Record<string, string | undefined>;

/**
 * Thrown by loadConfig when one or more required environment variables are
 * missing or malformed. `problems` lists every violation found (not just the
 * first), so an operator can fix everything in one pass.
 */
export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

const SUPPORTED_MAP_ROUTING_PROVIDERS: MapRoutingProvider[] = ["google_maps_platform"];

function readRaw(env: Env, key: string, problems: string[]): string {
  const value = env[key];
  if (value === undefined || value.trim() === "") {
    problems.push(`${key} is required but was not set.`);
    return "";
  }
  return value;
}

function parsePositiveNumber(env: Env, key: string, problems: string[], integerOnly: boolean): number {
  const raw = readRaw(env, key, problems);
  if (raw === "") return NaN;
  const parsed = Number(raw);
  const valid = Number.isFinite(parsed) && parsed > 0 && (!integerOnly || Number.isInteger(parsed));
  if (!valid) {
    const kind = integerOnly ? "a positive integer" : "a positive number";
    problems.push(`${key} must be ${kind} (got "${raw}").`);
    return NaN;
  }
  return parsed;
}

function parseAppMode(env: Env, problems: string[]): AppMode {
  const raw = readRaw(env, "APP_MODE", problems);
  if (raw !== "" && raw !== "free_tier" && raw !== "paid_tier") {
    problems.push(`APP_MODE must be "free_tier" or "paid_tier" (got "${raw}").`);
  }
  return raw === "paid_tier" ? "paid_tier" : "free_tier";
}

function parseMapRoutingProvider(env: Env, problems: string[]): MapRoutingProvider {
  const raw = readRaw(env, "MAP_ROUTING_PROVIDER", problems);
  if (raw !== "" && !SUPPORTED_MAP_ROUTING_PROVIDERS.includes(raw as MapRoutingProvider)) {
    problems.push(
      `MAP_ROUTING_PROVIDER must be one of: ${SUPPORTED_MAP_ROUTING_PROVIDERS.join(", ")} (got "${raw}").`,
    );
  }
  return "google_maps_platform";
}

function parseGeographicCenter(env: Env, problems: string[]): GeoPoint {
  const fallback: GeoPoint = { lat: 0, lng: 0, label: "" };
  const raw = readRaw(env, "GEOGRAPHIC_CENTER", problems);
  if (raw === "") return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    problems.push(
      'GEOGRAPHIC_CENTER must be valid JSON, e.g. {"lat":43.6532,"lng":-79.3832,"label":"Toronto, ON"}.',
    );
    return fallback;
  }

  const candidate = parsed as Partial<GeoPoint>;
  const isValid =
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.lat === "number" &&
    typeof candidate.lng === "number" &&
    typeof candidate.label === "string" &&
    candidate.label.trim() !== "";

  if (!isValid) {
    problems.push(
      "GEOGRAPHIC_CENTER JSON must have numeric lat/lng and a non-empty string label.",
    );
    return fallback;
  }

  return { lat: candidate.lat as number, lng: candidate.lng as number, label: candidate.label as string };
}

function parseTransitModesIncluded(env: Env, problems: string[]): TransitModesIncluded {
  const raw = readRaw(env, "TRANSIT_MODES_INCLUDED", problems);
  if (raw === "") return "all";
  if (raw.trim().toLowerCase() === "all") return "all";

  const modes = raw
    .split(",")
    .map((mode) => mode.trim())
    .filter((mode) => mode !== "");

  if (modes.length === 0) {
    problems.push('TRANSIT_MODES_INCLUDED must be "all" or a comma-separated list of modes (e.g. "bus,subway").');
  }
  return modes;
}

function parsePaidTierAccessPassword(env: Env, appMode: AppMode, problems: string[]): string | null {
  const raw = env.PAID_TIER_ACCESS_PASSWORD;
  const password = raw && raw.trim() !== "" ? raw : null;
  if (appMode === "paid_tier" && !password) {
    problems.push("PAID_TIER_ACCESS_PASSWORD is required when APP_MODE=paid_tier but was not set.");
  }
  return password;
}

/**
 * Deliberately optional (`null` when unset), unlike this file's other ~20
 * keys -- see schema.ts's doc comment on `googleMapsJsApiKey` for why. No
 * `problems.push` here on either branch; an unset value is a valid,
 * supported "map view disabled" configuration, not a misconfiguration.
 */
function parseOptionalString(env: Env, key: string): string | null {
  const raw = env[key];
  return raw && raw.trim() !== "" ? raw : null;
}

/**
 * Loads and validates the full application configuration from environment
 * variables. Fails fast (throws ConfigError) if any required variable is
 * missing or malformed, including the design.md section 10 / INC-1
 * requirement that APP_MODE=paid_tier without PAID_TIER_ACCESS_PASSWORD is
 * a hard configuration error, not a silent fallback.
 *
 * Pure function of `env` -- no hidden globals -- so it can be unit tested
 * with an arbitrary env object rather than mutating process.env.
 */
export function loadConfig(env: Env = process.env): AppConfig {
  const problems: string[] = [];

  const mapRoutingProvider = parseMapRoutingProvider(env, problems);
  const mapApiKey = readRaw(env, "MAP_API_KEY", problems);
  const geographicCenter = parseGeographicCenter(env, problems);
  const geographicRadiusKm = parsePositiveNumber(env, "GEOGRAPHIC_RADIUS_KM", problems, false);
  const maxCandidatesReturned = parsePositiveNumber(env, "MAX_CANDIDATES_RETURNED", problems, true);
  const appMode = parseAppMode(env, problems);
  const responseTimeTargetSeconds = parsePositiveNumber(env, "RESPONSE_TIME_TARGET_SECONDS", problems, false);
  const transitModesIncluded = parseTransitModesIncluded(env, problems);
  const candidateSpacingMeters = parsePositiveNumber(env, "CANDIDATE_SPACING_METERS", problems, true);
  const maxRawCandidatesSampled = parsePositiveNumber(env, "MAX_RAW_CANDIDATES_SAMPLED", problems, true);
  const maxTransitEvaluationsPerRequest = parsePositiveNumber(
    env,
    "MAX_TRANSIT_EVALUATIONS_PER_REQUEST",
    problems,
    true,
  );
  const distanceMatrixBatchSize = parsePositiveNumber(env, "DISTANCE_MATRIX_BATCH_SIZE", problems, true);
  const requestTimeoutMs = parsePositiveNumber(env, "REQUEST_TIMEOUT_MS", problems, true);
  const providerConcurrencyLimit = parsePositiveNumber(env, "PROVIDER_CONCURRENCY_LIMIT", problems, true);
  const minGeocodeQueryLength = parsePositiveNumber(env, "MIN_GEOCODE_QUERY_LENGTH", problems, true);
  const geocodeDebounceMs = parsePositiveNumber(env, "GEOCODE_DEBOUNCE_MS", problems, true);
  const sessionLifetimeSeconds = parsePositiveNumber(env, "SESSION_LIFETIME_SECONDS", problems, true);
  const paidTierAccessPassword = parsePaidTierAccessPassword(env, appMode, problems);
  const googleMapsJsApiKey = parseOptionalString(env, "GOOGLE_MAPS_JS_API_KEY");

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return {
    mapRoutingProvider,
    mapApiKey,
    geographicCenter,
    geographicRadiusKm,
    maxCandidatesReturned,
    appMode,
    paidTierAccessPassword,
    responseTimeTargetSeconds,
    transitModesIncluded,
    candidateSpacingMeters,
    maxRawCandidatesSampled,
    maxTransitEvaluationsPerRequest,
    distanceMatrixBatchSize,
    requestTimeoutMs,
    providerConcurrencyLimit,
    minGeocodeQueryLength,
    geocodeDebounceMs,
    sessionLifetimeSeconds,
    googleMapsJsApiKey,
  };
}
