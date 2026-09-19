import type { HarnessDecisionCoordinator } from "../decision/coordinator.js";
import type { WorkingSet } from "../context/working-set.js";
import type { AgentHarness } from "../workflow/harness.js";
import { normalizeToolOutcome, outcomeFailed } from "./tool-outcome.js";

export class ToolResultCoordinator {
  constructor(
    readonly decisions:HarnessDecisionCoordinator,
    readonly workingSet:WorkingSet,
    readonly getRunId:()=>string|undefined,
    readonly getSignal:()=>AbortSignal|undefined,
  ){}

  observe(event:unknown,harness:AgentHarness|undefined):void{
    if(!harness)return;
    const outcome=normalizeToolOutcome(event);
    const failed=outcomeFailed(outcome);
    const sourceVersion=this.workingSet.list().map(x=>x.path+":"+x.sourceHash).join("|")||"no-source";
    const command=outcome.kind==="test"||outcome.kind==="command"?String(outcome.input.command??""):"";
    const details=outcome.kind==="test"?outcome.evidence:outcome.kind==="command"?outcome.result:{};
    const evidenceStatus=outcome.kind==="test"?outcome.evidence.status:outcome.kind==="command"?outcome.evidence?.status:undefined;
    const diagnostic=(outcome.kind==="test"||outcome.kind==="command")
      ?`${outcome.toolName}:${command}:exit=${String(details.exitCode)}:timeout=${Boolean(details.timedOut)}:cancelled=${Boolean(details.cancelled)}:status=${String(evidenceStatus??details.status??"")}`
      :outcome.toolName+":"+outcome.text;

    if(!failed){
      if(outcome.kind==="discovery")harness.advance("discover");
      else if(outcome.kind==="task"&&outcome.toolName==="task_create")harness.advance("plan");
      else if(outcome.kind==="write")harness.advance("implement");
      else if(outcome.kind==="test")harness.advance("review");
      else if(outcome.kind==="command"&&outcome.evidence?.status==="passed")harness.advance("review");
      else if(outcome.kind==="review")harness.advance("review");
    }
    if(failed){
      harness.onFailure(diagnostic,sourceVersion,false);
      if(harness.state.stage!=="blocked")harness.advance("fix");
    }else if(outcome.kind==="write"||(outcome.kind==="task"&&outcome.toolName==="task_transition")||outcome.kind==="test"||(outcome.kind==="command"&&outcome.evidence?.status==="passed")){
      harness.onProgress();
    }
    this.decisions.observeToolResult({
      outcome,harness,runId:this.getRunId(),diagnostic,
      changedFiles:this.workingSet.list().filter(x=>x.status!=="STALE").map(x=>x.path).slice(0,50),
      signal:this.getSignal(),
    });
  }
}
