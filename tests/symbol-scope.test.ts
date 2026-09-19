import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { TaskEngine } from "../src/workflow/tasks.js";
import { createMacusTools } from "../src/agent/tools.js";
import { SymbolIndex } from "../src/retrieval/index.js";

describe("path-scoped symbol search",()=>{
  it("does not return same-name symbols from other files",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-symbol-scope-"));
    await writeFile(path.join(root,"a.ts"),"export function target(){return 1}\n");
    await writeFile(path.join(root,"b.ts"),"export function target(){return 2}\n");
    const cfg=structuredClone(DEFAULT_CONFIG);
    const idx=await SymbolIndex.open(root,cfg);await idx.refresh("b.ts");idx.close();
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");
    const tools=createMacusTools({root,config:cfg,executor:new PolicyExecutor(root,sid,store,cfg),tasks:new TaskEngine(store,sid)});
    const tool=tools.find(t=>t.name==="search_symbol")!;
    const result=await tool.execute("s",{path:"a.ts",query:"target"},new AbortController().signal,()=>{});
    const symbols=(result.details as any).symbols;
    expect(symbols).toHaveLength(1);expect(symbols[0].path).toBe("a.ts");
    store.close();await rm(root,{recursive:true,force:true});
  });
});
