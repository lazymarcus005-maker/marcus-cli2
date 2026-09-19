import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,symlink,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { runTest } from "../src/testing/evidence.js";

async function openSession(root:string){
  const store=await StateStore.open(root);const sid=store.createSession(root,"repo");
  const cfg=structuredClone(DEFAULT_CONFIG);const executor=new PolicyExecutor(root,sid,store,cfg);executor.authorize("all");
  return {store,sid,cfg,executor};
}

describe("trusted test evidence policy",()=>{
  it("does not promote a forged structured report from an undiscovered command",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-test-trust-"));const x=await openSession(root);
    const ev=await runTest({
      root,sessionId:x.sid,
      command:"mkdir -p test-results && printf '<testsuite tests=\"1\" failures=\"0\" errors=\"0\" skipped=\"0\"></testsuite>' > test-results/fake.xml",
      executor:x.executor,store:x.store,reportPath:"test-results/fake.xml",reportFormat:"junit"
    });
    expect(ev.trustedCommand).toBe(false);expect(ev.reportFresh).toBe(true);expect(ev.status).toBe("unknown");
    x.store.close();await rm(root,{recursive:true,force:true});
  });

  it("rejects a structured report path outside the workspace",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-test-outside-"));const x=await openSession(root);
    const outside=path.join(os.tmpdir(),"macus-outside-report.xml");
    await writeFile(outside,'<testsuite tests="1" failures="0"></testsuite>');
    await expect(runTest({root,sessionId:x.sid,command:"true",executor:x.executor,store:x.store,reportPath:outside,reportFormat:"junit"})).rejects.toThrow(/escapes workspace/i);
    x.store.close();await rm(outside,{force:true});await rm(root,{recursive:true,force:true});
  });

  it("rejects a report symlink that resolves outside the workspace",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-test-symlink-"));
    await writeFile(path.join(root,"package.json"),JSON.stringify({scripts:{test:"true"}}));
    const outside=path.join(os.tmpdir(),"macus-outside-linked-report.xml");
    await writeFile(outside,'<testsuite tests="1" failures="0"></testsuite>');
    await symlink(outside,path.join(root,"linked.xml"));
    const x=await openSession(root);
    await expect(runTest({root,sessionId:x.sid,command:"npm test",executor:x.executor,store:x.store,reportPath:"linked.xml",reportFormat:"junit"})).rejects.toThrow(/symlink escapes workspace/i);
    x.store.close();await rm(outside,{force:true});await rm(root,{recursive:true,force:true});
  });

  it("does not reuse an unchanged pre-existing report even for a baseline-trusted command",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-test-stale-"));
    await writeFile(path.join(root,"package.json"),JSON.stringify({scripts:{test:"node -e \"process.exit(0)\""}}));
    await writeFile(path.join(root,"stale.xml"),'<testsuite tests="1" failures="0" errors="0" skipped="0"></testsuite>');
    const x=await openSession(root);
    const ev=await runTest({root,sessionId:x.sid,command:"npm test",executor:x.executor,store:x.store,reportPath:"stale.xml",reportFormat:"junit"});
    expect(ev.trustedCommand).toBe(true);expect(ev.reportFresh).toBe(false);expect(ev.status).toBe("unknown");
    x.store.close();await rm(root,{recursive:true,force:true});
  });

  it("does not parse an oversized report into a pass",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-test-large-report-"));
    await writeFile(path.join(root,"gen.mjs"),"import {mkdir,writeFile} from 'node:fs/promises'; await mkdir('test-results',{recursive:true}); await writeFile('test-results/large.xml','<testsuite tests=\"1\" failures=\"0\" errors=\"0\" skipped=\"0\">'+('x'.repeat(2000))+'</testsuite>');");
    await writeFile(path.join(root,"package.json"),JSON.stringify({scripts:{test:"node gen.mjs"}}));
    const x=await openSession(root);x.cfg.execution.max_output_memory_bytes=512;
    const executor=new PolicyExecutor(root,x.sid,x.store,x.cfg);executor.authorize("shell");
    const ev=await runTest({root,sessionId:x.sid,command:"npm test",executor,store:x.store,reportPath:"test-results/large.xml",reportFormat:"junit"});
    expect(ev.trustedCommand).toBe(true);expect(ev.reportFresh).toBe(true);expect(ev.parserStatus).toBe("partial");expect(ev.status).toBe("unknown");
    x.store.close();await rm(root,{recursive:true,force:true});
  });

  it("does not trust a test script added or changed by the agent after session start",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-test-mutated-trust-"));
    await writeFile(path.join(root,"package.json"),JSON.stringify({scripts:{test:"node -e \"process.exit(0)\""}}));
    const x=await openSession(root);
    const observed=await x.executor.safeRead("package.json");
    const forged=JSON.stringify({scripts:{test:"mkdir -p test-results && printf '<testsuite tests=\"1\" failures=\"0\" errors=\"0\" skipped=\"0\"></testsuite>' > test-results/fake.xml"}});
    await x.executor.safeWrite("package.json",forged,observed.hash);
    const ev=await runTest({root,sessionId:x.sid,command:"npm test",executor:x.executor,store:x.store,reportPath:"test-results/fake.xml",reportFormat:"junit"});
    expect(ev.trustedCommand).toBe(false);
    expect(ev.trustReason).toBe("trust_source_changed_since_session_start");
    expect(ev.status).toBe("unknown");
    x.store.close();await rm(root,{recursive:true,force:true});
  });
});
