import { describe,it,expect } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CliCommandRegistry } from "../src/cli/registry.js";
import { registerDefaultCommands } from "../src/cli/commands.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { SessionCoordinator } from "../src/runtime/session-coordinator.js";
import { RuntimeLockCoordinator } from "../src/runtime/lock-coordinator.js";

describe("CLI command registry",()=>{
  it("executes command behavior without booting readline",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-command-registry-"));
    const store=await StateStore.open(root);const sessions=new SessionCoordinator(root,"repo",store);const locks=new RuntimeLockCoordinator(root);
    const registry=new CliCommandRegistry();let model="primary";
    registerDefaultCommands(registry,{
      root,repoId:"repo",config:structuredClone(DEFAULT_CONFIG),store,sessions,locks,authorized:new Set(),
      getModelAlias:()=>model,setModelAlias:x=>{model=x;},getKernel:()=>undefined,
      ensureKernel:async()=>{throw new Error("not expected");},disposeKernel:async()=>{},
      resumeSession:async()=>({recovery:[]}),statusObject:async()=>({sessionId:null,model:"primary",repository:{isGit:false},mutationLock:false,authorization:{edits:false,shell:false},unknownExecutions:0,jev:{enabled:false}}),
      getPendingTranscriptRef:()=>undefined,setPendingTranscriptRef:()=>{},
    });
    const status=registry.get("/status");expect(status).toBeTruthy();
    const text:string[]=[];const json:unknown[]=[];
    await status!.execute({json:false,args:[],print:v=>text.push(String(v)),printJson:v=>json.push(v),printText:v=>text.push(v),confirm:async()=>false});
    expect(text.join("\n")).toContain("Session   (none)");
    expect(registry.help()).toContain("/trust status|diff|refresh");
    expect(registry.list().length).toBeGreaterThan(10);
    store.close();await rm(root,{recursive:true,force:true});
  });
});
