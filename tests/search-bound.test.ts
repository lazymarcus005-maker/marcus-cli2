import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { searchCode } from "../src/retrieval/search.js";

describe("bounded search",()=>{
  it("stops globally and emits continuation",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-search-"));
    await writeFile(path.join(root,"a.txt"),Array.from({length:20},(_,i)=>"needle "+i).join("\n"));
    const cfg=structuredClone(DEFAULT_CONFIG); cfg.retrieval.search_max_results=5;
    const a=await searchCode(root,cfg,{query:"needle"}); expect(a.returnedCount).toBe(5); expect(a.truncated).toBe(true); expect(a.totalKnown).toBeNull(); expect(a.nextCursor).toBeTruthy();
    const b=await searchCode(root,cfg,{query:"needle",cursor:a.nextCursor}); expect(b.matches[0].text).toContain("5");
    await rm(root,{recursive:true,force:true});
  });
});
