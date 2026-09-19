import { describe,it,expect } from "vitest";
import { readdir,readFile } from "node:fs/promises";
import path from "node:path";

async function files(root:string):Promise<string[]>{
  const out:string[]=[];
  for(const entry of await readdir(root,{withFileTypes:true})){
    const full=path.join(root,entry.name);
    if(entry.isDirectory())out.push(...await files(full));
    else if(entry.isFile()&&entry.name.endsWith(".ts"))out.push(full);
  }
  return out;
}

describe("storage abstraction boundary",()=>{
  it("keeps direct StateStore SQLite access inside state.ts",async()=>{
    const offenders:string[]=[];
    for(const file of await files("src")){
      if(file.endsWith(path.join("storage","state.ts")))continue;
      const text=await readFile(file,"utf8");
      if(/\bstore\.db\.(?:prepare|exec)\b/.test(text))offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
