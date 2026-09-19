import { describe,it,expect } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { searchCode } from "../src/retrieval/search.js";

describe("pre-aborted cancellation",()=>{
  it("does not launch shell work when the signal is already aborted",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-preabort-"));
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");
    const ex=new PolicyExecutor(root,sid,store,structuredClone(DEFAULT_CONFIG));ex.authorize("shell");
    const ac=new AbortController();ac.abort();
    const started=Date.now();const result=await ex.run("sleep 1; printf done",{signal:ac.signal});
    expect(Date.now()-started).toBeLessThan(400);
    expect(result.cancelled).toBe(true);expect(result.stdout).toBe("");
    const row=store.db.prepare("SELECT status,cancelled FROM executions WHERE execution_id=?").get(result.executionId) as any;
    expect(row.status).toBe("cancelled");expect(row.cancelled).toBe(1);
    store.close();await rm(root,{recursive:true,force:true});
  });

  it("does not launch ripgrep when the signal is already aborted",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-search-preabort-"));
    const ac=new AbortController();ac.abort();
    const result=await searchCode(root,structuredClone(DEFAULT_CONFIG),{query:"anything",signal:ac.signal});
    expect(result.partialReason).toBe("cancelled");expect(result.matches).toEqual([]);
    await rm(root,{recursive:true,force:true});
  });
});
