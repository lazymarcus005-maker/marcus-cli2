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
function toolCall(){
  return [
    {id:"c1",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id:"cmd1",type:"function",function:{name:"run_command",arguments:JSON.stringify({command:"exit 7"})}}]},finish_reason:null}]},
    {id:"c1",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"tool_calls"}]}
  ];
}
const jevAnswers={
  failure_type:{type:"choice",choice:"code_bug",probabilities:{code_bug:.9,test_bug:.02,dependency:.02,environment:.01,configuration:.02,flaky:.01,unknown:.02},confidence:.9},
  retry_same_strategy:{type:"noul",noul:.1},needs_source_change:{type:"noul",noul:.9},likely_external_issue:{type:"noul",noul:.1}
};

describe("Jev kernel shadow integration",()=>{
  it("records a failure triage decision without changing the run outcome",async()=>{
    let mainCalls=0,jevCalls=0;
    const main=http.createServer(async(req,res)=>{for await(const _ of req){};mainCalls++;if(mainCalls===1)sse(res,toolCall());else sse(res,[{id:"done",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:"handled"},finish_reason:"stop"}]}]);});
    const jev=http.createServer(async(req,res)=>{for await(const _ of req){};jevCalls++;res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({model:"typesafe/jev-1.13-20260917",provider:"TypeSafe",answers:jevAnswers}));});
    await new Promise<void>(r=>main.listen(0,"127.0.0.1",r));await new Promise<void>(r=>jev.listen(0,"127.0.0.1",r));
    process.env.MACUS_MAIN_KEY="main";process.env.MACUS_TEST_JEV_KEY="jev";
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-jev-kernel-"));const cfg=structuredClone(DEFAULT_CONFIG);
    const mainPort=(main.address() as any).port,jevPort=(jev.address() as any).port;
    cfg.models={default:"primary",providers:{mock:{protocol:"openai-compatible",base_url:`http://127.0.0.1:${mainPort}/v1`,api_key_env:"MACUS_MAIN_KEY",profile:"p",model:"mock"}},aliases:{primary:"mock"}};
    cfg.model_profiles={p:{context_window:65536,max_output_tokens:1024,tokenizer:"conservative-byte-estimate"}};cfg.context.reserved_output_tokens=1024;cfg.context.safety_margin_tokens=512;cfg.features.auto_compaction=false;
    cfg.features.jev_harness=true;cfg.internal_models.jev.enabled=true;cfg.internal_models.jev.api_key_env="MACUS_TEST_JEV_KEY";cfg.internal_models.jev.base_url=`http://127.0.0.1:${jevPort}/api/alpha/decisions`;
    const store=await StateStore.open(root);const sid=store.createSession(root,await repositoryIdentity(root));const kernel=new PiAgentKernel(root,cfg,sid,store,"primary");
    await kernel.create();kernel.authorize("shell");await kernel.prompt("try the command and continue");await kernel.dispose();
    expect(mainCalls).toBe(2);expect(jevCalls).toBe(1);
    const events=store.listDecisionEvents(sid);
    expect(events).toHaveLength(1);expect(events[0].kind).toBe("failure_triage");expect(events[0].mode).toBe("shadow");expect(events[0].status).toBe("success");
    const run=store.db.prepare("SELECT status FROM runs WHERE session_id=? ORDER BY started_at DESC LIMIT 1").get(sid) as any;
    expect(run.status).toBe("completed");
    delete process.env.MACUS_MAIN_KEY;delete process.env.MACUS_TEST_JEV_KEY;store.close();await rm(root,{recursive:true,force:true});await new Promise<void>(r=>main.close(()=>r()));await new Promise<void>(r=>jev.close(()=>r()));
  },10000);
});
