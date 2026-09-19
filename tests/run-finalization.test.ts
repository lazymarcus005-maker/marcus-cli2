import { describe,it,expect } from "vitest";
import http from "node:http";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PiAgentKernel } from "../src/agent/kernel.js";
import { repositoryIdentity } from "../src/repository.js";

function reply(res:http.ServerResponse){
  res.writeHead(200,{"content-type":"text/event-stream"});
  res.write("data: "+JSON.stringify({id:"x",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:"ok"},finish_reason:"stop"}]})+"\n\n");
  res.write("data: [DONE]\n\n");res.end();
}

describe("durable run finalization",()=>{
  it("finishes the run even when ledger persistence fails",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-run-finalize-"));
    const server=http.createServer(async(req,res)=>{for await(const _ of req){};reply(res);});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    const port=(server.address() as any).port;process.env.MACUS_TEST_KEY="k";
    const cfg=structuredClone(DEFAULT_CONFIG);cfg.features.auto_compaction=false;
    cfg.models={default:"primary",providers:{mock:{protocol:"openai-compatible",base_url:"http://127.0.0.1:"+port+"/v1",api_key_env:"MACUS_TEST_KEY",profile:"p",model:"mock"}},aliases:{primary:"mock"}};
    cfg.model_profiles={p:{context_window:65536,max_output_tokens:1024,tokenizer:"conservative-byte-estimate"}};
    cfg.context.reserved_output_tokens=1024;cfg.context.safety_margin_tokens=512;
    const store=await StateStore.open(root);const sid=store.createSession(root,await repositoryIdentity(root));
    const kernel=new PiAgentKernel(root,cfg,sid,store,"primary");await kernel.create();
    const original=store.appendLedger.bind(store);
    (store as any).appendLedger=()=>{throw new Error("simulated ledger failure");};

    await expect(kernel.prompt("hello")).rejects.toThrow(/ledger failure/i);
    const run=store.db.prepare("SELECT status,finished_at FROM runs WHERE session_id=? ORDER BY started_at DESC LIMIT 1").get(sid) as any;
    expect(run.status).toBe("failed");expect(run.finished_at).toBeTruthy();

    (store as any).appendLedger=original;
    await kernel.dispose();store.close();delete process.env.MACUS_TEST_KEY;
    await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
  });
});
