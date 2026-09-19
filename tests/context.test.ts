import { describe,it,expect } from "vitest";
import { selectFragments } from "../src/context/working-set.js";

describe("context selector",()=>{
  it("deduplicates and omits stale fragments",()=>{
    const base={source:"a.ts",symbolId:undefined,startLine:1,endLine:2,reason:"x",tier:"HOT" as const,score:1,contentHash:"h",indexGeneration:1,estimatedTokens:5,content:"x"};
    const r=selectFragments([
      {...base,fragmentId:"1",freshness:"verified" as const},
      {...base,fragmentId:"2",freshness:"verified" as const},
      {...base,fragmentId:"3",freshness:"stale" as const,source:"b.ts"}
    ],10);
    expect(r.included).toHaveLength(1);
    expect(r.omitted.map(x=>x.reason)).toContain("duplicate");
    expect(r.omitted.map(x=>x.reason)).toContain("stale_or_unknown");
  });
});
