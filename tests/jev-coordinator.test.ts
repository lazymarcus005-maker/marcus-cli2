import { describe,it,expect } from "vitest";
import { AgentHarness } from "../src/workflow/harness.js";
import { HarnessDecisionCoordinator } from "../src/decision/coordinator.js";
import { normalizeToolOutcome } from "../src/agent/tool-outcome.js";

describe("Jev harness shadow coordinator",()=>{
  it("observes failure/progress/review without changing deterministic harness state",async()=>{
    const calls:any[]=[];
    const engine:any={sessionId:"s",evaluate:async(req:any,ctx:any)=>{calls.push({req,ctx});return null;}};
    const coordinator=new HarnessDecisionCoordinator(engine,()=>true);
    const harness=new AgentHarness({max_model_turns:40,max_no_progress_attempts:5,max_duration_seconds:1800});
    harness.onFailure("same failure","v1",false);
    coordinator.observeToolResult({outcome:normalizeToolOutcome({toolName:"run_test",input:{command:"npm test"},details:{status:"failed",exitCode:1}}),harness,runId:"r",changedFiles:["a.ts"],diagnostic:"failed"});
    harness.onFailure("same failure","v1",false);
    coordinator.observeToolResult({outcome:normalizeToolOutcome({toolName:"run_test",input:{command:"npm test"},details:{status:"failed",exitCode:1}}),harness,runId:"r",changedFiles:["a.ts"],diagnostic:"failed"});
    coordinator.observeToolResult({outcome:normalizeToolOutcome({toolName:"review",details:{Changed:{},Tested:[],TaskEvidence:[],RemainingRisk:["risk"],UnresolvedIssue:[]}}),harness,runId:"r",changedFiles:[],diagnostic:"review"});
    await coordinator.flush();
    expect(calls.map(x=>x.req.kind)).toEqual(["failure_triage","failure_triage","progress_judge","review_risk"]);
    expect(harness.state.noProgress).toBe(2);
    expect(harness.state.stage).toBe("inspect");
  });
});
