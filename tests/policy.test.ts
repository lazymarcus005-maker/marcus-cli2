import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,readFile,rm } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { repositoryIdentity } from "../src/repository.js";

describe("policy",()=>{
  it("prevents stale writes and bounds output",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-policy-"));
    await writeFile(path.join(root,"a.txt"),"one");
    const store=await StateStore.open(root); const sid=store.createSession(root,await repositoryIdentity(root));
    const ex=new PolicyExecutor(root,sid,store,structuredClone(DEFAULT_CONFIG)); ex.authorize("all");
    const r=await ex.safeRead("a.txt"); await writeFile(path.join(root,"a.txt"),"external");
    await expect(ex.safeWrite("a.txt","agent",r.hash)).rejects.toThrow(/changed/);
    const cmd=await ex.run("printf 'ok'"); expect(cmd.exitCode).toBe(0); expect(cmd.stdout).toContain("ok");
    store.close(); await rm(root,{recursive:true,force:true});
  });
  it("fails closed without explicit authorization",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-auth-")); await writeFile(path.join(root,"a.txt"),"one");
    const store=await StateStore.open(root); const sid=store.createSession(root,"repo"); const ex=new PolicyExecutor(root,sid,store,structuredClone(DEFAULT_CONFIG));
    await expect(ex.run("printf x")).rejects.toThrow(/authorization/);
    await expect(ex.safeWrite("a.txt","two",await (async()=>{const r=await ex.safeRead("a.txt");return r.hash})())).rejects.toThrow(/authorization/);
    store.close(); await rm(root,{recursive:true,force:true});
  });

});
