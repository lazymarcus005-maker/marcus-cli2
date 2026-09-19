import { describe,it,expect } from "vitest";
import { mkdtemp,rm,writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/storage/state.js";
import { TaskEngine } from "../src/workflow/tasks.js";
import { gitState,repositoryIdentity } from "../src/repository.js";
import { snapshotDigest } from "../src/testing/evidence.js";
import { assessVerification } from "../src/verification/assessment.js";

async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),"macus-verification-"));
  await writeFile(path.join(root,"source.ts"),"export const value = 1;\n");
  const store=await StateStore.open(root);
  const sessionId=store.createSession(root,await repositoryIdentity(root));
  return {root,store,sessionId};
}

async function recordEvidence(root:string,store:StateStore,sessionId:string,id:string,status:string){
  const [snapshot,repoId,git]=await Promise.all([snapshotDigest(root),repositoryIdentity(root),gitState(root)]);
  store.recordEvidence({id,sessionId,payload:{repoIdentity:repoId,head:git.head,status},snapshotDigest:snapshot,status});
  return id;
}

function recordEdit(store:StateStore,sessionId:string,runId:string){
  store.prepareExecution({executionId:"edit_"+runId,sessionId,runId,effectClass:"workspace_edit",payload:{path:"source.ts"}});
  store.markExecution("edit_"+runId,"completed");
}

describe("verification assessment",()=>{
  it("does not require evidence for a run with no coding work or verification attempt",async()=>{
    const f=await fixture();
    try{
      const result=await assessVerification(f.root,f.store,f.sessionId);
      expect(result.satisfied).toBe(true);
      expect(result.reason).toBe("no_verification_required");
    }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
  });

  it("requires evidence after an edit in the current run",async()=>{
    const f=await fixture();
    try{
      const runId=f.store.createRun(f.sessionId);
      recordEdit(f.store,f.sessionId,runId);
      const result=await assessVerification(f.root,f.store,f.sessionId,runId);
      expect(result.changedDuringRun).toBe(true);
      expect(result.satisfied).toBe(false);
      expect(result.reason).toBe("evidence_missing");
    }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
  });

  it("does not count earlier session edits as work changed in the current run",async()=>{
    const f=await fixture();
    try{
      const priorRun=f.store.createRun(f.sessionId);
      recordEdit(f.store,f.sessionId,priorRun);
      const currentRun=f.store.createRun(f.sessionId);
      const result=await assessVerification(f.root,f.store,f.sessionId,currentRun);
      expect(result.changedDuringRun).toBe(false);
      expect(result.satisfied).toBe(true);
      expect(result.reason).toBe("no_verification_required");
    }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
  });

  it("requires fresh passing evidence linked to every completed task",async()=>{
    const f=await fixture();
    try{
      const tasks=new TaskEngine(f.store,f.sessionId);
      tasks.create("t1","Change source");
      tasks.transition("t1","in_progress");
      tasks.transition("t1","completed");
      await recordEvidence(f.root,f.store,f.sessionId,"e_pass","passed");

      const unlinked=await assessVerification(f.root,f.store,f.sessionId);
      expect(unlinked.satisfied).toBe(false);
      expect(unlinked.reason).toBe("completed_task_unverified");

      const completed=f.store.listTasks(f.sessionId)[0]!;
      f.store.upsertTask({...completed,evidenceIds:["e_pass"]});
      const linked=await assessVerification(f.root,f.store,f.sessionId);
      expect(linked.satisfied).toBe(true);
      expect(linked.taskEvidence[0]?.verified).toBe(true);
    }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
  });

  it("uses the latest test evidence even when older evidence passed",async()=>{
    const f=await fixture();
    try{
      await recordEvidence(f.root,f.store,f.sessionId,"e_old","passed");
      await recordEvidence(f.root,f.store,f.sessionId,"e_new","unknown");
      const result=await assessVerification(f.root,f.store,f.sessionId);
      expect(result.latest?.id).toBe("e_new");
      expect(result.satisfied).toBe(false);
      expect(result.reason).toBe("latest_evidence_unknown");
    }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
  });
});
