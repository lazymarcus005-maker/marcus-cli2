import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,readFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { TaskEngine } from "../src/workflow/tasks.js";
import { ContextLedger } from "../src/context/ledger.js";
import { createCheckpoint,listCheckpoints,restoreCheckpoint } from "../src/storage/checkpoint.js";
import { fileHash } from "../src/utils.js";
import { PolicyExecutor } from "../src/policy.js";
import { createMacusTools } from "../src/agent/tools.js";

describe("checkpoint state restore",()=>{
  it("restores agent state while preserving changed source bytes and marking them stale",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-checkpoint-restore-"));await writeFile(path.join(root,"a.ts"),"export const a=1;\n");
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");const tasks=new TaskEngine(store,sid);
    tasks.create("t1","Implement feature");tasks.transition("t1","in_progress");
    const hash=(await fileHash(path.join(root,"a.ts")))!;
    const ledger=new ContextLedger(store,sid);
    const revision=ledger.append({goal:"ship feature",decisions:[{text:"use adapter",provenance:"user"}],workingFiles:[{path:"a.ts",hash}],blockers:[],nextAction:"test"});
    const cp=await createCheckpoint(root,store,{schemaVersion:1,sessionId:sid,repoIdentity:"repo",root,stateRevision:revision,goal:"ship feature",tasks:tasks.list(),decisions:ledger.latest()!.state.decisions,changedFiles:[{path:"a.ts",hash}],evidence:[],nextAction:"test",unknownExecutions:[]});
    expect(listCheckpoints(store,sid)[0].id).toBe(cp);

    tasks.transition("t1","blocked");await writeFile(path.join(root,"a.ts"),"export const a=99;\n");
    const restored=await restoreCheckpoint({root,store,sessionId:sid,repoIdentity:"repo",checkpointId:cp});
    expect(restored.restoredTasks).toContain("t1");expect(restored.staleFiles).toContain("a.ts");
    expect(tasks.list().find(t=>t.id==="t1")?.status).toBe("in_progress");
    expect(await readFile(path.join(root,"a.ts"),"utf8")).toContain("99");
    const latest=ledger.latest()!;
    expect(latest.state.decisions).toEqual([{text:"use adapter",provenance:"user"}]);
    expect(latest.state.blockers.some(x=>x.includes("a.ts"))).toBe(true);
    store.close();await rm(root,{recursive:true,force:true});
  });

  it("records durable decisions with provenance through the agent tool",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-decision-tool-"));const store=await StateStore.open(root);const sid=store.createSession(root,"repo");
    const cfg=structuredClone(DEFAULT_CONFIG);const executor=new PolicyExecutor(root,sid,store,cfg);const tasks=new TaskEngine(store,sid);
    const tools=createMacusTools({root,config:cfg,executor,tasks});
    const decision=tools.find(t=>t.name==="decision_record")!;
    await decision.execute("decision-call",{text:"Prefer adapter boundary",provenance:"architecture review"},new AbortController().signal,()=>{});
    const latest=new ContextLedger(store,sid).latest()!;
    expect(latest.state.decisions).toEqual([{text:"Prefer adapter boundary",provenance:"architecture review"}]);
    store.close();await rm(root,{recursive:true,force:true});
  });
  it("replaces checkpoint task state atomically and removes tasks created after the checkpoint",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-checkpoint-task-replace-"));
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");const tasks=new TaskEngine(store,sid);
    tasks.create("a","A");tasks.create("b","B");
    const snapshot=tasks.list().map(t=>t.id==="a"?{...t,status:"blocked" as const}:{...t,status:"in_progress" as const});
    const cp=await createCheckpoint(root,store,{schemaVersion:1,sessionId:sid,repoIdentity:"repo",root,stateRevision:0,tasks:snapshot,decisions:[],changedFiles:[],evidence:[],unknownExecutions:[]});
    tasks.create("c","C");tasks.transition("c","in_progress");
    const restored=await restoreCheckpoint({root,store,sessionId:sid,repoIdentity:"repo",checkpointId:cp});
    expect(restored.restoredTasks.sort()).toEqual(["a","b"]);
    expect(tasks.list().map(t=>({id:t.id,status:t.status}))).toEqual([{id:"a",status:"blocked"},{id:"b",status:"in_progress"}]);
    store.close();await rm(root,{recursive:true,force:true});
  });

  it("rolls back the entire task restore when a task write fails",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-checkpoint-rollback-"));
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");const tasks=new TaskEngine(store,sid);
    tasks.create("original","Original");tasks.transition("original","in_progress");
    const base=tasks.list()[0];
    const cp=await createCheckpoint(root,store,{schemaVersion:1,sessionId:sid,repoIdentity:"repo",root,stateRevision:0,tasks:[{...base,id:"a",title:"A",status:"pending"},{...base,id:"b",title:"B",status:"blocked"}],decisions:[],changedFiles:[],evidence:[],unknownExecutions:[]});
    const originalUpsert=store.upsertTask.bind(store);let calls=0;
    (store as any).upsertTask=(task:any)=>{calls++;if(calls===2)throw new Error("simulated checkpoint task failure");return originalUpsert(task);};
    await expect(restoreCheckpoint({root,store,sessionId:sid,repoIdentity:"repo",checkpointId:cp})).rejects.toThrow(/simulated checkpoint task failure/);
    (store as any).upsertTask=originalUpsert;
    expect(tasks.list().map(t=>({id:t.id,status:t.status}))).toEqual([{id:"original",status:"in_progress"}]);
    store.close();await rm(root,{recursive:true,force:true});
  });

});
