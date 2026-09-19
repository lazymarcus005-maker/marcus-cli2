import { describe,it,expect } from "vitest";
import http from "node:http";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PiAgentKernel } from "../src/agent/kernel.js";
import { RuntimeLockCoordinator } from "../src/runtime/lock-coordinator.js";
import { repositoryIdentity } from "../src/repository.js";

function sse(res:http.ServerResponse,text:string){
  res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache"});
  res.write("data: "+JSON.stringify({id:"c",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:text},finish_reason:null}]})+"\n\n");
  res.write("data: "+JSON.stringify({id:"c",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"stop"}]})+"\n\n");
  res.write("data: [DONE]\n\n");res.end();
}

describe("read-only concurrency",()=>{
  it("allows two read-only kernels in one worktree without acquiring the mutation lock",async()=>{
    let calls=0;
    const server=http.createServer(async(req,res)=>{
      for await(const _ of req){}
      calls++;
      setTimeout(()=>sse(res,"read-only"),25);
    });
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    const port=(server.address() as any).port;
    process.env.MACUS_TEST_KEY="secret";

    const root=await mkdtemp(path.join(os.tmpdir(),"macus-read-concurrent-"));
    const cfg=structuredClone(DEFAULT_CONFIG);
    cfg.models={default:"primary",providers:{mock:{protocol:"openai-compatible",base_url:`http://127.0.0.1:${port}/v1`,api_key_env:"MACUS_TEST_KEY",profile:"p",model:"mock"}},aliases:{primary:"mock"}};
    cfg.model_profiles={p:{context_window:65536,max_output_tokens:1024,tokenizer:"conservative-byte-estimate"}};
    cfg.context.reserved_output_tokens=1024;cfg.context.safety_margin_tokens=512;cfg.features.auto_compaction=false;

    const store=await StateStore.open(root);const repo=await repositoryIdentity(root);
    const sidA=store.createSession(root,repo),sidB=store.createSession(root,repo);
    const lockA=new RuntimeLockCoordinator(root),lockB=new RuntimeLockCoordinator(root);
    const a=new PiAgentKernel(root,cfg,sidA,store,"primary",()=>lockA.ensureMutationAccess());
    const b=new PiAgentKernel(root,cfg,sidB,store,"primary",()=>lockB.ensureMutationAccess());
    await Promise.all([a.create(),b.create()]);
    await Promise.all([a.prompt("inspect only"),b.prompt("inspect only")]);
    await Promise.all([a.current.waitForIdle(),b.current.waitForIdle()]);

    expect(calls).toBe(2);
    expect(lockA.mutationOwned).toBe(false);
    expect(lockB.mutationOwned).toBe(false);

    await Promise.all([a.dispose(),b.dispose()]);
    store.close();delete process.env.MACUS_TEST_KEY;
    await new Promise<void>(r=>server.close(()=>r()));
    await rm(root,{recursive:true,force:true});
  },15000);
});
