import { describe,it,expect } from "vitest";
import { ToolResultCoordinator } from "../src/agent/tool-result-coordinator.js";
import { WorkingSet } from "../src/context/working-set.js";
import { AgentHarness } from "../src/workflow/harness.js";
import type { HarnessDecisionCoordinator } from "../src/decision/coordinator.js";

describe("tool outcome orchestration",()=>{
  it("treats unknown verification from a trusted run_command as a failure",()=>{
    const decisions:any[]=[];
    const decisionPort={observeToolResult:(args:unknown)=>decisions.push(args)} as unknown as HarnessDecisionCoordinator;
    const coordinator=new ToolResultCoordinator(decisionPort,new WorkingSet(),()=>"run_1",()=>undefined);
    const harness=new AgentHarness({max_model_turns:10,max_no_progress_attempts:3,max_duration_seconds:60});

    coordinator.observe({toolName:"run_command",input:{command:"npm test"},details:{command:{exitCode:0,timedOut:false,cancelled:false},evidence:{status:"unknown",exitCode:0}}},harness);

    expect(harness.state.noProgress).toBe(1);
    expect(harness.state.stage).toBe("fix");
    expect(decisions[0]?.outcome.kind).toBe("command");
    expect(decisions[0]?.outcome.evidence.status).toBe("unknown");
  });

  it("advances a successful trusted test command to review",()=>{
    const decisionPort={observeToolResult:()=>{}} as unknown as HarnessDecisionCoordinator;
    const coordinator=new ToolResultCoordinator(decisionPort,new WorkingSet(),()=>undefined,()=>undefined);
    const harness=new AgentHarness({max_model_turns:10,max_no_progress_attempts:3,max_duration_seconds:60});

    coordinator.observe({toolName:"run_command",input:{command:"npm test"},details:{command:{exitCode:0,timedOut:false,cancelled:false},evidence:{status:"passed",exitCode:0}}},harness);

    expect(harness.state.stage).toBe("review");
    expect(harness.state.noProgress).toBe(0);
  });
});
