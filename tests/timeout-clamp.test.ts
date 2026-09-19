import { describe,it,expect } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";

describe("command timeout ceiling",()=>{
  it("does not let a model-requested timeout exceed the user-configured command ceiling",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-timeout-clamp-"));
    const cfg=structuredClone(DEFAULT_CONFIG);cfg.execution.command_timeout_seconds=1;cfg.execution.termination_grace_seconds=1;
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");
    const ex=new PolicyExecutor(root,sid,store,cfg);ex.authorize("shell");
    const started=Date.now();
    const result=await ex.run("sleep 5",{timeoutSeconds:999});
    expect(result.timedOut).toBe(true);
    expect(Date.now()-started).toBeLessThan(3000);
    store.close();await rm(root,{recursive:true,force:true});
  },5000);
});
