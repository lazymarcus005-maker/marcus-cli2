import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { TaskEngine } from "../src/workflow/tasks.js";
import { createMacusTools } from "../src/agent/tools.js";
import { fileHash } from "../src/utils.js";

describe("execution journal correlation",()=>{
  it("persists Pi tool-call and durable run identities for shell and edits",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-exec-link-"));await writeFile(path.join(root,"a.txt"),"before");
    const cfg=structuredClone(DEFAULT_CONFIG);const store=await StateStore.open(root);const sid=store.createSession(root,"repo");const runId=store.createRun(sid);
    const executor=new PolicyExecutor(root,sid,store,cfg);executor.authorize("all");
    const tools=createMacusTools({root,config:cfg,executor,tasks:new TaskEngine(store,sid),getRunId:()=>runId});
    await tools.find(t=>t.name==="run_command")!.execute("cmd-call",{command:"true"},new AbortController().signal,()=>{});
    const before=(await fileHash(path.join(root,"a.txt")))!;
    await tools.find(t=>t.name==="write_file")!.execute("write-call",{path:"a.txt",content:"after",expectedHash:before},new AbortController().signal,()=>{});
    const rows=store.db.prepare("SELECT run_id,tool_call_id,effect_class FROM executions ORDER BY prepared_at").all() as any[];
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({run_id:runId,tool_call_id:"cmd-call",effect_class:"shell"}),
      expect.objectContaining({run_id:runId,tool_call_id:"write-call",effect_class:"workspace_edit"})
    ]));
    store.close();await rm(root,{recursive:true,force:true});
  });
});
