import { describe,it,expect } from "vitest";
import http from "node:http";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PiAgentKernel } from "../src/agent/kernel.js";
import { repositoryIdentity } from "../src/repository.js";

function sse(res:http.ServerResponse,text:string){
  res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache"});
  res.write("data: "+JSON.stringify({id:"x",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:text},finish_reason:null}]})+"\n\n");
  res.write("data: "+JSON.stringify({id:"x",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"stop"}]})+"\n\n");
  res.write("data: [DONE]\n\n"); res.end();
}

describe("compaction cancellation",()=>{
  it("aborts an in-flight manual compaction and keeps the session usable",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-compact-cancel-"));
    let requestCount=0; let compactionDisconnected=false;
    const server=http.createServer(async(req,res)=>{
      let body=""; for await(const c of req) body+=c;
      requestCount++;
      if(requestCount<=2){ sse(res,"response-"+requestCount); return; }
      req.on("aborted",()=>{compactionDisconnected=true;});
      res.on("close",()=>{if(!res.writableEnded) compactionDisconnected=true;});
      // Intentionally do not answer the compaction request. AbortSignal should close it.
    });
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    const port=(server.address() as any).port;
    process.env.MACUS_TEST_KEY="k";
    const cfg=structuredClone(DEFAULT_CONFIG);
    cfg.models={default:"primary",providers:{mock:{protocol:"openai-compatible",base_url:"http://127.0.0.1:"+port+"/v1",api_key_env:"MACUS_TEST_KEY",profile:"p",model:"mock"}},aliases:{primary:"mock"}};
    cfg.model_profiles={p:{context_window:262144,max_output_tokens:512,tokenizer:"conservative-byte-estimate"}};
    cfg.context.reserved_output_tokens=512; cfg.context.safety_margin_tokens=128;
    const store=await StateStore.open(root); const sid=store.createSession(root,await repositoryIdentity(root));
    const kernel=new PiAgentKernel(root,cfg,sid,store,"primary"); await kernel.create();
    await kernel.prompt("first large turn\n"+"x".repeat(100000)); await kernel.current.waitForIdle();
    await kernel.prompt("second large turn\n"+"y".repeat(100000)); await kernel.current.waitForIdle();

    const compactPromise=kernel.compact("Preserve the user goal and unresolved work.");
    for(let i=0;i<50 && requestCount<3;i++) await new Promise(r=>setTimeout(r,10));
    expect(requestCount).toBeGreaterThanOrEqual(3);
    const checkpointCount=Number((store.db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE session_id=? AND committed=1").get(sid) as any).n);
    const ledgerCount=Number((store.db.prepare("SELECT COUNT(*) AS n FROM ledger_revisions WHERE session_id=?").get(sid) as any).n);
    expect(checkpointCount).toBeGreaterThan(0);
    expect(ledgerCount).toBeGreaterThan(0);
    await kernel.abort();
    await expect(compactPromise).rejects.toBeTruthy();
    for(let i=0;i<50 && !compactionDisconnected;i++) await new Promise(r=>setTimeout(r,10));
    expect(compactionDisconnected).toBe(true);

    await kernel.dispose(); store.close(); delete process.env.MACUS_TEST_KEY;
    await new Promise<void>(r=>server.close(()=>r())); await rm(root,{recursive:true,force:true});
  },15000);
});
