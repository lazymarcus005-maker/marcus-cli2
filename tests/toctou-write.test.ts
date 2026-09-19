import { describe,it,expect,vi } from "vitest";
import { mkdtemp,writeFile,readFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("../src/utils.js",async(importOriginal)=>{
  const actual=await importOriginal<typeof import("../src/utils.js")>();
  let sourceHashCalls=0;
  return {
    ...actual,
    fileHash:async(filePath:string)=>{
      if(filePath.endsWith("a.txt")){
        sourceHashCalls++;
        return sourceHashCalls===1?"hash-before":"hash-external";
      }
      return actual.fileHash(filePath);
    }
  };
});

import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";

describe("hash-guarded atomic write",()=>{
  it("revalidates immediately before rename and refuses a changed source",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-toctou-"));
    const file=path.join(root,"a.txt");
    await writeFile(file,"original");
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");
    const executor=new PolicyExecutor(root,sid,store,structuredClone(DEFAULT_CONFIG));executor.authorize("edits");

    await expect(executor.safeWrite("a.txt","agent-change","hash-before")).rejects.toThrow(/before commit/i);
    expect(await readFile(file,"utf8")).toBe("original");
    const row=store.db.prepare("SELECT status FROM executions WHERE session_id=? ORDER BY prepared_at DESC LIMIT 1").get(sid) as any;
    expect(row.status).toBe("failed");

    store.close();await rm(root,{recursive:true,force:true});
  });
});
