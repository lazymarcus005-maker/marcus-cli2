import type { FeatureFlags, MacusConfig } from "./types.js";

export const COMPLETE_V1_FEATURE_DEFAULTS: FeatureFlags = {
  repo_map: true,
  code_graph: false,
  context_ledger: true,
  checkpoint: true,
  auto_compaction: true,
  git_context: true,
  task_engine: true,
  prompt_cache_optimization: true,
  semantic_search: false,
  telemetry: false,
  jev_harness: false,
};

export type FeatureName = keyof FeatureFlags;

export function featureEnabled(config: MacusConfig, feature: FeatureName): boolean {
  return config.features[feature] === true;
}

export function featureUnavailable(feature: FeatureName): { available: false; feature: FeatureName; reason: string } {
  return { available: false, feature, reason: `${feature} disabled by configuration` };
}
