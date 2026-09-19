import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import type { MacusConfig } from "./types.js";
import { exists } from "./utils.js";
import { COMPLETE_V1_FEATURE_DEFAULTS } from "./capabilities.js";

export const DEFAULT_CONFIG: MacusConfig = {
  schema_version: 1,
  models: { default: "primary", providers: {}, aliases: {} },
  context: {
    reserved_output_tokens: 8192,
    safety_margin_tokens: 2048,
    target_prompt_ratio: 0.55,
    compact_prompt_ratio: 0.72,
    emergency_prompt_ratio: 0.85,
    budget: {
      repo_map_tokens: 1200,
      search_results_tokens: 2500,
      tool_output_tokens: 5000,
      single_file_read_tokens: 8000,
    },
  },
  model_profiles: {},
  internal_models: {
    jev: {
      enabled: false,
      transport: "openrouter",
      model: "typesafe/jev-1.13",
      api_key_env: "OPENROUTER_API_KEY",
      timeout_ms: 1500,
      max_state_tokens: 8000,
      mode: "shadow",
      decisions: {
        failure_triage: true,
        progress_judge: true,
        review_risk: true,
        stage_router: false,
        context_rerank: false,
        compaction_filter: false,
      },
    },
  },
  run: { max_model_turns: 40, max_no_progress_attempts: 3, max_duration_seconds: 1800 },
  execution: {
    command_timeout_seconds: 120,
    test_build_timeout_seconds: 600,
    termination_grace_seconds: 2,
    max_output_memory_bytes: 8 * 1024 * 1024,
    max_log_bytes: 100 * 1024 * 1024,
    environment_allowlist: ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"],
  },
  retrieval: { search_max_results: 100, search_timeout_seconds: 10, max_parse_file_bytes: 1024 * 1024 },
  logs: { retention_days: 7, max_total_bytes: 1024 * 1024 * 1024 },
  features: { ...COMPLETE_V1_FEATURE_DEFAULTS },
};

type Json = Record<string, any>;

function merge<T extends Json>(base: T, overlay: Json): T {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object"
      ? merge(out[k], v)
      : v;
  }
  return out as T;
}

function rejectUnknown(obj: Json, allowed: string[], at: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new Error(`Unknown config field ${at}${key}`);
  }
}

function expandEnv(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
      const resolved = process.env[name];
      if (resolved === undefined) throw new Error(`Missing environment variable ${name}`);
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map(expandEnv);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, expandEnv(v)]));
  }
  return value;
}

