import { describe,it,expect } from "vitest";
import http from "node:http";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PiAgentKernel } from "../src/agent/kernel.js";
import { repositoryIdentity } from "../src/repository.js";
import { readTranscriptCorrelation } from "../src/storage/transcript.js";

function sse(res:http.ServerResponse,text:string){
  res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache"});
  res.write("data: "+JSON.stringify({id:"x",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:text},finish_reason:null}]})+"\n\n");
  res.write("data: "+JSON.stringify({id:"x",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"stop"}]})+"\n\n");
  res.write("data: [DONE]\n\n");res.end();
}

describe("checkpoint transcript alignment",()=>{
  it("branches the Pi transcript back to a checkpoint leaf before continuing",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-checkpoint-transcript-"));const requests:any[]=[];
    const server=http.createServer(async(req,res)=>{let body="";for await(const c of req)body+=c;requests.push(JSON.parse(body));sse(res,"ack-"+requests.length);});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as any).port;process.env.MACUS_TEST_KEY="k";
    const cfg=structuredClone(DEFAULT_CONFIG);cfg.features.auto_compaction=false;
    cfg.models={default:"primary",providers:{mock:{protocol:"openai-compatible",base_url:"http://127.0.0.1:"+port+"/v1",api_key_env:"MACUS_TEST_KEY",profile:"p",model:"mock"}},aliases:{primary:"mock"}};
    cfg.model_profiles={p:{context_window:65536,max_output_tokens:1024,tokenizer:"conservative-byte-estimate"}};cfg.context.reserved_output_tokens=1024;cfg.context.safety_margin_tokens=512;
    const store=await StateStore.open(root);const sid=store.createSession(root,await repositoryIdentity(root));
    const kernel=new PiAgentKernel(root,cfg,sid,store,"primary");await kernel.create();
    await kernel.prompt("first-message");const checkpointRef=kernel.transcriptRef!;
    await kernel.prompt("second-message");expect(kernel.transcriptRef).not.toBe(checkpointRef);
    expect(readTranscriptCorrelation(root,sid,checkpointRef).entryIds.has(checkpointRef)).toBe(true);

    await kernel.branchTranscript(checkpointRef);
    expect(kernel.transcriptRef).toBe(checkpointRef);
    await kernel.prompt("third-message");
    const latest=JSON.stringify(requests.at(-1).messages);
    expect(latest).toContain("first-message");expect(latest).toContain("third-message");expect(latest).not.toContain("second-message");

    await kernel.dispose();store.close();delete process.env.MACUS_TEST_KEY;await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
  },15000);
});
