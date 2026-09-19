import { describe,it,expect } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { GraphStore } from "../src/graph/graph.js";
import { AgentHarness } from "../src/workflow/harness.js";

describe("graph/workflow",()=>{
  it("keeps uncertain relationships explicit",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-graph-")); const g=await GraphStore.open(root);
    g.replaceEdgesForSource("a",[{edgeType:"references",fromId:"a",targetText:"same",resolution:"candidate",confidence:0.5,evidence:{path:"a.ts",startLine:1,endLine:1,hash:"h",method:"text"},resolverVersion:"1",indexGeneration:1}]);
    const impact=g.impact("a"); expect(impact.candidate).toHaveLength(1); expect(impact.coverage).toBe("partial"); g.close();
    await rm(root,{recursive:true,force:true});
  });
  it("blocks repeated no-progress failures",()=>{
    const h=new AgentHarness({max_model_turns:40,max_no_progress_attempts:3,max_duration_seconds:1800});
    h.onFailure("E1 at 12","v1",false);h.onFailure("E1 at 13","v1",false);h.onFailure("E1 at 14","v1",false);
    expect(h.state.stage).toBe("blocked");
  });
});
