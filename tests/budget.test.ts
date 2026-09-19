import { describe,it,expect } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { validateRequestBudget, singleCategory } from "../src/context/budget.js";

describe("request budget",()=>{
  const profile={context_window:1000,max_output_tokens:200,tokenizer:"conservative-byte-estimate"};
  it("accepts bounded request",()=>{
    const payload={x:"abc"};
    const m=validateRequestBudget({payload,categories:singleCategory(payload),profile,context:{...DEFAULT_CONFIG.context,reserved_output_tokens:100,safety_margin_tokens:100},sessionId:"s",modelId:"m"});
    expect(m.estimatedPromptTokens).toBeGreaterThan(0);
  });
  it("blocks oversized request",()=>{
    const payload="x".repeat(900);
    expect(()=>validateRequestBudget({payload,categories:singleCategory(payload),profile,context:{...DEFAULT_CONFIG.context,reserved_output_tokens:100,safety_margin_tokens:100},sessionId:"s",modelId:"m"})).toThrow(/exceeds/);
  });
});
