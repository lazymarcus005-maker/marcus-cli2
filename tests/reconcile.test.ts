import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { StateStore } from "../src/storage/state.js";
import { reconcileExecutions } from "../src/storage/recovery.js";
import { sha256 } from "../src/utils.js";

describe("execution reconciliation",()=>{
  it("recognizes a completed file write without replay",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-reconcile-"));
    const file=path.join(root,"a.txt"); await writeFile(file,"before");
    const store=await StateStore.open(root); const sid=store.createSession(root,"r");
    store.prepareExecution({executionId:"exec_x",sessionId:sid,effectClass:"workspace_edit",beforeHash:sha256("before"),payload:{path:"a.txt",expectedAfterHash:sha256("after")}} as any);
    store.markExecution("exec_x","started");
    await writeFile(file,"after");
    const r=await reconcileExecutions(root,store,sid);
    expect(r[0].status).toBe("completed_on_disk"); expect(r[0].replayAllowed).toBe(false);
    expect(store.unknownExecutions(sid)).toHaveLength(0);
    store.close(); await rm(root,{recursive:true,force:true});
  });
  it("keeps shell effects unknown",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-reconcile-")); const store=await StateStore.open(root); const sid=store.createSession(root,"r");
    store.prepareExecution({executionId:"exec_shell",sessionId:sid,effectClass:"shell",payload:{command:"x"}} as any);
    const r=await reconcileExecutions(root,store,sid); expect(r[0].status).toBe("unknown_external_effect"); expect(r[0].replayAllowed).toBe(false);
    store.close(); await rm(root,{recursive:true,force:true});
  });
});
