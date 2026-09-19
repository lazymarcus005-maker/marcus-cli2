import { it,expect } from "vitest";
import { JevHttpDecisionProvider } from "../src/decision/providers/jev-http.js";

const transport=process.env.MACUS_JEV_TRANSPORT==="typesafe"?"typesafe":"openrouter";
const apiKeyEnv=transport==="typesafe"?"TYPESAFE_API_KEY":"OPENROUTER_API_KEY";
const live=process.env.MACUS_JEV_LIVE_TEST==="1"&&Boolean(process.env[apiKeyEnv]);

it.skipIf(!live)(`calls live ${transport} Jev Decisions API with a minimal non-repository state`,async()=>{
  const provider=new JevHttpDecisionProvider({
    enabled:true,transport,model:process.env.MACUS_JEV_MODEL??(transport==="typesafe"?"jev-latest":"typesafe/jev-1.13"),
    api_key_env:apiKeyEnv,timeout_ms:5000,max_state_tokens:1000,mode:"shadow",
    decisions:{failure_triage:true,progress_judge:true,review_risk:true,stage_router:false,context_rerank:false,compaction_filter:false},
  });
  const result=await provider.decide(
    {event:"live-connectivity-check",repositoryContentIncluded:false},
    {healthy:{type:"noul",instructions:"Is this state explicitly a harmless connectivity check with no repository content?"}},
    AbortSignal.timeout(5000),
  );
  expect(result.model).toBeTruthy();
  expect(result.answers.healthy.type).toBe("noul");
});
