import { describe,it,expect } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";

describe("command timeout",()=>{
  it("records timeout instead of pass",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-timeout-")); const store=await StateStore.open(root); const sid=store.createSession(root,"repo");
    const cfg=structuredClone(DEFAULT_CONFIG); cfg.execution.command_timeout_seconds=1; cfg.execution.termination_grace_seconds=1;
    const ex=new PolicyExecutor(root,sid,store,cfg); ex.authorize("shell"); const r=await ex.run("sleep 2");
    expect(r.timedOut).toBe(true); expect(r.exitCode).not.toBe(0);
    store.close(); await rm(root,{recursive:true,force:true});
  },5000);
});
