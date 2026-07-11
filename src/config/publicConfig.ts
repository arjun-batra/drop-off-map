import type { AppConfig, PublicConfig } from "./schema";

/**
 * Strips secrets (mapApiKey, paidTierAccessPassword) from AppConfig,
 * producing exactly the shape design.md section 5.2 specifies for
 * `GET /api/config/public`.
 */
export function toPublicConfig(config: AppConfig): PublicConfig {
  return {
    appMode: config.appMode,
    geographicCenter: config.geographicCenter,
    geographicRadiusKm: config.geographicRadiusKm,
    maxCandidatesReturned: config.maxCandidatesReturned,
    transitModesIncluded: config.transitModesIncluded,
  };
}
