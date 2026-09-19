import { describe,it,expect } from "vitest";
import http from "node:http";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PiAgentKernel } from "../src/agent/kernel.js";
import { repositoryIdentity } from "../src/repository.js";

function sse(res:http.ServerResponse, chunks:unknown[]){
  res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache"});
  for(const c of chunks) res.write("data: "+JSON.stringify(c)+"\n\n");
  res.write("data: [DONE]\n\n"); res.end();
}

describe("Pi adapter integration",()=>{
  it("intercepts every provider request across a nested tool turn",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-pi-"));
    const seen:any[]=[];
    const server=http.createServer(async(req,res)=>{
      if(req.method!=="POST"){res.writeHead(404);res.end();return;}
      let body=""; for await(const c of req) body+=c;
      seen.push({url:req.url,auth:req.headers.authorization,body:JSON.parse(body)});
      const hasToolResult=JSON.parse(body).messages?.some((m:any)=>m.role==="tool");
      if(!hasToolResult){
        sse(res,[
          {id:"c1",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id:"call_1",type:"function",function:{name:"tasks",arguments:"{}"}}]},finish_reason:null}]},
          {id:"c1",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"tool_calls"}]}
        ]);
      }else{
        sse(res,[
          {id:"c2",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:"done"},finish_reason:null}]},
          {id:"c2",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"stop"}]}
        ]);
      }
    });
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    const port=(server.address() as any).port;
    process.env.MACUS_TEST_KEY="secret-test-key";
    const cfg=structuredClone(DEFAULT_CONFIG);
    cfg.models={default:"primary",providers:{mock:{protocol:"openai-compatible",base_url:"http://127.0.0.1:"+port+"/v1",api_key_env:"MACUS_TEST_KEY",profile:"standard",model:"mock"}},aliases:{primary:"mock"}};
    cfg.model_profiles={standard:{context_window:65536,max_output_tokens:1024,tokenizer:"conservative-byte-estimate"}};
    cfg.context.reserved_output_tokens=1024; cfg.context.safety_margin_tokens=512;
    const store=await StateStore.open(root); const sid=store.createSession(root,await repositoryIdentity(root));
    const kernel=new PiAgentKernel(root,cfg,sid,store,"primary");
    await kernel.create();
    await kernel.prompt("Use the tasks tool, then say done.");
    await kernel.current.waitForIdle();
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.every(x=>x.auth==="Bearer secret-test-key")).toBe(true);
    expect(seen.some(x=>x.body.messages?.some((m:any)=>m.role==="tool"))).toBe(true);
    expect(kernel.lastManifest?.estimatedPromptTokens).toBeGreaterThan(0);
    await kernel.dispose(); store.close(); delete process.env.MACUS_TEST_KEY;
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(root,{recursive:true,force:true});
  },15000);
});
