import { id } from "../utils.js";
import type { AgentHarness } from "../workflow/harness.js";
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
    event:any;
    harness:AgentHarness;
    runId?:string;
    changedFiles:string[];
    diagnostic:string;
    signal?:AbortSignal;
  }):void{
    const d=args.event.details as any;
    const testFailed=args.event.toolName==="run_test"&&d?.status==="failed";
    const commandFailed=args.event.toolName==="run_command"&&Boolean(d?.timedOut||d?.cancelled||d?.exitCode!==0);
    if(testFailed||commandFailed){
      this.schedule("failure_triage",buildFailureTriageState({
        harness:args.harness,toolName:args.event.toolName,input:args.event.input,details:d,
        diagnostic:args.diagnostic,changedFiles:args.changedFiles,
      }),args.runId,args.signal);
      if(args.harness.state.noProgress>=2){
        this.schedule("progress_judge",buildProgressJudgeState({
          harness:args.harness,diagnostic:args.diagnostic,changedFiles:args.changedFiles,
        }),args.runId,args.signal);
      }
    }
    if(args.event.toolName==="review"){
      this.schedule("review_risk",buildReviewRiskState(d),args.runId,args.signal);
    }
  }

  async flush():Promise<void>{
    await Promise.allSettled([...this.pending]);
  }
}
