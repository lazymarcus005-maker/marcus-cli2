import { describe,it,expect } from "vitest";
import { mkdtemp,mkdir,writeFile,rm } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { resolveInstructions } from "../src/instructions.js";

describe("instruction resolution",()=>{
  it("orders root to deeper and MACUS over same-scope peers",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-inst-")); await mkdir(path.join(root,"src"),{recursive:true});
    await writeFile(path.join(root,"AGENTS.md"),"root agents");
    await writeFile(path.join(root,"MACUS.md"),"root macus");
    await writeFile(path.join(root,"src","CLAUDE.md"),"deep claude");
    const r=await resolveInstructions(root,path.join(root,"src"));
    expect(r.map(x=>path.basename(x.path))).toEqual(["AGENTS.md","MACUS.md","CLAUDE.md"]);
    expect(r.at(-1)?.scope).toBe(path.join(root,"src"));
    await rm(root,{recursive:true,force:true});
  });
});
