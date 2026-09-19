import { describe,it,expect } from "vitest";
import http from "node:http";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PiAgentKernel } from "../src/agent/kernel.js";
import { repositoryIdentity } from "../src/repository.js";

function sse(res:http.ServerResponse,chunks:unknown[]){
  res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache"});
  for(const c of chunks)res.write("data: "+JSON.stringify(c)+"\n\n");
  res.write("data: [DONE]\n\n");res.end();
}
function toolCall(id:string,name:string,args:unknown){
  return [
    {id:"c",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id,type:"function",function:{name,arguments:JSON.stringify(args)}}]},finish_reason:null}]},
    {id:"c",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"tool_calls"}]}
  ];
}

describe("runtime harness enforcement",()=>{
  it("blocks a provider turn beyond the configured run limit and persists blocked status",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-harness-runtime-"));
    let requests=0;
    const server=http.createServer(async(req,res)=>{
      let body="";for await(const c of req)body+=c;requests++;
      if(requests===1){sse(res,toolCall("tasks1","tasks",{}));return;}
      sse(res,[{id:"done",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:"should-not-arrive"},finish_reason:"stop"}]}]);
    });
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    const port=(server.address() as any).port;
    process.env.MACUS_TEST_KEY="k";
    const cfg=structuredClone(DEFAULT_CONFIG);
    cfg.run.max_model_turns=1;
    cfg.models={default:"primary",providers:{mock:{protocol:"openai-compatible",base_url:"http://127.0.0.1:"+port+"/v1",api_key_env:"MACUS_TEST_KEY",profile:"p",model:"mock"}},aliases:{primary:"mock"}};
    cfg.model_profiles={p:{context_window:65536,max_output_tokens:1024,tokenizer:"conservative-byte-estimate"}};
    cfg.context.reserved_output_tokens=1024;cfg.context.safety_margin_tokens=512;
    const store=await StateStore.open(root);const sid=store.createSession(root,await repositoryIdentity(root));
    const kernel=new PiAgentKernel(root,cfg,sid,store,"primary");await kernel.create();

    await expect(kernel.prompt("use tasks repeatedly")).rejects.toThrow(/run limit/i);
    expect(requests).toBe(1);
    const run=store.db.prepare("SELECT status FROM runs WHERE session_id=? ORDER BY started_at DESC LIMIT 1").get(sid) as any;
    expect(run.status).toBe("blocked");

    await kernel.dispose();store.close();delete process.env.MACUS_TEST_KEY;
    await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
  },15000);
});
