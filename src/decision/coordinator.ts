import { id } from "../utils.js";
import type { AgentHarness } from "../workflow/harness.js";
import type { ToolOutcome } from "../agent/tool-outcome.js";
import { JevDecisionEngine } from "./engine.js";
import { questionsFor } from "./questions.js";
import { buildFailureTriageState,buildProgressJudgeState,buildReviewRiskState } from "./state-builder.js";
import type { DecisionKind } from "./types.js";

export class HarnessDecisionCoordinator {
  private readonly pending=new Set<Promise<void>>();
  constructor(
    readonly engine:JevDecisionEngine|undefined,
    readonly enabled:(kind:DecisionKind)=>boolean,
  ){}

  private schedule(kind:DecisionKind,state:unknown,runId:string|undefined,signal?:AbortSignal):void{
    if(!this.engine||!this.enabled(kind)) return;
    const work=this.engine.evaluate(
      {kind,schemaVersion:1,state,questions:questionsFor(kind)},
      {sessionId:this.engine.sessionId,runId,eventId:id("decision_event"),signal},
    ).then(()=>{}).catch(()=>{});
    this.pending.add(work);
    void work.finally(()=>this.pending.delete(work));
  }

  observeToolResult(args:{
    outcome:ToolOutcome;
    harness:AgentHarness;
    runId?:string;
    changedFiles:string[];
    diagnostic:string;
    signal?:AbortSignal;
  }):void{
    const outcome=args.outcome;
    const testFailed=outcome.kind==="test"&&outcome.evidence.status!=="passed";
    const commandFailed=outcome.kind==="command"&&Boolean(
      outcome.result.timedOut||outcome.result.cancelled||outcome.result.exitCode!==0||outcome.evidence&&outcome.evidence.status!=="passed"
    );
    if(testFailed||commandFailed){
      this.schedule("failure_triage",buildFailureTriageState({
        harness:args.harness,outcome:outcome as Extract<ToolOutcome,{kind:"test"|"command"}>,
        diagnostic:args.diagnostic,changedFiles:args.changedFiles,
      }),args.runId,args.signal);
      if(args.harness.state.noProgress>=2){
        this.schedule("progress_judge",buildProgressJudgeState({
          harness:args.harness,diagnostic:args.diagnostic,changedFiles:args.changedFiles,
        }),args.runId,args.signal);
      }
    }
    if(outcome.kind==="review"){
      this.schedule("review_risk",buildReviewRiskState(outcome.review),args.runId,args.signal);
    }
  }

  async flush():Promise<void>{
    await Promise.allSettled([...this.pending]);
  }
}
