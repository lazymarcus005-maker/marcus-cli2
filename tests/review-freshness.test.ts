import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,appendFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { runTest } from "../src/testing/evidence.js";
import { buildReview } from "../src/review.js";

const exec=promisify(execFile);

describe("review diff and evidence freshness",()=>{
  it("includes the real bounded diff and marks prior green evidence stale after a source edit",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-review-"));
    await exec("git",["init","-b","main"],{cwd:root});
    await exec("git",["config","user.email","macus@example.invalid"],{cwd:root});
    await exec("git",["config","user.name","Macus Test"],{cwd:root});
    await writeFile(path.join(root,"app.mjs"),"export const value = 1;\n");
    await writeFile(path.join(root,"test.mjs"),"import assert from 'node:assert/strict'; import {value} from './app.mjs'; assert.equal(value,1);\n");
    await writeFile(path.join(root,"package.json"),JSON.stringify({scripts:{"test:review":"node test.mjs && mkdir -p test-results && printf '<testsuite tests=\"1\" failures=\"0\" errors=\"0\" skipped=\"0\"></testsuite>' > test-results/review-junit.xml"}},null,2));
    await exec("git",["add","."],{cwd:root});await exec("git",["commit","-m","initial"],{cwd:root});

    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");
    const cfg=structuredClone(DEFAULT_CONFIG);
    const executor=new PolicyExecutor(root,sid,store,cfg);executor.authorize("shell");
    const evidence=await runTest({
      root,sessionId:sid,command:"npm run test:review",
      executor,store,reportPath:"test-results/review-junit.xml",reportFormat:"junit"
    });
    expect(evidence.status).toBe("passed");

    await appendFile(path.join(root,"app.mjs"),"export const changed = true;\n");
    const review=await buildReview(root,store,sid,true);
    expect(review.Changed.diff).toContain("export const changed = true");
    expect(review.Tested[0].fresh).toBe(false);
    expect(review.RemainingRisk.some(x=>x.includes("stale"))).toBe(true);

    store.close();await rm(root,{recursive:true,force:true});
  },10000);
});
