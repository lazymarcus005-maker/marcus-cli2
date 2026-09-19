import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { searchCode } from "../src/retrieval/search.js";
import { parseSymbols } from "../src/retrieval/symbols.js";
import { SymbolIndex } from "../src/retrieval/index.js";

describe("retrieval",()=>{
  it("searches and parses duplicate symbols explicitly",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-ret-"));
    await writeFile(path.join(root,"a.ts"),"export function same(){ return 1 }\nexport class A { same(){ return 2 } }\n");
    const cfg=structuredClone(DEFAULT_CONFIG);
    const sr=await searchCode(root,cfg,{query:"same",literal:true}); expect(sr.returnedCount).toBeGreaterThan(0);
    const parsed=await parseSymbols(root,cfg,"a.ts"); expect(parsed.symbols.filter(s=>s.name==="same").length).toBeGreaterThanOrEqual(1);
    const idx=await SymbolIndex.open(root,cfg); await idx.refresh("a.ts"); expect(idx.search("same").length).toBeGreaterThan(0); idx.close();
    await rm(root,{recursive:true,force:true});
  });
});
