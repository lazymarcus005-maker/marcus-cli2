import { describe,it,expect } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { TaskEngine } from "../src/workflow/tasks.js";
import { createMacusTools } from "../src/agent/tools.js";

describe("complete V1 capabilities",()=>{
  it("uses canonical complete-V1 defaults",()=>{
    expect(DEFAULT_CONFIG.features).toMatchObject({
      repo_map:true,code_graph:false,context_ledger:true,checkpoint:true,
      auto_compaction:true,git_context:true,task_engine:true,prompt_cache_optimization:true,
      semantic_search:false,telemetry:false
    });
  });

  it("hides optional Git/task tools when their flags are disabled",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-cap-"));
    const cfg=structuredClone(DEFAULT_CONFIG); cfg.features.git_context=false; cfg.features.task_engine=false;
    const store=await StateStore.open(root); const sid=store.createSession(root,"repo");
    const executor=new PolicyExecutor(root,sid,store,cfg);
    const tools=createMacusTools({root,config:cfg,executor,tasks:new TaskEngine(store,sid)});
    const names=tools.map(x=>x.name);
    expect(names).not.toContain("git_diff");
    expect(names).not.toContain("task_create");
    expect(names).toContain("run_test");
    expect(names).toContain("review");
    store.close(); await rm(root,{recursive:true,force:true});
  });
});
