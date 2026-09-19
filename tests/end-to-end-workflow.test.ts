import { describe,it,expect } from "vitest";
import http from "node:http";
import { mkdtemp,rm,writeFile,readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PiAgentKernel } from "../src/agent/kernel.js";
import { repositoryIdentity } from "../src/repository.js";
import { buildReview } from "../src/review.js";

function sse(res:http.ServerResponse,chunks:unknown[]){
  res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache"});
  for(const c of chunks)res.write("data: "+JSON.stringify(c)+"\n\n");
  res.write("data: [DONE]\n\n");res.end();
}
function toolCall(id:string,name:string,args:unknown){
  return [
    {id:"c"+id,object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id,type:"function",function:{name,arguments:JSON.stringify(args)}}]},finish_reason:null}]},
    {id:"c"+id,object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"tool_calls"}]}
  ];
}
function textReply(text:string){
  return [
    {id:"done",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:text},finish_reason:null}]},
    {id:"done",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"stop"}]}
  ];
}

describe("Macus end-to-end coding workflow",()=>{
  it("runs discover -> tasks -> edit -> structured test -> review and resumes the Pi transcript",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-e2e-"));
    await writeFile(path.join(root,"app.mjs"),"export const value = 1;\n");
    await writeFile(path.join(root,"test.mjs"),"import assert from 'node:assert/strict'; import { value } from './app.mjs'; assert.equal(value, 2);\n");
    await writeFile(path.join(root,"package.json"),JSON.stringify({scripts:{"test:e2e":"node test.mjs && mkdir -p test-results && printf '<testsuite tests=\"1\" failures=\"0\" errors=\"0\" skipped=\"0\"></testsuite>' > test-results/e2e-junit.xml"}},null,2));

    const requests:any[]=[];
    let step=0;
    const server=http.createServer(async(req,res)=>{
      let body="";for await(const c of req)body+=c;
      const parsed=JSON.parse(body);requests.push(parsed);step++;
      if(step===1){sse(res,toolCall("search1","search_code",{query:"value",path:"app.mjs"}));return;}
      if(step===2){sse(res,toolCall("task1","task_create",{id:"t1",title:"Change value to 2"}));return;}
      if(step===3){sse(res,toolCall("task2","task_transition",{id:"t1",status:"in_progress"}));return;}
      if(step===4){sse(res,toolCall("read1","read_range",{path:"app.mjs",startLine:1,endLine:1}));return;}
      if(step===5){
        const readResult=parsed.messages.find((m:any)=>m.role==="tool"&&m.tool_call_id==="read1");
        const detail=JSON.parse(readResult.content);
        sse(res,toolCall("write1","write_file",{path:"app.mjs",content:"export const value = 2;\n",expectedHash:detail.hash}));return;
      }
      if(step===6){
        sse(res,toolCall("test1","run_test",{
          command:"npm run test:e2e",
          reportPath:"test-results/e2e-junit.xml",reportFormat:"junit"
        }));return;
      }
      if(step===7){sse(res,toolCall("task3","task_transition",{id:"t1",status:"completed"}));return;}
      if(step===8){sse(res,toolCall("review1","review",{}));return;}
      if(step===9){sse(res,textReply("workflow complete"));return;}
      sse(res,textReply("resume confirmed"));
    });
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    const port=(server.address() as any).port;
    process.env.MACUS_TEST_KEY="k";

    const cfg=structuredClone(DEFAULT_CONFIG);
    cfg.features.auto_compaction=false;
    cfg.models={default:"primary",providers:{mock:{protocol:"openai-compatible",base_url:"http://127.0.0.1:"+port+"/v1",api_key_env:"MACUS_TEST_KEY",profile:"p",model:"mock"}},aliases:{primary:"mock"}};
    cfg.model_profiles={p:{context_window:65536,max_output_tokens:1024,tokenizer:"conservative-byte-estimate"}};
    cfg.context.reserved_output_tokens=1024;cfg.context.safety_margin_tokens=512;
    const store=await StateStore.open(root);const sid=store.createSession(root,await repositoryIdentity(root));

    const first=new PiAgentKernel(root,cfg,sid,store,"primary");await first.create();first.authorize("all");
    await first.prompt("Change value to 2, test it, and review the work.");
    expect(await readFile(path.join(root,"app.mjs"),"utf8")).toContain("value = 2");
    expect(store.listTasks(sid).find(t=>t.id==="t1")?.status).toBe("completed");
    const evidence=store.db.prepare("SELECT status FROM test_evidence WHERE session_id=? ORDER BY created_at DESC LIMIT 1").get(sid) as any;
    expect(evidence.status).toBe("passed");
    const review=await buildReview(root,store,sid,true);
    expect(review.Tested[0]?.fresh).toBe(true);
    expect(review.RemainingRisk).toEqual([]);
    await first.dispose();

    const second=new PiAgentKernel(root,cfg,sid,store,"primary");await second.create();
    await second.prompt("Resume this session and confirm prior work.");
    const latest=JSON.stringify(requests.at(-1).messages);
    expect(latest).toContain("Change value to 2, test it, and review the work.");
    expect(latest).toContain("Resume this session and confirm prior work.");
    expect(requests.length).toBeGreaterThanOrEqual(10);

    await second.dispose();store.close();delete process.env.MACUS_TEST_KEY;
    await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
  },30000);
});
