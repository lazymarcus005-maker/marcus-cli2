import { describe,it,expect } from "vitest";
import { mkdtemp,rm,realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { StateStore } from "../src/storage/state.js";

function runCli(root:string,args:string[],input?:string):Promise<{code:number|null;stdout:string;stderr:string}>{
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.resolve("dist/cli.js"),...args],{cwd:root,stdio:["pipe","pipe","pipe"]});
    let stdout="",stderr="";child.stdout.on("data",c=>stdout+=c);child.stderr.on("data",c=>stderr+=c);child.on("error",reject);child.on("exit",code=>resolve({code,stdout,stderr}));
    if(input!==undefined)child.stdin.end(input); else child.stdin.end();
  });
}

describe("lazy CLI sessions",()=>{
  it("does not create a durable session for --help",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-lazy-help-"));
    const result=await runCli(root,["--help"]);
    expect(result.code).toBe(0);
    const store=await StateStore.open(root);expect(store.sessionCount()).toBe(0);store.close();
    await rm(root,{recursive:true,force:true});
  });

  it("does not create a session for --json status without a prompt",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-lazy-status-"));
    const result=await runCli(root,["--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).sessionId).toBeNull();
    const store=await StateStore.open(root);expect(store.sessionCount()).toBe(0);store.close();
    await rm(root,{recursive:true,force:true});
  });

  it("resumes an existing session without creating an intermediate session",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-lazy-resume-"));
    const canonical=await realpath(root);
    const { repositoryIdentity }=await import("../src/repository.js");
    const store=await StateStore.open(canonical);const actual=store.createSession(canonical,await repositoryIdentity(canonical));const before=store.sessionCount();store.close();
    const result=await runCli(canonical,["--resume",actual,"--json"]);
    expect(result.code).toBe(0);
    const store2=await StateStore.open(canonical);expect(store2.sessionCount()).toBe(before);store2.close();
    await rm(canonical,{recursive:true,force:true});
  });
});
