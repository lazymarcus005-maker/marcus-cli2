import { describe,it,expect } from "vitest";
import http from "node:http";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { JevDecisionEngine,createJevDecisionEngine } from "../src/decision/engine.js";
import { questionsFor } from "../src/decision/questions.js";

function enabledConfig(port:number){
  const c=structuredClone(DEFAULT_CONFIG);
  c.features.jev_harness=true;
  c.internal_models.jev.enabled=true;
  c.internal_models.jev.api_key_env="MACUS_TEST_JEV_KEY";
  c.internal_models.jev.base_url=`http://127.0.0.1:${port}/api/alpha/decisions`;
  c.internal_models.jev.timeout_ms=150;
  return c;
}

async function storeFixture(prefix:string){
  const root=await mkdtemp(path.join(os.tmpdir(),prefix));const store=await StateStore.open(root);const sid=store.createSession(root,"repo");return {root,store,sid};
}

const goodAnswers={
  failure_type:{type:"choice",choice:"code_bug",probabilities:{code_bug:.9,test_bug:.02,dependency:.02,environment:.01,configuration:.02,flaky:.01,unknown:.02},confidence:.9},
  retry_same_strategy:{type:"noul",noul:.1},
  needs_source_change:{type:"noul",noul:.9},
  likely_external_issue:{type:"noul",noul:.1},
};

describe("Jev decision engine",()=>{
  it("performs zero network calls when disabled",async()=>{
    let requests=0;const server=http.createServer((_q,r)=>{requests++;r.end();});await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    const port=(server.address() as any).port;const x=await storeFixture("macus-jev-disabled-");
    const c=structuredClone(DEFAULT_CONFIG);c.internal_models.jev.base_url=`http://127.0.0.1:${port}`;
    expect(createJevDecisionEngine(c,x.store,x.sid,()=>undefined)).toBeUndefined();
    expect(requests).toBe(0);
    x.store.close();await rm(x.root,{recursive:true,force:true});await new Promise<void>(r=>server.close(()=>r()));
  });

  it("redacts configured secrets, persists typed decisions, and records resolved model",async()=>{
    let body:any;const server=http.createServer(async(req,res)=>{let raw="";for await(const c of req)raw+=c;body=JSON.parse(raw);res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({model:"typesafe/jev-1.13-20260917",provider:"TypeSafe",answers:goodAnswers,usage:{input_tokens:20,output_tokens:4,cost:.000001}}));});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as any).port;
    process.env.MACUS_TEST_JEV_KEY="TOP-SECRET-JEV-KEY";const x=await storeFixture("macus-jev-engine-");let currentRun=x.store.createRun(x.sid);
    const engine=new JevDecisionEngine(enabledConfig(port),x.store,x.sid,()=>currentRun);
    const result=await engine.evaluate({kind:"failure_triage",schemaVersion:1,state:{diagnostic:"failed with TOP-SECRET-JEV-KEY",api_key:"bad"},questions:questionsFor("failure_triage")},{sessionId:x.sid,runId:currentRun,eventId:"event-1"});
    expect(result?.model).toBe("typesafe/jev-1.13-20260917");
    expect(JSON.stringify(body.state)).not.toContain("TOP-SECRET-JEV-KEY");
    expect(JSON.stringify(body.state)).toContain("[REDACTED");
    const rows=x.store.listDecisionEvents(x.sid);
    expect(rows[0].status).toBe("success");expect(rows[0].model).toBe("typesafe/jev-1.13-20260917");
    expect(rows[0].request_metadata).not.toContain("TOP-SECRET-JEV-KEY");
    delete process.env.MACUS_TEST_JEV_KEY;x.store.close();await rm(x.root,{recursive:true,force:true});await new Promise<void>(r=>server.close(()=>r()));
  });

  it("soft-fails timeout and malformed responses",async()=>{
    process.env.MACUS_TEST_JEV_KEY="k";
    const slow=http.createServer(async(req,res)=>{for await(const _ of req){};setTimeout(()=>{if(!res.headersSent){res.writeHead(200,{"content-type":"application/json"});res.end("{}");}},500);});
    await new Promise<void>(r=>slow.listen(0,"127.0.0.1",r));let port=(slow.address() as any).port;
    let x=await storeFixture("macus-jev-timeout-");let run=x.store.createRun(x.sid);let cfg=enabledConfig(port);cfg.internal_models.jev.timeout_ms=100;
    const timed=new JevDecisionEngine(cfg,x.store,x.sid,()=>run);
    await expect(timed.evaluate({kind:"failure_triage",schemaVersion:1,state:{x:1},questions:questionsFor("failure_triage")},{sessionId:x.sid,runId:run,eventId:"timeout"})).resolves.toBeNull();
    expect(x.store.listDecisionEvents(x.sid)[0].status).toBe("timeout");
    x.store.close();await rm(x.root,{recursive:true,force:true});await new Promise<void>(r=>slow.close(()=>r()));

    const malformed=http.createServer(async(req,res)=>{for await(const _ of req){};res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({model:"typesafe/jev-1.13",answers:{}}));});
    await new Promise<void>(r=>malformed.listen(0,"127.0.0.1",r));port=(malformed.address() as any).port;
    x=await storeFixture("macus-jev-malformed-");run=x.store.createRun(x.sid);cfg=enabledConfig(port);
    const bad=new JevDecisionEngine(cfg,x.store,x.sid,()=>run);
    await expect(bad.evaluate({kind:"failure_triage",schemaVersion:1,state:{x:1},questions:questionsFor("failure_triage")},{sessionId:x.sid,runId:run,eventId:"bad"})).resolves.toBeNull();
    expect(x.store.listDecisionEvents(x.sid)[0].status).toBe("parse_error");
    x.store.close();await rm(x.root,{recursive:true,force:true});await new Promise<void>(r=>malformed.close(()=>r()));
    delete process.env.MACUS_TEST_JEV_KEY;
  });

  it("marks a delayed response stale when the active run changed",async()=>{
    process.env.MACUS_TEST_JEV_KEY="k";const server=http.createServer(async(req,res)=>{for await(const _ of req){};setTimeout(()=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({model:"typesafe/jev-1.13",answers:goodAnswers}));},80);});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as any).port;const x=await storeFixture("macus-jev-stale-");
    const run1=x.store.createRun(x.sid);let current=run1;const engine=new JevDecisionEngine(enabledConfig(port),x.store,x.sid,()=>current);
    const pending=engine.evaluate({kind:"failure_triage",schemaVersion:1,state:{x:1},questions:questionsFor("failure_triage")},{sessionId:x.sid,runId:run1,eventId:"stale"});
    current=x.store.createRun(x.sid);
    await expect(pending).resolves.toBeNull();
    expect(x.store.listDecisionEvents(x.sid)[0].status).toBe("stale");
    delete process.env.MACUS_TEST_JEV_KEY;x.store.close();await rm(x.root,{recursive:true,force:true});await new Promise<void>(r=>server.close(()=>r()));
  });
});
