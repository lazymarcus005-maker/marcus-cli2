import { describe,it,expect } from "vitest";
import { mkdtemp,mkdir,writeFile,rm } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { SymbolIndex } from "../src/retrieval/index.js";

describe("index discovery ignores",()=>{
  it("respects gitignore, macusignore and mandatory exclusions",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-ignore-"));
    await mkdir(path.join(root,"ignored"),{recursive:true}); await mkdir(path.join(root,"secret"),{recursive:true}); await mkdir(path.join(root,"src"),{recursive:true});
    await writeFile(path.join(root,".gitignore"),"ignored/\n");
    await writeFile(path.join(root,".macusignore"),"secret/\n");
    await writeFile(path.join(root,"ignored","a.ts"),"export const a=1");
    await writeFile(path.join(root,"secret","b.ts"),"export const b=1");
    await writeFile(path.join(root,"src","c.ts"),"export const c=1");
    const idx=await SymbolIndex.open(root,structuredClone(DEFAULT_CONFIG)); const discovery=await idx.discover();
    expect(discovery).toEqual({files:["src/c.ts"],truncated:false}); idx.close(); await rm(root,{recursive:true,force:true});
  });
});
