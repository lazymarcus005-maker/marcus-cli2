import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/storage/state.js";
import { createCheckpoint,listCheckpoints,loadCheckpoint } from "../src/storage/checkpoint.js";

describe("checkpoint payload validation",()=>{
  it("rejects multiple active tasks before writing a checkpoint",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-checkpoint-invalid-tasks-"));
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");
    const base={sessionId:sid,title:"x",relatedFiles:[],relatedSymbols:[],evidenceIds:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    await expect(createCheckpoint(root,store,{
      schemaVersion:1,sessionId:sid,repoIdentity:"repo",root,stateRevision:0,
      tasks:[{...base,id:"a",status:"in_progress"},{...base,id:"b",status:"in_progress"}] as any,
      decisions:[],changedFiles:[],evidence:[],unknownExecutions:[]
    })).rejects.toThrow(/multiple in_progress/i);
    store.close();await rm(root,{recursive:true,force:true});
  });

  it("marks a corrupted/future checkpoint record incomplete on load",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-checkpoint-corrupt-"));
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");
    const cp=await createCheckpoint(root,store,{schemaVersion:1,sessionId:sid,repoIdentity:"repo",root,stateRevision:0,tasks:[],decisions:[],changedFiles:[],evidence:[],unknownExecutions:[]});
    const row=listCheckpoints(store,sid).find(x=>x.id===cp)!;
    await writeFile(row.filePath,JSON.stringify({schemaVersion:2,sessionId:sid,repoIdentity:"repo",root,stateRevision:0,tasks:[],decisions:[],changedFiles:[],evidence:[],unknownExecutions:[]}));
    await expect(loadCheckpoint(store,cp)).rejects.toThrow(/unsupported checkpoint schema/i);
    expect(listCheckpoints(store,sid).find(x=>x.id===cp)?.committed).toBe(false);
    store.close();await rm(root,{recursive:true,force:true});
  });
});
