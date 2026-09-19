import { describe,it,expect } from "vitest";
import http from "node:http";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { JevDecisionEngine } from "../src/decision/engine.js";
import { questionsFor } from "../src/decision/questions.js";

describe("Jev state limits",()=>{
  it("skips oversized decision state without making a network call",async()=>{
    let calls=0;const server=http.createServer((_q,r)=>{calls++;r.end();});await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as any).port;
    process.env.MACUS_TEST_JEV_KEY="k";const root=await mkdtemp(path.join(os.tmpdir(),"macus-jev-size-"));const store=await StateStore.open(root);const sid=store.createSession(root,"repo");const run=store.createRun(sid);
    const cfg=structuredClone(DEFAULT_CONFIG);cfg.features.jev_harness=true;cfg.internal_models.jev.enabled=true;cfg.internal_models.jev.api_key_env="MACUS_TEST_JEV_KEY";cfg.internal_models.jev.base_url=`http://127.0.0.1:${port}`;cfg.internal_models.jev.max_state_tokens=10;
    const engine=new JevDecisionEngine(cfg,store,sid,()=>run);
    await expect(engine.evaluate({kind:"review_risk",schemaVersion:1,state:{huge:"x".repeat(1000)},questions:questionsFor("review_risk")},{sessionId:sid,runId:run,eventId:"large"})).resolves.toBeNull();
    expect(calls).toBe(0);expect(store.listDecisionEvents(sid)[0].status).toBe("skipped_oversize");
    delete process.env.MACUS_TEST_JEV_KEY;store.close();await rm(root,{recursive:true,force:true});await new Promise<void>(r=>server.close(()=>r()));
  });
});
