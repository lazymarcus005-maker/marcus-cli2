import { it,expect } from "vitest";
import { JevHttpDecisionProvider } from "../src/decision/providers/jev-http.js";

const live=process.env.MACUS_JEV_LIVE_TEST==="1"&&Boolean(process.env.OPENROUTER_API_KEY);

it.skipIf(!live)("calls live OpenRouter Jev Decisions API with a minimal non-repository state",async()=>{
  const provider=new JevHttpDecisionProvider({
    enabled:true,transport:"openrouter",model:process.env.MACUS_JEV_MODEL??"typesafe/jev-1.13",
    api_key_env:"OPENROUTER_API_KEY",timeout_ms:5000,max_state_tokens:1000,mode:"shadow",
    decisions:{failure_triage:true,progress_judge:true,review_risk:true,stage_router:false,context_rerank:false,compaction_filter:false},
  });
  const result=await provider.decide(
    {event:"live-connectivity-check",repositoryContentIncluded:false},
    {healthy:{type:"noul",instructions:"Is this state explicitly a harmless connectivity check with no repository content?"}},
  );
  expect(result.model).toBeTruthy();
  expect(result.answers.healthy.type).toBe("noul");
});