async function readYaml(filePath: string): Promise<Json> {
  if (!(await exists(filePath))) return {};
  const parsed = YAML.parse(await readFile(filePath, "utf8"));
  if (parsed == null) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Config must be an object: ${filePath}`);
  return parsed;
}

function validateShape(raw: Json): void {
  rejectUnknown(raw,["schema_version","models","context","model_profiles","internal_models","run","execution","retrieval","logs","features"],"");
  if(raw.models){ rejectUnknown(raw.models,["default","providers","aliases"],"models.");
    for(const [n,p] of Object.entries(raw.models.providers??{})){ rejectUnknown(p as Json,["protocol","base_url","api_key_env","profile","model"],`models.providers.${n}.`); }
  }
  if(raw.context){ rejectUnknown(raw.context,["reserved_output_tokens","safety_margin_tokens","target_prompt_ratio","compact_prompt_ratio","emergency_prompt_ratio","budget"],"context.");
    if(raw.context.budget) rejectUnknown(raw.context.budget,["repo_map_tokens","search_results_tokens","tool_output_tokens","single_file_read_tokens"],"context.budget.");
  }
  for(const [n,p] of Object.entries(raw.model_profiles??{})){ rejectUnknown(p as Json,["context_window","max_output_tokens","max_input_tokens","tokenizer","context"],`model_profiles.${n}.`); if((p as any).context) rejectUnknown((p as any).context,["reserved_output_tokens","safety_margin_tokens"],`model_profiles.${n}.context.`); }

  if(raw.internal_models){
    rejectUnknown(raw.internal_models,["jev"],"internal_models.");
    if(raw.internal_models.jev){
      rejectUnknown(raw.internal_models.jev,["enabled","transport","model","api_key_env","base_url","timeout_ms","max_state_tokens","mode","decisions"],"internal_models.jev.");
      if(raw.internal_models.jev.decisions) rejectUnknown(raw.internal_models.jev.decisions,["failure_triage","progress_judge","review_risk","stage_router","context_rerank","compaction_filter"],"internal_models.jev.decisions.");
    }
  }
  if(raw.run) rejectUnknown(raw.run,["max_model_turns","max_no_progress_attempts","max_duration_seconds"],"run.");
  if(raw.execution) rejectUnknown(raw.execution,["command_timeout_seconds","test_build_timeout_seconds","termination_grace_seconds","max_output_memory_bytes","max_log_bytes","environment_allowlist"],"execution.");
  if(raw.retrieval) rejectUnknown(raw.retrieval,["search_max_results","search_timeout_seconds","max_parse_file_bytes"],"retrieval.");
  if(raw.logs) rejectUnknown(raw.logs,["retention_days","max_total_bytes"],"logs.");
  if(raw.features) rejectUnknown(raw.features,Object.keys(DEFAULT_CONFIG.features),"features.");
}

function validateProjectConfig(project: Json): void {
  const forbidden = ["model_profiles", "internal_models", "execution", "run", "logs"];
  for (const key of forbidden) if (key in project) throw new Error(`Project config cannot override ${key}`);
  if (project.models) {
    rejectUnknown(project.models, ["default"], "models.");
  }
  if (project.context) {
    rejectUnknown(project.context, ["budget"], "context.");
  }
  if (project.features) {
    const allowed = Object.keys(DEFAULT_CONFIG.features);
    rejectUnknown(project.features, allowed, "features.");
    if(project.features.jev_harness===true) throw new Error("Project config cannot enable features.jev_harness; external decision routing is global/user authority only");
  }
}

export function validateConfig(config: MacusConfig): MacusConfig {
  if (config.schema_version !== 1) throw new Error("Unsupported schema_version");
  const legacy = ["reserve_output", "target_context_ratio", "target_utilization"];
  for (const key of legacy) if (key in (config.context as any)) throw new Error(`Legacy context field ${key}; migrate to v1.1 schema`);
  const c = config.context;
  if (!(c.reserved_output_tokens > 0) || !(c.safety_margin_tokens >= 0)) throw new Error("Invalid context reservation");
  if (!(0 < c.target_prompt_ratio && c.target_prompt_ratio < c.compact_prompt_ratio && c.compact_prompt_ratio < c.emergency_prompt_ratio && c.emergency_prompt_ratio < 1)) {
    throw new Error("Require 0 < target < compact < emergency < 1");
  }
  for (const [k, v] of Object.entries(c.budget)) if (!(v >= 0)) throw new Error(`Invalid context budget ${k}`);
  for (const [name, value] of Object.entries(config.features)) {
    if (typeof value !== "boolean") throw new Error(`Invalid feature flag ${name}`);
  }
  if (config.features.semantic_search) throw new Error("semantic_search is unsupported in V1");
  if (config.features.telemetry) throw new Error("telemetry is unsupported in V1");
  const jev=config.internal_models.jev;
  if(typeof jev.enabled!=="boolean") throw new Error("Invalid internal_models.jev.enabled");
  if(!["openrouter","typesafe"].includes(jev.transport)) throw new Error("Invalid internal_models.jev.transport");
  if(!jev.model) throw new Error("internal_models.jev.model is required");
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(jev.api_key_env)) throw new Error("Invalid internal_models.jev.api_key_env");
  if(!Number.isFinite(jev.timeout_ms)||jev.timeout_ms<100||jev.timeout_ms>5000) throw new Error("internal_models.jev.timeout_ms must be between 100 and 5000");
  if(!Number.isFinite(jev.max_state_tokens)||jev.max_state_tokens<=0||jev.max_state_tokens>16000) throw new Error("internal_models.jev.max_state_tokens must be between 1 and 16000");
  if(jev.mode!=="shadow") throw new Error("Only internal_models.jev.mode=shadow is supported before Jev calibration/promotion");
  for(const [name,value] of Object.entries(jev.decisions)) if(typeof value!=="boolean") throw new Error(`Invalid internal_models.jev.decisions.${name}`);
  if(jev.base_url){ let url:URL; try{url=new URL(jev.base_url);}catch{throw new Error("Invalid internal_models.jev.base_url");} if(!["http:","https:"].includes(url.protocol)||url.username||url.password) throw new Error("Invalid internal_models.jev.base_url"); }
  if(config.features.jev_harness&&!jev.enabled) throw new Error("features.jev_harness requires internal_models.jev.enabled=true");
  if(config.features.jev_harness && jev.enabled && !process.env[jev.api_key_env]) throw new Error(`Missing environment variable ${jev.api_key_env}`);
  for (const [name, value] of Object.entries(config.run)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid run limit ${name}`);
  }
  const positiveExecution = [
    "command_timeout_seconds", "test_build_timeout_seconds", "termination_grace_seconds",
    "max_output_memory_bytes", "max_log_bytes",
  ] as const;
  for (const name of positiveExecution) {
    const value = config.execution[name];
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid execution limit ${name}`);
  }
  if (!Array.isArray(config.execution.environment_allowlist) || config.execution.environment_allowlist.some(x => typeof x !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(x))) {
    throw new Error("Invalid execution.environment_allowlist");
  }
  if (!Number.isFinite(config.retrieval.search_max_results) || config.retrieval.search_max_results <= 0) throw new Error("Invalid retrieval.search_max_results");
  if (!Number.isFinite(config.retrieval.search_timeout_seconds) || config.retrieval.search_timeout_seconds <= 0) throw new Error("Invalid retrieval.search_timeout_seconds");
  if (!Number.isFinite(config.retrieval.max_parse_file_bytes) || config.retrieval.max_parse_file_bytes <= 0) throw new Error("Invalid retrieval.max_parse_file_bytes");
  if (!Number.isFinite(config.logs.retention_days) || config.logs.retention_days <= 0) throw new Error("Invalid logs.retention_days");
  if (!Number.isFinite(config.logs.max_total_bytes) || config.logs.max_total_bytes <= 0) throw new Error("Invalid logs.max_total_bytes");
  for (const [name, p] of Object.entries(config.model_profiles)) {
    if (!(p.context_window > 0 && p.max_output_tokens > 0)) throw new Error(`Invalid model profile ${name}`);
    if (p.max_output_tokens > p.context_window) throw new Error(`Profile ${name}: output exceeds context window`);
    if (p.max_input_tokens !== undefined && (!(p.max_input_tokens > 0) || p.max_input_tokens > p.context_window)) throw new Error(`Invalid max_input_tokens for profile ${name}`);
    if (p.context?.reserved_output_tokens !== undefined && p.context.reserved_output_tokens <= 0) throw new Error(`Invalid reserved_output_tokens for profile ${name}`);
    if (p.context?.safety_margin_tokens !== undefined && p.context.safety_margin_tokens < 0) throw new Error(`Invalid safety_margin_tokens for profile ${name}`);
  }
  const alias = config.models.default;
  if (Object.keys(config.models.aliases).length && !(alias in config.models.aliases)) throw new Error(`Unknown model alias ${alias}`);
  for (const [aliasName, providerName] of Object.entries(config.models.aliases)) {
    if (!(providerName in config.models.providers)) throw new Error(`Alias ${aliasName} references unknown provider ${providerName}`);
  }
  for (const [name, provider] of Object.entries(config.models.providers)) {
    if (!["openai-compatible","openrouter","litellm"].includes(provider.protocol)) throw new Error(`Unsupported provider protocol ${provider.protocol}`);
    let url: URL; try { url=new URL(provider.base_url); } catch { throw new Error(`Invalid provider base_url for ${name}`); }
    if (!['http:','https:'].includes(url.protocol)) throw new Error(`Unsupported provider URL protocol for ${name}`);
    if (url.username || url.password) throw new Error(`Provider URL must not embed credentials for ${name}`);
    if (!(provider.profile in config.model_profiles)) throw new Error(`Provider ${name} references unknown profile ${provider.profile}`);
    if (!provider.model) throw new Error(`Provider ${name} model is required`);
    if (provider.api_key_env && !process.env[provider.api_key_env]) throw new Error(`Missing environment variable ${provider.api_key_env}`);
  }
  return config;
}

export async function loadConfig(root: string, explicitPath?: string): Promise<{ config: MacusConfig; sources: Record<string, string> }> {
  const globalPath = explicitPath ?? process.env.MACUS_CONFIG ?? path.join(os.homedir(), ".macus", "config.yaml");
  const projectPath = path.join(root, ".macus", "config.yaml");
  const globalRaw = expandEnv(await readYaml(globalPath)) as Json;
  const projectRaw = await readYaml(projectPath);
  validateShape(globalRaw); validateShape(projectRaw); validateProjectConfig(projectRaw);
  const globalMerged=merge(DEFAULT_CONFIG,globalRaw);
  for(const [k,v] of Object.entries(projectRaw.context?.budget??{})){ const ceiling=(globalMerged.context.budget as any)[k]; if(typeof v==="number" && v>ceiling) throw new Error(`Project context budget ${k} exceeds user/global ceiling ${ceiling}`); }
  const config = validateConfig(merge(globalMerged, projectRaw));
  return { config, sources: { global: globalPath, project: projectPath } };
}

export function redactConfig(config: MacusConfig): Json {
  const copy = structuredClone(config) as any;
  for (const p of Object.values(copy.models.providers) as any[]) {
    if (p.api_key_env) p.api_key_env = `<env:${p.api_key_env}>`;
  }
  if(copy.internal_models?.jev?.api_key_env) copy.internal_models.jev.api_key_env=`<env:${copy.internal_models.jev.api_key_env}>`;
  return copy;
}
