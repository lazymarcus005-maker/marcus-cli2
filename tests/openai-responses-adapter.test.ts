import { describe,it,expect } from "vitest";
import http from "node:http";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PiAgentKernel } from "../src/agent/kernel.js";
import { repositoryIdentity } from "../src/repository.js";

function responsesSse(res:http.ServerResponse,events:unknown[]){
  res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache"});
  for(const event of events){
    const typed=event as {type:string};
    res.write(`event: ${typed.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

function toolResponse(){
  const call={id:"fc_1",type:"function_call",call_id:"call_1",name:"tasks",arguments:"{}"};
  return [
    {type:"response.created",response:{id:"resp_1",object:"response",created_at:1,status:"in_progress",model:"mock",output:[]}},
    {type:"response.output_item.added",output_index:0,item:{...call,arguments:""}},
    {type:"response.function_call_arguments.delta",item_id:"fc_1",output_index:0,delta:"{}"},
    {type:"response.function_call_arguments.done",item_id:"fc_1",output_index:0,arguments:"{}"},
    {type:"response.output_item.done",output_index:0,item:call},
    {type:"response.completed",response:{id:"resp_1",object:"response",created_at:1,status:"completed",model:"mock",output:[call]}}
  ];
}

function textResponse(){
  const message={id:"msg_2",type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:"done"}]};
  return [
    {type:"response.created",response:{id:"resp_2",object:"response",created_at:2,status:"in_progress",model:"mock",output:[]}},
    {type:"response.output_item.added",output_index:0,item:{...message,status:"in_progress",content:[]}},
    {type:"response.content_part.added",item_id:"msg_2",output_index:0,content_index:0,part:{type:"output_text",text:""}},
    {type:"response.output_text.delta",item_id:"msg_2",output_index:0,content_index:0,delta:"done"},
    {type:"response.output_text.done",item_id:"msg_2",output_index:0,content_index:0,text:"done"},
    {type:"response.output_item.done",output_index:0,item:message},
    {type:"response.completed",response:{id:"resp_2",object:"response",created_at:2,status:"completed",model:"mock",output:[message]}}
  ];
}

describe("OpenAI Responses API adapter",()=>{
  it("uses the Responses endpoint and resumes after a function call",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-responses-"));
    const requests:Array<{url:string|null;authorization:string|undefined;body:any}>=[];
    let server:http.Server|undefined;
    let store:StateStore|undefined;
    let kernel:PiAgentKernel|undefined;
    process.env.MACUS_RESPONSES_TEST_KEY="test-key";
    try{
      server=http.createServer(async(req,res)=>{
        let body="";for await(const chunk of req)body+=chunk;
        requests.push({url:req.url,authorization:req.headers.authorization,body:JSON.parse(body)});
        responsesSse(res,requests.length===1?toolResponse():textResponse());
      });
      await new Promise<void>(resolve=>server!.listen(0,"127.0.0.1",resolve));
      const port=(server.address() as any).port;
      const cfg=structuredClone(DEFAULT_CONFIG);
      cfg.models={default:"primary",providers:{zen:{protocol:"openai-responses",base_url:`http://127.0.0.1:${port}/v1`,api_key_env:"MACUS_RESPONSES_TEST_KEY",profile:"standard",model:"mock"}},aliases:{primary:"zen"}};
      cfg.model_profiles={standard:{context_window:65536,max_output_tokens:1024,tokenizer:"conservative-byte-estimate"}};
      cfg.context.reserved_output_tokens=1024;cfg.context.safety_margin_tokens=512;
      store=await StateStore.open(root);
      const sid=store.createSession(root,await repositoryIdentity(root));
      kernel=new PiAgentKernel(root,cfg,sid,store,"primary");
      await kernel.create();
      await kernel.prompt("Use the tasks tool, then say done.");
      await kernel.current.waitForIdle();

      expect(requests.length).toBeGreaterThanOrEqual(2);
      expect(requests.every(request=>request.url==="/v1/responses")).toBe(true);
      expect(requests.every(request=>request.authorization==="Bearer test-key")).toBe(true);
      expect(Array.isArray(requests[0].body.input)).toBe(true);
      expect(Array.isArray(requests[0].body.tools)).toBe(true);
      expect(requests[1].body.input.some((item:any)=>item.type==="function_call_output"&&item.call_id==="call_1")).toBe(true);
      expect(kernel.lastManifest?.estimatedPromptTokens).toBeGreaterThan(0);
    }finally{
      await kernel?.dispose();
      store?.close();
      delete process.env.MACUS_RESPONSES_TEST_KEY;
      if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
      await rm(root,{recursive:true,force:true});
    }
  },15000);
});
