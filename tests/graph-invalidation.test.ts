import { describe,it,expect } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GraphStore } from "../src/graph/graph.js";

const edge=(fromId:string,toId:string|undefined,file:string)=>({
  edgeType:"references",fromId,toId,targetText:toId??"missing",resolution:(toId?"candidate":"unresolved") as const,
  confidence:0.5,evidence:{path:file,startLine:1,endLine:1,hash:"h",method:"test"},resolverVersion:"1",indexGeneration:1
});

describe("graph invalidation",()=>{
  it("replaces every edge originating from an edited file and prunes dangling symbol targets",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-graph-invalidate-"));
    const graph=await GraphStore.open(root);
    graph.replaceEdgesForFile("a.ts",[edge("oldA","target","a.ts")]);
    expect(graph.find("oldA")).toHaveLength(1);
    graph.replaceEdgesForFile("a.ts",[]);
    expect(graph.find("oldA")).toHaveLength(0);

    graph.replaceEdgesForFile("b.ts",[edge("b","deletedTarget","b.ts")]);
    expect(graph.find("deletedTarget")).toHaveLength(1);
    const removed=graph.pruneDangling(["b"]);
    expect(removed).toBeGreaterThan(0);
    expect(graph.find("deletedTarget")).toHaveLength(0);
    graph.close(); await rm(root,{recursive:true,force:true});
  });
});
