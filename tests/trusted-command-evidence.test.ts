import { describe,it,expect } from "vitest";
import { mkdtemp,rm,writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { repositoryIdentity } from "../src/repository.js";
import { runCommandWithEvidence } from "../src/testing/evidence.js";

describe("trusted command evidence",()=>{
  it("records parsed evidence when a trusted test command uses run_command",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-trusted-command-"));
    await writeFile(path.join(root,"package.json"),JSON.stringify({scripts:{test:"node -e \"console.log('Tests 1 passed')\""}}));
    const store=await StateStore.open(root);
    const sessionId=store.createSession(root,await repositoryIdentity(root));
    const runId=store.createRun(sessionId);
    const executor=new PolicyExecutor(root,sessionId,store,structuredClone(DEFAULT_CONFIG));
    executor.authorize("shell");
    try{
      const result=await runCommandWithEvidence({root,sessionId,runId,command:"npm test",executor,store});
      expect(result.command.exitCode).toBe(0);
      expect(result.evidence?.trustedCommand).toBe(true);
      expect(result.evidence?.status).toBe("passed");
      expect(store.listEvidence(sessionId)[0]?.id).toBe(result.evidence?.id);
    }finally{
      store.close();
      await rm(root,{recursive:true,force:true});
    }
  },15000);

  it("does not treat an untrusted shell command as test evidence",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-untrusted-command-"));
    await writeFile(path.join(root,"package.json"),JSON.stringify({scripts:{test:"node -e \"console.log('Tests 1 passed')\""}}));
    const store=await StateStore.open(root);
    const sessionId=store.createSession(root,await repositoryIdentity(root));
    const executor=new PolicyExecutor(root,sessionId,store,structuredClone(DEFAULT_CONFIG));
    executor.authorize("shell");
    try{
      const result=await runCommandWithEvidence({root,sessionId,command:"node -e \"console.log('hello')\"",executor,store});
      expect(result.command.exitCode).toBe(0);
      expect(result.evidence).toBeUndefined();
      expect(store.listEvidence(sessionId)).toEqual([]);
    }finally{
      store.close();
      await rm(root,{recursive:true,force:true});
    }
  },15000);
});
