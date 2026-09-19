import { createHash } from "node:crypto";

export type Stage="inspect"|"discover"|"plan"|"implement"|"test"|"fix"|"review"|"complete"|"blocked"|"cancelled";
export interface HarnessState { stage:Stage; modelTurns:number; startedAt:number; noProgress:number; lastFailure?:string; }

export class AgentHarness {
  state:HarnessState={stage:"inspect",modelTurns:0,startedAt:Date.now(),noProgress:0};
  constructor(readonly limits:{max_model_turns:number;max_no_progress_attempts:number;max_duration_seconds:number}){}
  onTurn(){
    this.state.modelTurns++;
    this.check();
  }
  onFailure(diagnostic:string,sourceVersion:string,changed:boolean){
    const fp=createHash("sha256").update(diagnostic.replace(/\d+/g,"#")+"|"+sourceVersion).digest("hex");
    if(!changed&&fp===this.state.lastFailure) this.state.noProgress++; else this.state.noProgress=1;
    this.state.lastFailure=fp;
    this.check();
  }
  onProgress(){
    this.state.noProgress=0;
    this.state.lastFailure=undefined;
  }
  block(){ this.state.stage="blocked"; }
  advance(next:Stage){
    if(this.state.stage==="blocked"||this.state.stage==="cancelled") return;
    this.state.stage=next;
    this.check();
  }
  cancel(){ this.state.stage="cancelled"; }
  check(){
    if(this.state.modelTurns>this.limits.max_model_turns) this.state.stage="blocked";
    if(this.state.noProgress>=this.limits.max_no_progress_attempts) this.state.stage="blocked";
    if(Date.now()-this.state.startedAt>=this.limits.max_duration_seconds*1000) this.state.stage="blocked";
  }
  assertRunnable(){
    this.check();
    if(this.state.stage==="blocked") throw new Error("Macus run limit reached; inspect blockers and explicitly continue with a new run.");
    if(this.state.stage==="cancelled") throw new Error("Macus run was cancelled.");
  }
}
