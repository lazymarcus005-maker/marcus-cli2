import path from "node:path";
import { open, rename, readFile, readdir, unlink, stat } from "node:fs/promises";
import { StateStore } from "./state.js";
import { ensureDir, fileHash, id, nowIso } from "../utils.js";
import type { TaskRecord, TaskStatus } from "../types.js";
import { PathPolicy } from "../path-policy.js";
import { ContextLedger, normalizeLedgerState } from "../context/ledger.js";

export interface CheckpointPayload {
  schemaVersion:1;
  sessionId:string;
  repoIdentity:string;
  root:string;
  transcriptRef?:string;
  stateRevision:number;
  goal?:string;
  tasks:TaskRecord[];
  decisions:Array<{text:string;provenance?:string}>;
  changedFiles:Array<{path:string;hash:string}>;
  evidence:unknown[];
  nextAction?:string;
  unknownExecutions:unknown[];
}

export interface CheckpointListItem {
  id:string;
  stateRevision:number;
  committed:boolean;
  createdAt:string;
  filePath:string;
}

const TASK_STATUSES=new Set<TaskStatus>(["pending","in_progress","completed","blocked","skipped"]);

function isStringArray(value:unknown):value is string[]{
  return Array.isArray(value)&&value.every(x=>typeof x==="string");
}

function validateTask(value:any,sessionId:string):TaskRecord{
  if(!value||typeof value!=="object") throw new Error("Invalid checkpoint task");
  if(value.sessionId!==sessionId) throw new Error("Checkpoint task/session mismatch");
  if(typeof value.id!=="string"||!value.id||typeof value.title!=="string") throw new Error("Invalid checkpoint task identity");
  if(!TASK_STATUSES.has(value.status)) throw new Error(`Invalid checkpoint task status ${String(value.status)}`);
  if(!isStringArray(value.relatedFiles)||!isStringArray(value.relatedSymbols)||!isStringArray(value.evidenceIds)) throw new Error("Invalid checkpoint task arrays");
  if(value.notes!==undefined&&typeof value.notes!=="string") throw new Error("Invalid checkpoint task notes");
  if(typeof value.createdAt!=="string"||typeof value.updatedAt!=="string") throw new Error("Invalid checkpoint task timestamps");
  return {
    sessionId:value.sessionId,id:value.id,title:value.title,status:value.status,
    relatedFiles:value.relatedFiles,relatedSymbols:value.relatedSymbols,notes:value.notes,
    evidenceIds:value.evidenceIds,createdAt:value.createdAt,updatedAt:value.updatedAt
  };
}

export function validateCheckpointPayload(raw:any):CheckpointPayload{
  if(!raw||typeof raw!=="object") throw new Error("Invalid checkpoint payload");
  if(raw.schemaVersion!==1) throw new Error(`Unsupported checkpoint schema ${String(raw.schemaVersion)}`);
  for(const name of ["sessionId","repoIdentity","root"]){
    if(typeof raw[name]!=="string"||!raw[name]) throw new Error(`Invalid checkpoint ${name}`);
  }
  if(raw.transcriptRef!==undefined&&typeof raw.transcriptRef!=="string") throw new Error("Invalid checkpoint transcriptRef");
  if(!Number.isInteger(raw.stateRevision)||raw.stateRevision<0) throw new Error("Invalid checkpoint stateRevision");
  if(raw.goal!==undefined&&typeof raw.goal!=="string") throw new Error("Invalid checkpoint goal");
  if(raw.nextAction!==undefined&&typeof raw.nextAction!=="string") throw new Error("Invalid checkpoint nextAction");
  if(!Array.isArray(raw.tasks)||!Array.isArray(raw.decisions)||!Array.isArray(raw.changedFiles)||!Array.isArray(raw.evidence)||!Array.isArray(raw.unknownExecutions)){
    throw new Error("Invalid checkpoint collection fields");
  }

  const tasks=raw.tasks.map((x:any)=>validateTask(x,raw.sessionId));
  if(tasks.filter((x:TaskRecord)=>x.status==="in_progress").length>1) throw new Error("Checkpoint contains multiple in_progress tasks");
  const decisions=raw.decisions.map((d:any)=>{
    if(!d||typeof d!=="object"||typeof d.text!=="string") throw new Error("Invalid checkpoint decision");
    if(d.provenance!==undefined&&typeof d.provenance!=="string") throw new Error("Invalid checkpoint decision provenance");
    return {text:d.text,provenance:d.provenance};
  });
  const changedFiles=raw.changedFiles.map((x:any)=>{
    if(!x||typeof x.path!=="string"||typeof x.hash!=="string"||!x.path||!x.hash) throw new Error("Invalid checkpoint changed file");
    return {path:x.path,hash:x.hash};
  });
  for(const row of raw.unknownExecutions){
    if(!row||typeof row!=="object"||typeof row.execution_id!=="string") throw new Error("Invalid checkpoint unknown execution");
  }

  const normalized=normalizeLedgerState({
    goal:raw.goal,decisions,workingFiles:changedFiles,blockers:[],nextAction:raw.nextAction
  });

  return {
    schemaVersion:1,sessionId:raw.sessionId,repoIdentity:raw.repoIdentity,root:raw.root,
    transcriptRef:raw.transcriptRef,stateRevision:raw.stateRevision,goal:normalized.goal,
    tasks,decisions:normalized.decisions,changedFiles:normalized.workingFiles,
    evidence:raw.evidence.slice(0,100),nextAction:normalized.nextAction,
    unknownExecutions:raw.unknownExecutions.slice(0,1000)
  };
}

