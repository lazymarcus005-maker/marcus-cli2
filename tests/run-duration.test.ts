import { describe,it,expect } from "vitest";
import http from "node:http";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PiAgentKernel } from "../src/agent/kernel.js";
import { repositoryIdentity } from "../src/repository.js";

describe("run wall-clock deadline",()=>{
  it("aborts a hung provider and persists blocked status",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-run-deadline-"));
    let requests=0;
    const server=http.createServer(async(req,_res)=>{requests++;for await(const _ of req){};});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    const port=(server.address() as any).port;
    process.env.MACUS_TEST_KEY="k";
    const cfg=structuredClone(DEFAULT_CONFIG);
    cfg.run.max_duration_seconds=1;
    cfg.features.auto_compaction=false;
    cfg.models={default:"primary",providers:{mock:{protocol:"openai-compatible",base_url:"http://127.0.0.1:"+port+"/v1",api_key_env:"MACUS_TEST_KEY",profile:"p",model:"mock"}},aliases:{primary:"mock"}};
    cfg.model_profiles={p:{context_window:65536,max_output_tokens:1024,tokenizer:"conservative-byte-estimate"}};
    cfg.context.reserved_output_tokens=1024;cfg.context.safety_margin_tokens=512;
    const store=await StateStore.open(root);const sid=store.createSession(root,await repositoryIdentity(root));
    const kernel=new PiAgentKernel(root,cfg,sid,store,"primary");await kernel.create();

    const started=Date.now();
    await expect(kernel.prompt("hang")).rejects.toThrow(/duration exceeded/i);
    expect(Date.now()-started).toBeLessThan(2500);
    expect(requests).toBe(1);
    const run=store.db.prepare("SELECT status,finished_at FROM runs WHERE session_id=? ORDER BY started_at DESC LIMIT 1").get(sid) as any;
    expect(run.status).toBe("blocked");expect(run.finished_at).toBeTruthy();

    await kernel.dispose();store.close();delete process.env.MACUS_TEST_KEY;
    await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
  },7000);
});
