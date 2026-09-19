import { describe,it,expect } from "vitest";
import http from "node:http";
import { mkdtemp,writeFile,readFile,rm } from "node:fs/promises";
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
function tool(id:string,name:string,args:unknown){
  return [
    {id:"c"+id,object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id,type:"function",function:{name,arguments:JSON.stringify(args)}}]},finish_reason:null}]},
    {id:"c"+id,object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"tool_calls"}]}
  ];
}
function done(){
  return [{id:"done",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:"done"},finish_reason:"stop"}]}];
}
function config(port:number){
  const cfg=structuredClone(DEFAULT_CONFIG);cfg.features.auto_compaction=false;
  cfg.models={default:"primary",providers:{mock:{protocol:"openai-compatible",base_url:"http://127.0.0.1:"+port+"/v1",api_key_env:"MACUS_TEST_KEY",profile:"p",model:"mock"}},aliases:{primary:"mock"}};
  cfg.model_profiles={p:{context_window:65536,max_output_tokens:1024,tokenizer:"conservative-byte-estimate"}};
  cfg.context.reserved_output_tokens=1024;cfg.context.safety_margin_tokens=512;return cfg;
}

describe("search-source freshness and manifest accounting",()=>{
  it("omits stale search source after an edit",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-search-fresh-"));await writeFile(path.join(root,"a.ts"),"export const OLD_MARKER = 1;\n");
    const requests:any[]=[];let step=0;
    const server=http.createServer(async(req,res)=>{
      let body="";for await(const c of req)body+=c;const parsed=JSON.parse(body);requests.push(parsed);step++;
      const tools=(parsed.messages??[]).filter((m:any)=>m.role==="tool");
      if(step===1){sse(res,tool("search1","search_code",{query:"OLD_MARKER",path:"a.ts"}));return;}
      if(step===2){sse(res,tool("read1","read_range",{path:"a.ts",startLine:1,endLine:1}));return;}
      if(step===3){
        const rr=tools.find((m:any)=>m.tool_call_id==="read1");const d=JSON.parse(rr.content);
        sse(res,tool("write1","write_file",{path:"a.ts",content:"export const NEW_MARKER = 2;\n",expectedHash:d.hash}));return;
      }
      sse(res,done());
    });
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as any).port;process.env.MACUS_TEST_KEY="k";
    const store=await StateStore.open(root);const sid=store.createSession(root,await repositoryIdentity(root));const kernel=new PiAgentKernel(root,config(port),sid,store,"primary");
    await kernel.create();kernel.authorize("edits");await kernel.prompt("replace marker");
    expect(await readFile(path.join(root,"a.ts"),"utf8")).toContain("NEW_MARKER");
    const last=requests.at(-1);
    const search=last.messages.find((m:any)=>m.role==="tool"&&m.tool_call_id==="search1");
    expect(String(search?.content)).not.toContain("OLD_MARKER");
    expect(String(search?.content)).toContain("superseded_source");
    expect(kernel.lastManifest?.omissions.some(x=>x.reason==="superseded_source")).toBe(true);
    await kernel.dispose();store.close();delete process.env.MACUS_TEST_KEY;await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
  },15000);

  it("classifies fresh search source in the request manifest",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-search-manifest-"));await writeFile(path.join(root,"a.ts"),"export const MARKER = 1;\n");
    let step=0;
    const server=http.createServer(async(req,res)=>{for await(const _ of req){};step++;if(step===1)sse(res,tool("search1","search_code",{query:"MARKER",path:"a.ts"}));else sse(res,done());});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as any).port;process.env.MACUS_TEST_KEY="k";
    const store=await StateStore.open(root);const sid=store.createSession(root,await repositoryIdentity(root));const kernel=new PiAgentKernel(root,config(port),sid,store,"primary");
    await kernel.create();await kernel.prompt("find marker");
    expect((kernel.lastManifest?.categories.search_results??0)).toBeGreaterThan(0);
    expect(kernel.lastManifest?.includedFragments.some(f=>f.source.includes("a.ts"))).toBe(true);
    await kernel.dispose();store.close();delete process.env.MACUS_TEST_KEY;await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
  },10000);
});