export async function createCheckpoint(root:string,store:StateStore,payload:CheckpointPayload):Promise<string>{
  const validated=validateCheckpointPayload(payload);
  const cpId=id("checkpoint");
  const dir=path.join(root,".macus","checkpoints",validated.sessionId);
  await ensureDir(dir);
  const final=path.join(dir,`${cpId}.json`), tmp=final+".tmp";
  const handle=await open(tmp,"w",0o600);
  try{
    await handle.writeFile(JSON.stringify({...validated,createdAt:nowIso()},null,2),"utf8");
    await handle.sync();
  }finally{
    await handle.close();
  }
  await rename(tmp,final);
  store.recordCheckpoint({id:cpId,sessionId:validated.sessionId,stateRevision:validated.stateRevision,filePath:final});
  return cpId;
}

export function listCheckpoints(store:StateStore,sessionId:string):CheckpointListItem[]{
  return store.checkpoints(sessionId).map(r=>({id:String(r.id),stateRevision:Number(r.state_revision),committed:Boolean(r.committed),createdAt:String(r.created_at),filePath:String(r.file_path)}));
}

export async function loadCheckpoint(store:StateStore,checkpointId:string):Promise<CheckpointPayload>{
  const row=store.checkpoint(checkpointId) as any;
  if(!row||!row.committed) throw new Error("Checkpoint unavailable or incomplete");
  try{
    return validateCheckpointPayload(JSON.parse(await readFile(row.file_path,"utf8")));
  }catch(error:any){
    store.invalidateCheckpoint(checkpointId);
    if(error?.code==="ENOENT") throw new Error("Checkpoint file missing; record marked incomplete");
    throw new Error(`Checkpoint invalid; record marked incomplete: ${error instanceof Error?error.message:String(error)}`);
  }
}

export async function restoreCheckpoint(args:{
  root:string;
  store:StateStore;
  sessionId:string;
  repoIdentity:string;
  checkpointId:string;
}):Promise<{
  checkpointId:string;
  transcriptRef?:string;
  restoredTasks:string[];
  freshFiles:string[];
  staleFiles:string[];
  ledgerRevision:number;
  unknownExecutionIds:string[];
}>{
  const cp=await loadCheckpoint(args.store,args.checkpointId);
  if(cp.sessionId!==args.sessionId) throw new Error("Checkpoint/session mismatch");
  if(cp.repoIdentity!==args.repoIdentity) throw new Error("Checkpoint/repository identity mismatch");
  if(path.resolve(cp.root)!==path.resolve(args.root)) throw new Error("Checkpoint/worktree root mismatch");

  const policy=new PathPolicy(args.root);
  const freshFiles:Array<{path:string;hash:string}>=[];
  const staleFiles:string[]=[];
  for(const saved of cp.changedFiles){
    try{
      const resolved=await policy.resolveReadable(saved.path);
      const current=await fileHash(resolved.absolute);
      if(current===saved.hash) freshFiles.push({path:resolved.relative,hash:saved.hash});
      else staleFiles.push(saved.path);
    }catch{staleFiles.push(saved.path);}
  }

  const blockers=staleFiles.length?[`checkpoint source changed: ${staleFiles.join(", ")}`]:[];
  let ledgerRevision=0;
  args.store.transaction(()=>{
    args.store.replaceTasks(args.sessionId,cp.tasks.map(raw=>({...raw,updatedAt:nowIso()})));
    ledgerRevision=new ContextLedger(args.store,args.sessionId).append({
      goal:cp.goal,decisions:cp.decisions,workingFiles:freshFiles,blockers,
      nextAction:staleFiles.length?"revalidate changed checkpoint files":cp.nextAction,
    });
  });

  return {
    checkpointId:args.checkpointId,transcriptRef:cp.transcriptRef,
    restoredTasks:cp.tasks.map(x=>x.id),freshFiles:freshFiles.map(x=>x.path),staleFiles,ledgerRevision,
    unknownExecutionIds:cp.unknownExecutions.map((x:any)=>String(x.execution_id))
  };
}

export interface CheckpointReconcileResult {
  removedTemps:string[];
  orphanFiles:string[];
  invalidatedRecords:string[];
}

export async function reconcileCheckpoints(root:string,store:StateStore,sessionId:string):Promise<CheckpointReconcileResult>{
  const dir=path.join(root,".macus","checkpoints",sessionId);
  await ensureDir(dir);
  const removedTemps:string[]=[];
  const orphanFiles:string[]=[];
  const invalidatedRecords:string[]=[];

  for(const name of await readdir(dir)){
    const file=path.join(dir,name);
    if(name.endsWith(".tmp")){
      await unlink(file).catch(()=>{});
      removedTemps.push(file);
    }
  }

  const rows=store.checkpoints(sessionId) as any[];
  const known=new Set(rows.map(r=>path.resolve(String(r.file_path))));
  for(const row of rows){
    try{await stat(row.file_path);}
    catch{
      store.invalidateCheckpoint(String(row.id));
      invalidatedRecords.push(String(row.id));
    }
  }

  for(const name of await readdir(dir)){
    if(!name.endsWith(".json")) continue;
    const file=path.resolve(path.join(dir,name));
    if(!known.has(file)) orphanFiles.push(file);
  }

  return {removedTemps,orphanFiles,invalidatedRecords};
}
