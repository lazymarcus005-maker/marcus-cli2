import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { runTest } from "../src/testing/evidence.js";
import { buildReview } from "../src/review.js";
import { TaskEngine } from "../src/workflow/tasks.js";
const exec=promisify(execFile);

async function gitFixture(prefix:string){
  const root=await mkdtemp(path.join(os.tmpdir(),prefix));
  await exec("git",["init","-b","main"],{cwd:root});await exec("git",["config","user.email","x@y"],{cwd:root});await exec("git",["config","user.name","x"],{cwd:root});
  await writeFile(path.join(root,"a.txt"),"same\n");
  await writeFile(path.join(root,"package.json"),JSON.stringify({scripts:{test:"mkdir -p test-results && printf '<testsuite tests=\"1\" failures=\"0\" errors=\"0\" skipped=\"0\"></testsuite>' > test-results/t.xml"}}));
  await exec("git",["add","."],{cwd:root});await exec("git",["commit","-m","initial"],{cwd:root});
  const store=await StateStore.open(root);const sid=store.createSession(root,"repo");const cfg=structuredClone(DEFAULT_CONFIG);const executor=new PolicyExecutor(root,sid,store,cfg);executor.authorize("shell");
  return {root,store,sid,executor};
}

describe("evidence identity and task binding",()=>{
  it("invalidates passing evidence when Git HEAD changes even if source bytes do not",async()=>{
    const x=await gitFixture("macus-head-evidence-");
    const ev=await runTest({root:x.root,sessionId:x.sid,command:"npm test",executor:x.executor,store:x.store,reportPath:"test-results/t.xml",reportFormat:"junit"});
    expect(ev.status).toBe("passed");
    await exec("git",["commit","--allow-empty","-m","next"],{cwd:x.root});
    const review=await buildReview(x.root,x.store,x.sid,true);
    expect(review.Tested[0].fresh).toBe(false);
    expect(review.Tested[0].identityFresh).toBe(false);
    expect(review.RemainingRisk.length).toBeGreaterThan(0);
    x.store.close();await rm(x.root,{recursive:true,force:true});
  });

  it("does not let unrelated global green evidence satisfy a completed task",async()=>{
    const x=await gitFixture("macus-task-evidence-");
    const tasks=new TaskEngine(x.store,x.sid);tasks.create("t1","Fix behavior");tasks.transition("t1","in_progress");
    const ev=await runTest({root:x.root,sessionId:x.sid,command:"npm test",executor:x.executor,store:x.store,reportPath:"test-results/t.xml",reportFormat:"junit"});
    expect(ev.status).toBe("passed");
    tasks.transition("t1","completed");
    const review=await buildReview(x.root,x.store,x.sid,true);
    expect(review.TaskEvidence.find(t=>t.id==="t1")?.evidenceIds).toEqual([]);
    expect(review.RemainingRisk.some(x=>x.includes("t1")&&x.includes("no linked"))).toBe(true);
    x.store.close();await rm(x.root,{recursive:true,force:true});
  });
});
