import { describe,it,expect } from "vitest";
import http from "node:http";
import { mkdtemp,rm,writeFile,readFile } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PiAgentKernel } from "../src/agent/kernel.js";
import { repositoryIdentity } from "../src/repository.js";

function sse(res:http.ServerResponse,chunks:unknown[]){
  res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache"});
  for(const c of chunks)res.write("data: "+JSON.stringify(c)+"\n\n");
  res.write("data: [DONE]\n\n");res.end();
}
function toolChunks(id:string,name:string,args:any){
  return [
    {id:"c",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id,type:"function",function:{name,arguments:JSON.stringify(args)}}]},finish_reason:null}]},
    {id:"c",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"tool_calls"}]}
  ];
}

describe("effective context runtime",()=>{
  it("replaces superseded source content while retaining tool protocol messages",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-ctx-int-")); await writeFile(path.join(root,"a.ts"),"export const x = 1;\n");
    const requests:any[]=[];
    const server=http.createServer(async(req,res)=>{
      let body="";for await(const c of req)body+=c;const parsed=JSON.parse(body);requests.push(parsed);
      const tools=(parsed.messages??[]).filter((m:any)=>m.role==="tool");
      if(tools.length===0){sse(res,toolChunks("read1","read_range",{path:"a.ts",startLine:1,endLine:1}));return;}
      const writeResult=tools.find((m:any)=>m.tool_call_id==="write1");
      if(!writeResult){
        const readResult=tools.find((m:any)=>m.tool_call_id==="read1");
        const detail=JSON.parse(readResult.content);
        sse(res,toolChunks("write1","write_file",{path:"a.ts",content:"export const x = 2;\n",expectedHash:detail.hash}));return;
      }
      sse(res,[
        {id:"done",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:"done"},finish_reason:null}]},
        {id:"done",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"stop"}]}
      ]);
    });
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r)); const port=(server.address() as any).port;
    process.env.MACUS_TEST_KEY="k";
    const cfg=structuredClone(DEFAULT_CONFIG);
    cfg.models={default:"primary",providers:{mock:{protocol:"openai-compatible",base_url:"http://127.0.0.1:"+port+"/v1",api_key_env:"MACUS_TEST_KEY",profile:"p",model:"mock"}},aliases:{primary:"mock"}};
    cfg.model_profiles={p:{context_window:65536,max_output_tokens:1024,tokenizer:"conservative-byte-estimate"}};
    cfg.context.reserved_output_tokens=1024;cfg.context.safety_margin_tokens=512;
    const store=await StateStore.open(root);const sid=store.createSession(root,await repositoryIdentity(root));
    const kernel=new PiAgentKernel(root,cfg,sid,store,"primary");await kernel.create();kernel.authorize("edits");
    await kernel.prompt("update x");await kernel.current.waitForIdle();
    expect(await readFile(path.join(root,"a.ts"),"utf8")).toContain("2");
    expect(requests.length).toBeGreaterThanOrEqual(3);
    const third=requests.at(-1);
    const oldRead=third.messages.find((m:any)=>m.role==="tool"&&m.tool_call_id==="read1");
    expect(oldRead.content).toContain("superseded_source");
    expect(kernel.lastManifest?.omissions.some(x=>x.reason==="superseded_source")).toBe(true);
    await kernel.dispose();store.close();delete process.env.MACUS_TEST_KEY;
    await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
  },15000);
});
