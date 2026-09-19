import { describe,it,expect } from "vitest";
import { mkdtemp,rm,writeFile,mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { reconcileCheckpoints, loadCheckpoint } from "../src/storage/checkpoint.js";

describe("recovery edge cases",()=>{
  it("reports an expired log reference explicitly",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-log-expire-"));
    const store=await StateStore.open(root); const sid=store.createSession(root,"repo");
    const executor=new PolicyExecutor(root,sid,store,structuredClone(DEFAULT_CONFIG));
    await expect(executor.readLog("exec_00000000-0000-0000-0000-000000000000")).rejects.toThrow(/expired or missing/i);
    store.close(); await rm(root,{recursive:true,force:true});
  });

  it("reconciles checkpoint temp files, orphan finals, and missing committed files",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-cp-reconcile-"));
    const store=await StateStore.open(root); const sid=store.createSession(root,"repo");
    const dir=path.join(root,".macus","checkpoints",sid); await mkdir(dir,{recursive:true});

    const tmp=path.join(dir,"checkpoint_temp.json.tmp"); await writeFile(tmp,"partial");
    const orphan=path.join(dir,"checkpoint_orphan.json"); await writeFile(orphan,"{}");

    const missing=path.join(dir,"checkpoint_missing.json");
    store.db.prepare("INSERT INTO checkpoints(id,session_id,state_revision,file_path,committed,created_at) VALUES(?,?,?,?,1,?)")
      .run("checkpoint_missing",sid,1,missing,new Date().toISOString());

    const result=await reconcileCheckpoints(root,store,sid);
    expect(result.removedTemps).toContain(tmp);
    expect(result.orphanFiles).toContain(path.resolve(orphan));
    expect(result.invalidatedRecords).toContain("checkpoint_missing");
    await expect(loadCheckpoint(store,"checkpoint_missing")).rejects.toThrow(/unavailable or incomplete/i);

    store.close(); await rm(root,{recursive:true,force:true});
  });
});
