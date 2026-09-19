import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,appendFile,rm,utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { searchCode } from "../src/retrieval/search.js";

describe("search cursor generation",()=>{
  it("rejects a cursor after repository source changes",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-cursor-"));
    const file=path.join(root,"a.txt");
    await writeFile(file,Array.from({length:20},(_,i)=>"needle "+i).join("\n"));
    const cfg=structuredClone(DEFAULT_CONFIG); cfg.retrieval.search_max_results=5;
    const first=await searchCode(root,cfg,{query:"needle"});
    expect(first.nextCursor).toBeTruthy();
    await new Promise(r=>setTimeout(r,5));
    await appendFile(file,"\nneedle changed");
    await expect(searchCode(root,cfg,{query:"needle",cursor:first.nextCursor})).rejects.toThrow(/source generation changed/i);
    await rm(root,{recursive:true,force:true});
  });  it("rejects a cursor after same-size content changes even when mtime is restored",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-cursor-content-"));
    const file=path.join(root,"a.txt");
    const fixed=new Date(1700000000000);
    await writeFile(file,Array.from({length:20},(_,i)=>"needle "+String(i).padStart(2,"0")).join("\n"));
    await utimes(file,fixed,fixed);
    const cfg=structuredClone(DEFAULT_CONFIG); cfg.retrieval.search_max_results=5;
    const first=await searchCode(root,cfg,{query:"needle"});
    expect(first.nextCursor).toBeTruthy();
    const changed=Array.from({length:20},(_,i)=>i===10?"needle XX":"needle "+String(i).padStart(2,"0")).join("\n");
    await writeFile(file,changed);
    await utimes(file,fixed,fixed);
    await expect(searchCode(root,cfg,{query:"needle",cursor:first.nextCursor})).rejects.toThrow(/source generation changed/i);
    await rm(root,{recursive:true,force:true});
  });

});
