import { describe,it,expect } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { RuntimeLockCoordinator } from "../src/runtime/lock-coordinator.js";

describe("lazy mutation lock escalation",()=>{
  it("does not acquire the worktree lock for reads and acquires it before effects",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-lock-escalation-"));
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");
    const locksA=new RuntimeLockCoordinator(root),locksB=new RuntimeLockCoordinator(root);
    const executor=new PolicyExecutor(root,sid,store,structuredClone(DEFAULT_CONFIG),()=>locksA.ensureMutationAccess());
    expect(locksA.mutationOwned).toBe(false);
    await expect(executor.safeRead("missing.txt")).rejects.toBeTruthy();
    expect(locksA.mutationOwned).toBe(false);
    executor.authorize("shell");
    const result=await executor.run("printf ok");
    expect(result.stdout).toBe("ok");expect(locksA.mutationOwned).toBe(true);
    await expect(locksB.ensureMutationAccess()).rejects.toBeTruthy();
    await locksA.release();
    await expect(locksB.ensureMutationAccess()).resolves.toBeUndefined();
    await locksB.release();store.close();await rm(root,{recursive:true,force:true});
  });
});
