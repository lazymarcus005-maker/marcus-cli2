import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifySearchMatchesAgainstSnapshots } from "../src/retrieval/search.js";
import { sha256 } from "../src/utils.js";
import { SymbolIndex } from "../src/retrieval/index.js";
import { DEFAULT_CONFIG } from "../src/config.js";

describe("source snapshot binding",()=>{
  it("drops a search match whose text no longer matches the file snapshot",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-search-race-"));
    await writeFile(path.join(root,"a.ts"),"export const NEW_MARKER = 2;\n");
    const result=await verifySearchMatchesAgainstSnapshots(root,[{path:"a.ts",line:1,text:"export const OLD_MARKER = 1;"}]);
    expect(result.raced).toBe(true);expect(result.matches).toEqual([]);
    await rm(root,{recursive:true,force:true});
  });

  it("attaches the hash of the exact file snapshot that contains the search line",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-search-snapshot-"));
    const source="export const MARKER = 1;\n";await writeFile(path.join(root,"a.ts"),source);
    const result=await verifySearchMatchesAgainstSnapshots(root,[{path:"a.ts",line:1,text:"export const MARKER = 1;"}]);
    expect(result.raced).toBe(false);expect(result.matches[0].sourceHash).toBe(sha256(source));
    await rm(root,{recursive:true,force:true});
  });

  it("keeps symbol and repo-map payload versions tied to indexed content hashes",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-index-snapshot-"));
    const source="export function target(){return 1}\n";await writeFile(path.join(root,"a.ts"),source);
    const idx=await SymbolIndex.open(root,structuredClone(DEFAULT_CONFIG));
    const refreshed=await idx.refresh("a.ts");const symbols=idx.search("target",10,"a.ts");const map=idx.repoMapSnapshot(1000);
    expect(refreshed.sourceHash).toBe(sha256(source));
    expect(symbols.every(x=>x.sourceHash===refreshed.sourceHash)).toBe(true);
    expect(map.sources).toContainEqual({path:"a.ts",hash:refreshed.sourceHash});
    idx.close();await rm(root,{recursive:true,force:true});
  });
});
