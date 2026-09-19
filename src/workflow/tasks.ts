import type { TaskRecord, TaskStatus } from "../types.js";
import { StateStore } from "../storage/state.js";
import { nowIso } from "../utils.js";

const allowed:Record<TaskStatus,TaskStatus[]> = {
  pending:["in_progress","blocked","skipped"],
  in_progress:["completed","blocked","pending"],
  completed:[],
  blocked:["pending","in_progress","skipped"],
  skipped:["pending"]
};

export class TaskEngine {
  constructor(readonly store:StateStore, readonly sessionId:string){}
  create(id:string,title:string):TaskRecord{
    const now=nowIso();
    const t:TaskRecord={sessionId:this.sessionId,id,title,status:"pending",relatedFiles:[],relatedSymbols:[],evidenceIds:[],createdAt:now,updatedAt:now};
    this.store.upsertTask(t); return t;
  }
  transition(id:string,status:TaskStatus,patch:Partial<TaskRecord>={}):TaskRecord{
    const current=this.store.listTasks(this.sessionId).find(t=>t.id===id);
    if(!current) throw new Error(`Unknown task ${id}`);
    if(!allowed[current.status].includes(status)) throw new Error(`Invalid task transition ${current.status} -> ${status}`);
    const next={...current,...patch,status,updatedAt:nowIso()};
    this.store.upsertTask(next); return next;
  }
  attachEvidence(evidenceId:string):TaskRecord|undefined{
    const current=this.store.listTasks(this.sessionId).find(t=>t.status==="in_progress");
    if(!current) return undefined;
    if(current.evidenceIds.includes(evidenceId)) return current;
    const next={...current,evidenceIds:[...current.evidenceIds,evidenceId],updatedAt:nowIso()};
    this.store.upsertTask(next);
    return next;
  }
  list(){ return this.store.listTasks(this.sessionId); }
}
