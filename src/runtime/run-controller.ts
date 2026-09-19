import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { StateStore } from "../storage/state.js";
import type { MacusConfig } from "../types.js";
import { AgentHarness } from "../workflow/harness.js";

export type RunStatus="completed"|"blocked"|"cancelled"|"failed";

export class RunController {
  harness:AgentHarness|undefined;
  runId:string|undefined;
  abortController:AbortController|undefined;
  blockedReason:string|undefined;
  private deadline:NodeJS.Timeout|undefined;

  constructor(
    readonly config:MacusConfig,
    readonly store:StateStore,
    readonly sessionId:string,
  ){}

  begin(session:AgentSession):{runId:string;harness:AgentHarness}{
    if(this.runId)throw new Error("A Macus run is already active");
    this.harness=new AgentHarness(this.config.run);
    this.runId=this.store.createRun(this.sessionId);
    this.abortController=new AbortController();
    this.blockedReason=undefined;
    const runId=this.runId;
    this.deadline=setTimeout(()=>{
      if(this.runId!==runId)return;
      this.harness?.block();
      this.blockedReason=`Macus run duration exceeded ${this.config.run.max_duration_seconds} seconds`;
      this.abortController?.abort();
      void Promise.resolve(session.abort()).catch(()=>{});
    },this.config.run.max_duration_seconds*1000);
    return {runId,harness:this.harness};
  }

  classifyFailure(error:unknown):{failure:unknown;status:RunStatus}{
    const failure=this.blockedReason?new Error(this.blockedReason):error;
    const state=this.harness?.state.stage;
    const status:RunStatus=state==="blocked"?"blocked":state==="cancelled"?"cancelled":"failed";
    return {failure,status};
  }

  assertComplete():void{
    if(this.blockedReason)throw new Error(this.blockedReason);
    if(!this.harness)throw new Error("Macus run harness unavailable");
    this.harness.assertRunnable();
    this.harness.advance("complete");
  }

  finish(status:RunStatus):void{
    const runId=this.runId;
    try{if(runId)this.store.finishRun(runId,status);}
    finally{
      if(this.deadline)clearTimeout(this.deadline);
      this.deadline=undefined;
      this.runId=undefined;
      this.abortController=undefined;
    }
  }

  async abort(session:AgentSession):Promise<void>{
    this.harness?.cancel();
    this.abortController?.abort();
    await session.abort();
  }

  dispose():void{
    if(this.deadline)clearTimeout(this.deadline);
    this.abortController?.abort();
    this.deadline=undefined;
    this.runId=undefined;
    this.abortController=undefined;
  }
}
