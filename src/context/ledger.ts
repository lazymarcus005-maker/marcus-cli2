import { StateStore } from "../storage/state.js";

export interface LedgerState {
  goal?:string;
  decisions:Array<{text:string;provenance?:string}>;
  workingFiles:Array<{path:string;hash:string}>;
  blockers:string[];
  nextAction?:string;
}

const MAX_DECISIONS=50;
const MAX_DECISION_CHARS=2000;
const MAX_PROVENANCE_CHARS=500;
const MAX_WORKING_FILES=200;
const MAX_BLOCKERS=50;
const MAX_TEXT_CHARS=4000;

function bounded(value:string|undefined,max:number):string|undefined{
  if(value===undefined)return undefined;
  return value.length<=max?value:value.slice(0,max)+"…";
}

export function normalizeLedgerState(state:LedgerState):LedgerState{
  const decisions=state.decisions.slice(-MAX_DECISIONS).map(d=>({
    text:bounded(String(d.text??""),MAX_DECISION_CHARS)??"",
    provenance:bounded(d.provenance===undefined?undefined:String(d.provenance),MAX_PROVENANCE_CHARS)
  })).filter(d=>d.text.length>0);
  const workingFiles=state.workingFiles.slice(-MAX_WORKING_FILES).map(x=>({path:String(x.path),hash:String(x.hash)}));
  const blockers=state.blockers.slice(-MAX_BLOCKERS).map(x=>bounded(String(x),MAX_TEXT_CHARS)??"");
  return {
    goal:bounded(state.goal,MAX_TEXT_CHARS),
    decisions,
    workingFiles,
    blockers,
    nextAction:bounded(state.nextAction,MAX_TEXT_CHARS)
  };
}

export class ContextLedger{
  constructor(readonly store:StateStore,readonly sessionId:string){}
  append(state:LedgerState){return this.store.appendLedger(this.sessionId,normalizeLedgerState(state));}
  latest():{revision:number;state:LedgerState}|undefined{
    const r=this.store.latestLedgerRevision(this.sessionId);
    return r?{revision:r.revision,state:normalizeLedgerState(r.payload)}:undefined;
  }
}
