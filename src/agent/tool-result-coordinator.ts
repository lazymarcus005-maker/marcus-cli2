import type { HarnessDecisionCoordinator } from "../decision/coordinator.js";
import type { WorkingSet } from "../context/working-set.js";
import type { AgentHarness } from "../workflow/harness.js";

export class ToolResultCoordinator {
  constructor(
    readonly decisions:HarnessDecisionCoordinator,
    readonly workingSet:WorkingSet,
    readonly getRunId:()=>string|undefined,
    readonly getSignal:()=>AbortSignal|undefined,
  ){}

  observe(event:any,harness:AgentHarness|undefined):void{
    if(!harness)return;
    const d=event.details as any;
    const failed=Boolean(event.isError)||(event.toolName==="run_command"&&Boolean(d?.timedOut||d?.cancelled||d?.exitCode!==0));
    const text=(event.content??[]).filter((x:any)=>x.type==="text").map((x:any)=>x.text).join("\n");
    const sourceVersion=this.workingSet.list().map(x=>x.path+":"+x.sourceHash).join("|")||"no-source";
    const diagnostic=event.toolName==="run_command"
      ?`run_command:${String(event.input?.command??"")}:exit=${String(d?.exitCode)}:timeout=${Boolean(d?.timedOut)}:cancelled=${Boolean(d?.cancelled)}`
      :event.toolName+":"+text;
    if(failed&&event.toolName!=="run_test")harness.onFailure(diagnostic,sourceVersion,false);
    else if(!failed&&(event.toolName==="write_file"||event.toolName==="task_transition"||(event.toolName==="run_test"&&d?.status==="passed")))harness.onProgress();
    this.decisions.observeToolResult({
      event,harness,runId:this.getRunId(),diagnostic,
      changedFiles:this.workingSet.list().filter(x=>x.status!=="STALE").map(x=>x.path).slice(0,50),
      signal:this.getSignal(),
    });
  }
}
