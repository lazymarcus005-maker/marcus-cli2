import http from "node:http";
import { performance } from "node:perf_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentSession, ModelRuntime, SessionManager, DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "./config.js";
import { StateStore } from "./storage/state.js";
import { PiAgentKernel } from "./agent/kernel.js";
import { repositoryIdentity } from "./repository.js";

function sendFinal(res:http.ServerResponse){
  res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache"});
  res.write("data: "+JSON.stringify({id:"b",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:"ok"},finish_reason:null}]})+"\n\n");
  res.write("data: "+JSON.stringify({id:"b",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"stop"}]})+"\n\n");
  res.write("data: [DONE]\n\n");res.end();
}

async function makeRuntime(baseUrl:string){
  const runtime=await ModelRuntime.create({refreshOnCreate:false});
  runtime.registerProvider("mock",{baseUrl,api:"openai-completions" as any,authHeader:true,models:[{
    id:"mock",name:"mock",api:"openai-completions" as any,reasoning:false,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:65536,maxTokens:1024
  }]});
  await runtime.setRuntimeApiKey("mock","benchmark-key");
  const model=runtime.getModel("mock","mock"); if(!model)throw new Error("mock model unavailable");
  return {runtime,model};
}

async function baseline(root:string,baseUrl:string):Promise<number>{
  const {runtime,model}=await makeRuntime(baseUrl);
  const agentDir=path.join(root,"pi-baseline"); const settings=SettingsManager.create(root,agentDir);
  const loader=new DefaultResourceLoader({cwd:root,agentDir,settingsManager:settings,noContextFiles:true,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true});
  await loader.reload();
  const {session}=await createAgentSession({cwd:root,agentDir,modelRuntime:runtime,model,resourceLoader:loader,settingsManager:settings,sessionManager:SessionManager.inMemory(root),noTools:"all"});
  const t=performance.now();await session.prompt("reply ok");await session.waitForIdle();const ms=performance.now()-t;session.dispose();return ms;
}

async function macus(root:string,baseUrl:string):Promise<number>{
  process.env.MACUS_BENCH_KEY="benchmark-key";
  const cfg=structuredClone(DEFAULT_CONFIG);
  cfg.models={default:"primary",providers:{mock:{protocol:"openai-compatible",base_url:baseUrl,api_key_env:"MACUS_BENCH_KEY",profile:"p",model:"mock"}},aliases:{primary:"mock"}};
  cfg.model_profiles={p:{context_window:65536,max_output_tokens:1024,tokenizer:"conservative-byte-estimate"}};cfg.context.reserved_output_tokens=1024;cfg.context.safety_margin_tokens=512;
  const store=await StateStore.open(root);const sid=store.createSession(root,await repositoryIdentity(root));const kernel=new PiAgentKernel(root,cfg,sid,store,"primary");await kernel.create();
  const t=performance.now();await kernel.prompt("reply ok");await kernel.current.waitForIdle();const ms=performance.now()-t;
  await kernel.dispose();store.close();delete process.env.MACUS_BENCH_KEY;return ms;
}

async function main(){
  let requests=0;
  const server=http.createServer(async(_req,res)=>{requests++;sendFinal(res);});
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as any).port;const baseUrl="http://127.0.0.1:"+port+"/v1";
  const root=await mkdtemp(path.join(os.tmpdir(),"macus-paired-"));const runs:any[]=[];
  try{
    for(let i=0;i<3;i++){
      if(i%2===0){runs.push({pair:i+1,kind:"pi",ms:await baseline(root,baseUrl)});runs.push({pair:i+1,kind:"macus",ms:await macus(root,baseUrl)});}
      else{runs.push({pair:i+1,kind:"macus",ms:await macus(root,baseUrl)});runs.push({pair:i+1,kind:"pi",ms:await baseline(root,baseUrl)});}
    }
    const vals=(kind:string)=>runs.filter(x=>x.kind===kind).map(x=>x.ms);
    const avg=(a:number[])=>a.reduce((x,y)=>x+y,0)/a.length;
    console.log(JSON.stringify({condition:"deterministic local mock; tool-less reply-ok microbenchmark",repetitions:3,requests,runs,summary:{piAvgMs:avg(vals("pi")),macusAvgMs:avg(vals("macus"))},limitations:["Not a real coding task","No external model latency/tokens","Does not establish quality equivalence"]},null,2));
  }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
