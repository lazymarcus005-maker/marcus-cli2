import { describe,it,expect } from "vitest";
import http from "node:http";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PiAgentKernel } from "../src/agent/kernel.js";
import { repositoryIdentity } from "../src/repository.js";

describe("provider request budget hard gate",()=>{
  it("aborts before network dispatch when the effective request exceeds prompt capacity",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-budget-gate-"));
    let requests=0;
    const server=http.createServer(async(_req,res)=>{requests++;res.writeHead(500);res.end();});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    const port=(server.address() as any).port;
    process.env.MACUS_TEST_KEY="k";
    const cfg=structuredClone(DEFAULT_CONFIG);
    cfg.features.auto_compaction=false;
    cfg.models={default:"primary",providers:{mock:{protocol:"openai-compatible",base_url:"http://127.0.0.1:"+port+"/v1",api_key_env:"MACUS_TEST_KEY",profile:"tiny",model:"mock"}},aliases:{primary:"mock"}};
    cfg.model_profiles={tiny:{context_window:2048,max_output_tokens:256,tokenizer:"conservative-byte-estimate"}};
    cfg.context.reserved_output_tokens=256;cfg.context.safety_margin_tokens=128;
    const store=await StateStore.open(root);const sid=store.createSession(root,await repositoryIdentity(root));
    const kernel=new PiAgentKernel(root,cfg,sid,store,"primary");await kernel.create();

    await expect(kernel.prompt("x".repeat(10000))).rejects.toThrow(/exceeds prompt capacity/i);
    expect(requests).toBe(0);

    await kernel.dispose();store.close();delete process.env.MACUS_TEST_KEY;
    await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
  },15000);
});
