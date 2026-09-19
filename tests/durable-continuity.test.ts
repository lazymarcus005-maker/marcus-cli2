import { describe,it,expect } from "vitest";
import { mkdtemp,rm,writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/storage/state.js";
import { TaskEngine } from "../src/workflow/tasks.js";
import { ContextLedger } from "../src/context/ledger.js";
import { repositoryIdentity } from "../src/repository.js";
import { DurableContinuity } from "../src/runtime/durable-continuity.js";
import { loadCheckpoint } from "../src/storage/checkpoint.js";

describe("durable continuity",()=>{
  it("captures and restores task and ledger state through one session interface",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-continuity-"));
    await writeFile(path.join(root,"source.ts"),"export const value = 1;\n");
    const store=await StateStore.open(root);
    const repoId=await repositoryIdentity(root);
    const sessionId=store.createSession(root,repoId);
    const tasks=new TaskEngine(store,sessionId);
    tasks.create("t1","Change value");
    tasks.transition("t1","in_progress");
    tasks.transition("t1","blocked");
    const ledger=new ContextLedger(store,sessionId);
    ledger.append({goal:"Change value",decisions:[{text:"Preserve schema v1"}],workingFiles:[],blockers:["test"],nextAction:"retry"});
    const continuity=new DurableContinuity(root,repoId,store,sessionId,true);
    try{
      const checkpointId=await continuity.createCheckpoint();
      tasks.transition("t1","pending");
      const restored=await continuity.restore(checkpointId);
      expect(restored.restored.restoredTasks).toEqual(["t1"]);
      expect(store.listTasks(sessionId)[0]?.status).toBe("blocked");
      expect(new ContextLedger(store,sessionId).latest()?.state.goal).toBe("Change value");
      const checkpoint=await continuity.createCheckpoint();
      expect(checkpoint).not.toBe(checkpointId);
    }finally{
      store.close();
      await rm(root,{recursive:true,force:true});
    }
  });

  it("preserves an explicit active goal when the context ledger is disabled",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-continuity-no-ledger-"));
    const store=await StateStore.open(root);
    const repoId=await repositoryIdentity(root);
    const sessionId=store.createSession(root,repoId);
    const continuity=new DurableContinuity(root,repoId,store,sessionId,false);
    try{
      const checkpointId=await continuity.createCheckpoint({goal:"Finish the current task"});
      const checkpoint=await loadCheckpoint(store,checkpointId);
      expect(checkpoint.goal).toBe("Finish the current task");
    }finally{
      store.close();
      await rm(root,{recursive:true,force:true});
    }
  });
});
