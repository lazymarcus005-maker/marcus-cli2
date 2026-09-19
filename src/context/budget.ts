import type { ContextConfig, ModelProfile, RequestManifest } from "../types.js";
import { id, nowIso } from "../utils.js";

export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.byteLength(text, "utf8");
}

export function categorizeProviderPayload(payload: any): Record<string, number> {
  const total=estimateTokens(payload);
  const tools=payload?.tools ? estimateTokens(payload.tools) : 0;
  const messages=Array.isArray(payload?.messages)?payload.messages:[];
  let system=0, toolOutput=0;
  for(const m of messages){
    if(m?.role==="system") system+=estimateTokens(m);
    else if(m?.role==="tool") toolOutput+=estimateTokens(m);
  }
  const used=Math.min(total,tools+system+toolOutput);
  return {
    system,
    tool_schemas:tools,
    repository_instructions:0,
    task_ledger:0,
    working_source:0,
    repo_map:0,
    search_results:0,
    other_tool_output:toolOutput,
    remaining_conversation:total-used
  };
}

export function usablePromptCapacity(profile: ModelProfile, context: ContextConfig): number {
  const reserved = profile.context?.reserved_output_tokens ?? context.reserved_output_tokens;
  const margin = profile.context?.safety_margin_tokens ?? context.safety_margin_tokens;
  const window = profile.max_input_tokens ? Math.min(profile.context_window, profile.max_input_tokens + reserved) : profile.context_window;
  const p = window - reserved - margin;
  if (p <= 0) throw new Error("No usable prompt capacity");
  if (reserved > profile.max_output_tokens) throw new Error("reserved_output_tokens exceeds model output limit");
  return p;
}

export function validateRequestBudget(args: {
  payload: unknown; categories: Record<string,number>; profile: ModelProfile; context: ContextConfig;
  sessionId: string; modelId: string; instructionHashes?: string[]; piVersion?: string; adapterVersion?: string;
}): RequestManifest {
  const estimated = estimateTokens(args.payload);
  const p = usablePromptCapacity(args.profile, args.context);
  const reserved = args.profile.context?.reserved_output_tokens ?? args.context.reserved_output_tokens;
  const margin = args.profile.context?.safety_margin_tokens ?? args.context.safety_margin_tokens;
  const sum = Object.values(args.categories).reduce((a,b)=>a+b,0);
  if (sum !== estimated) throw new Error("Category total "+sum+" does not equal request estimate "+estimated);
  if (estimated > p) throw new Error("Request exceeds prompt capacity: "+estimated+" > "+p);
  return {
    requestId: id("request"), sessionId: args.sessionId, modelId: args.modelId, createdAt: nowIso(),
    instructionHashes: args.instructionHashes ?? [], includedFragments: [], omissions: [], categories: args.categories,
    estimatedPromptTokens: estimated, reservedOutputTokens: reserved, safetyMarginTokens: margin,
    contextWindow: args.profile.context_window, estimationMethod: "conservative-byte-estimate",
    piVersion: args.piVersion ?? "0.85.1", adapterVersion: args.adapterVersion ?? "0.1.0",
  };
}

export function singleCategory(payload:unknown, category="remaining_conversation"): Record<string,number> {
  return { [category]: estimateTokens(payload) };
}
