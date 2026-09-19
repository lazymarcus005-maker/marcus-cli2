import { describe,it,expect } from "vitest";
import { mkdtemp,rm,writeFile } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { StateStore } from "../src/storage/state.js";
import { acquireMutationLock } from "../src/storage/lock.js";
import { createCheckpoint, loadCheckpoint } from "../src/storage/checkpoint.js";

describe("recovery foundations",()=>{
  it("rejects second mutating lock",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-lock-"));
    const release=await acquireMutationLock(root);
    await expect(acquireMutationLock(root)).rejects.toThrow();
    await release(); await rm(root,{recursive:true,force:true});
  });
  it("preserves unknown executions and checkpoint state without source rollback",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-cp-"));
    await writeFile(path.join(root,"source.txt"),"current");
    const store=await StateStore.open(root); const sid=store.createSession(root,"repo");
    store.prepareExecution({executionId:"exec_unknown",sessionId:sid,effectClass:"external",payload:{x:1}});
    expect(store.unknownExecutions(sid)).toHaveLength(1);
    const cp=await createCheckpoint(root,store,{schemaVersion:1,sessionId:sid,repoIdentity:"repo",root,stateRevision:0,tasks:[],decisions:[],changedFiles:[],evidence:[],unknownExecutions:store.unknownExecutions(sid)});
    const loaded=await loadCheckpoint(store,cp); expect(loaded.unknownExecutions).toHaveLength(1);
    store.close(); await rm(root,{recursive:true,force:true});
  });
});
