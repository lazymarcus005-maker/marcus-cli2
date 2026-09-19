import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { SymbolIndex } from "../src/retrieval/index.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { TaskEngine } from "../src/workflow/tasks.js";
import { createMacusTools } from "../src/agent/tools.js";
import { estimateTokens } from "../src/context/budget.js";

describe("repo-map truncated discovery",()=>{
  it("never deletes indexed entries outside a truncated discovery window",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-map-truncated-"));
    const names=Array.from({length:2001},(_,i)=>"f"+String(i).padStart(4,"0")+".ts");
    for(let i=0;i<names.length;i++) await writeFile(path.join(root,names[i]),`export const marker${i}=${i};\n`);
    const cfg=structuredClone(DEFAULT_CONFIG);
    let idx=await SymbolIndex.open(root,cfg);
    const first=await idx.discover(2000);
    expect(first.truncated).toBe(true);
    const omitted=names.find(n=>!first.files.includes(n));
    expect(omitted).toBeTruthy();
    await idx.refresh(omitted!);
    expect(idx.db.prepare("SELECT COUNT(*) AS n FROM indexed_files WHERE path=?").get(omitted!) as any).toMatchObject({n:1});
    idx.close();

    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");
    const executor=new PolicyExecutor(root,sid,store,cfg);
    const tools=createMacusTools({root,config:cfg,executor,tasks:new TaskEngine(store,sid)});
    const repoMap=tools.find(t=>t.name==="repo_map")!;
    const result=await repoMap.execute("map",{},new AbortController().signal,()=>{});
    expect((result.details as any).discoveryTruncated).toBe(true);
    expect((result.details as any).removedStaleFiles).toEqual([]);

    idx=await SymbolIndex.open(root,cfg);
    expect(idx.db.prepare("SELECT COUNT(*) AS n FROM indexed_files WHERE path=?").get(omitted!) as any).toMatchObject({n:1});
    idx.close();store.close();await rm(root,{recursive:true,force:true});
  },20000);
  it("enforces the repo-map budget using the same conservative estimator",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-map-budget-"));
    await writeFile(path.join(root,"a.ts"),"export class Alpha { first(){return 1} second(){return 2} third(){return 3} }\n");
    const cfg=structuredClone(DEFAULT_CONFIG);
    const idx=await SymbolIndex.open(root,cfg);await idx.refresh("a.ts");
    const map=idx.repoMap(80);
    expect(estimateTokens(map)).toBeLessThanOrEqual(80);
    idx.close();await rm(root,{recursive:true,force:true});
  });

});
