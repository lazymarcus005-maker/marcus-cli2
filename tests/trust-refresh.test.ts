import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { runTest } from "../src/testing/evidence.js";
import { captureTrustedCommandSnapshot,diffTrustedCommandSnapshots,trustedSnapshotDigest } from "../src/testing/discovery.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { createMacusTools } from "../src/agent/tools.js";
import { TaskEngine } from "../src/workflow/tasks.js";

describe("trusted baseline refresh",()=>{
  it("refreshes only by explicit store/CLI path and keeps old evidence bound to its original baseline",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-trust-refresh-"));
    await writeFile(path.join(root,"package.json"),JSON.stringify({scripts:{test:"node -e \"console.log('Tests 1 passed 0 failed')\""}},null,2));
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");
    const before=store.trustedCommandSnapshot(sid)!;const beforeDigest=trustedSnapshotDigest(before);
    const cfg=structuredClone(DEFAULT_CONFIG);const executor=new PolicyExecutor(root,sid,store,cfg);executor.authorize("shell");
    const ev1=await runTest({root,sessionId:sid,command:"npm test",executor,store});
    expect(ev1.trustSnapshotDigest).toBe(beforeDigest);

    await writeFile(path.join(root,"package.json"),JSON.stringify({scripts:{test:"node -e \"console.log('Tests 1 passed 0 failed')\"", "test:e2e":"node -e \"console.log('Tests 1 passed 0 failed')\""}},null,2));
    const current=captureTrustedCommandSnapshot(root);const diff=diffTrustedCommandSnapshots(before,current);
    expect(diff.addedCommands).toContain("npm run test:e2e");
    const next=store.refreshTrustedCommandSnapshot(sid,root);const nextDigest=trustedSnapshotDigest(next);
    expect(nextDigest).not.toBe(beforeDigest);expect(store.trustHistory(sid)).toHaveLength(1);

    const ev2=await runTest({root,sessionId:sid,command:"npm test",executor,store});
    expect(ev2.trustSnapshotDigest).toBe(nextDigest);
    const evidence=store.listEvidence(sid);
    expect(evidence.map(x=>x.payload.trustSnapshotDigest)).toEqual([nextDigest,beforeDigest]);

    const tools=createMacusTools({root,config:cfg,executor,tasks:new TaskEngine(store,sid)});
    expect(tools.map(x=>x.name)).not.toContain("trust");
    expect(tools.map(x=>x.name).some(x=>/trust.*refresh/i.test(x))).toBe(false);

    store.close();await rm(root,{recursive:true,force:true});
  },15000);
});
