export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "skipped";
export type ExecutionStatus = "prepared" | "started" | "completed" | "failed" | "cancelled" | "unknown";
export type Freshness = "verified" | "stale" | "unknown";
export type Resolution = "confirmed" | "candidate" | "unresolved";

export interface FeatureFlags {
  repo_map: boolean;
  code_graph: boolean;
  context_ledger: boolean;
  checkpoint: boolean;
  auto_compaction: boolean;
  git_context: boolean;
  task_engine: boolean;
  prompt_cache_optimization: boolean;
  semantic_search: boolean;
  telemetry: boolean;
  jev_harness: boolean;
}

export interface JevInternalModelConfig {
  enabled: boolean;
  transport: "openrouter" | "typesafe";
  model: string;
  api_key_env: string;
  base_url?: string;
  timeout_ms: number;
  max_state_tokens: number;
  mode: "shadow" | "advisory" | "limited-routing";
  decisions: {
    failure_triage: boolean;
    progress_judge: boolean;
    review_risk: boolean;
    stage_router: boolean;
    context_rerank: boolean;
    compaction_filter: boolean;
  };
}

export interface ContextBudget {
  repo_map_tokens: number;
  search_results_tokens: number;
  tool_output_tokens: number;
  single_file_read_tokens: number;
}

export interface ContextConfig {
  reserved_output_tokens: number;
  safety_margin_tokens: number;
  target_prompt_ratio: number;
  compact_prompt_ratio: number;
  emergency_prompt_ratio: number;
  budget: ContextBudget;
}

export interface ModelProfile {
  context_window: number;
  max_output_tokens: number;
  max_input_tokens?: number;
  tokenizer: string;
  context?: Partial<Pick<ContextConfig, "reserved_output_tokens" | "safety_margin_tokens">>;
}

export interface ProviderConfig {
  protocol: "openai-compatible" | "openrouter" | "litellm";
  base_url: string;
  api_key_env?: string;
  profile: string;
  model: string;
}

export interface MacusConfig {
  schema_version: 1;
  models: {
    default: string;
    providers: Record<string, ProviderConfig>;
    aliases: Record<string, string>;
  };
  context: ContextConfig;
  model_profiles: Record<string, ModelProfile>;
  internal_models: {
    jev: JevInternalModelConfig;
  };
  run: {
    max_model_turns: number;
    max_no_progress_attempts: number;
    max_duration_seconds: number;
  };
  execution: {
    command_timeout_seconds: number;
    test_build_timeout_seconds: number;
    termination_grace_seconds: number;
    max_output_memory_bytes: number;
    max_log_bytes: number;
    environment_allowlist: string[];
  };
  retrieval: {
    search_max_results: number;
    search_timeout_seconds: number;
    max_parse_file_bytes: number;
  };
  logs: {
    retention_days: number;
    max_total_bytes: number;
  };
  features: FeatureFlags;
}

export interface SourceFragment {
  fragmentId: string;
  source: string;
  symbolId?: string;
  startLine: number;
  endLine: number;
  reason: string;
  tier: "HOT" | "WARM" | "COLD";
  score: number;
  contentHash: string;
  indexGeneration: number;
  freshness: Freshness;
  estimatedTokens: number;
  content: string;
}

export interface RequestManifest {
  requestId: string;
  sessionId: string;
  modelId: string;
  createdAt: string;
  instructionHashes: string[];
  includedFragments: Array<Pick<SourceFragment, "fragmentId" | "source" | "contentHash" | "freshness" | "estimatedTokens">>;
  omissions: Array<{ fragmentId: string; reason: string }>;
  categories: Record<string, number>;
  estimatedPromptTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  contextWindow: number;
  estimationMethod: string;
  providerReportedInputTokens?: number;
  piVersion: string;
  adapterVersion: string;
}

export interface TaskRecord {
  sessionId: string;
  id: string;
  title: string;
  status: TaskStatus;
  relatedFiles: string[];
  relatedSymbols: string[];
  notes?: string;
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionRecord {
  executionId: string;
  sessionId: string;
  runId?: string;
  toolCallId?: string;
  command?: string;
  cwd?: string;
  status: ExecutionStatus;
  effectClass: string;
  preparedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  cancelled?: boolean;
  outputComplete?: boolean;
  truncated?: boolean;
  logRef?: string;
  beforeHash?: string;
  afterHash?: string;
}
