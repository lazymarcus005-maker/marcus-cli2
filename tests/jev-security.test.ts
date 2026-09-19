import { describe,it,expect } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { TaskEngine } from "../src/workflow/tasks.js";
import { createMacusTools } from "../src/agent/tools.js";

describe("Jev security boundaries",()=>{
  it("is never registered as a Pi-visible agent tool",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-jev-tools-"));
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");const cfg=structuredClone(DEFAULT_CONFIG);
    cfg.features.jev_harness=true;cfg.internal_models.jev.enabled=true;cfg.internal_models.jev.api_key_env="MACUS_TEST_JEV_KEY";process.env.MACUS_TEST_JEV_KEY="secret";
    const tools=createMacusTools({root,config:cfg,executor:new PolicyExecutor(root,sid,store,cfg),tasks:new TaskEngine(store,sid)});
    expect(tools.map(x=>x.name).some(name=>/jev|decision_model|ask_jev/i.test(name))).toBe(false);
    delete process.env.MACUS_TEST_JEV_KEY;store.close();await rm(root,{recursive:true,force:true});
  });

  it("never forwards the Jev API key into authorized shell subprocesses",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-jev-credential-"));
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");const cfg=structuredClone(DEFAULT_CONFIG);
    cfg.features.jev_harness=true;cfg.internal_models.jev.enabled=true;cfg.internal_models.jev.api_key_env="MACUS_TEST_JEV_KEY";
    cfg.execution.environment_allowlist=[...cfg.execution.environment_allowlist,"MACUS_TEST_JEV_KEY"];
    process.env.MACUS_TEST_JEV_KEY="TOP-SECRET-JEV";
    const executor=new PolicyExecutor(root,sid,store,cfg);executor.authorize("shell");
    const result=await executor.run('printf "%s" "$MACUS_TEST_JEV_KEY"');
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("TOP-SECRET-JEV");
    delete process.env.MACUS_TEST_JEV_KEY;store.close();await rm(root,{recursive:true,force:true});
  });
});
