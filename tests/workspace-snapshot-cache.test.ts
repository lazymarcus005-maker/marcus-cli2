import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,utimes,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceSnapshotStore,workspaceSnapshotStore } from "../src/testing/snapshot-store.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { fileHash } from "../src/utils.js";

describe("incremental workspace snapshots",()=>{
  it("reuses unchanged hashes and only rehashes a changed file",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-snapshot-cache-"));
    await writeFile(path.join(root,"a.ts"),"export const a=1;\n");await writeFile(path.join(root,"b.ts"),"export const b=2;\n");
    const store=new WorkspaceSnapshotStore(root);
    const first=await store.digest();const cold=store.lastStats;
    const second=await store.digest();const warm=store.lastStats;
    expect(second).toBe(first);expect(cold.hashedFiles).toBe(2);expect(warm.hashedFiles).toBe(0);expect(warm.reusedFiles).toBe(2);expect(warm.bytesRead).toBe(0);
    await writeFile(path.join(root,"a.ts"),"export const a=3;\n");
    const third=await store.digest();const changed=store.lastStats;
    expect(third).not.toBe(first);expect(changed.hashedFiles).toBe(1);expect(changed.reusedFiles).toBe(1);
    await rm(root,{recursive:true,force:true});
  });


  it("uses the known after-hash from a Macus write without rereading file content",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-snapshot-write-"));const file=path.join(root,"a.ts");
    await writeFile(file,"export const a=1;\n");
    const snapshots=workspaceSnapshotStore(root);await snapshots.digest();
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");const executor=new PolicyExecutor(root,sid,store,structuredClone(DEFAULT_CONFIG));executor.authorize("edits");
    const before=await fileHash(file);await executor.safeWrite("a.ts","export const a=2;\n",before);
    await snapshots.digest();
    expect(snapshots.lastStats.hashedFiles).toBe(0);expect(snapshots.lastStats.reusedFiles).toBe(1);expect(snapshots.lastStats.bytesRead).toBe(0);
    store.close();await rm(root,{recursive:true,force:true});
  });

  it("detects same-size content change even when mtime is restored",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-snapshot-mtime-"));const file=path.join(root,"a.ts");
    await writeFile(file,"AAAA\n");const store=new WorkspaceSnapshotStore(root);const first=await store.digest();
    const before=(await import("node:fs/promises")).stat(file);
    const st=await before;
    await writeFile(file,"BBBB\n");await utimes(file,st.atime,st.mtime);
    const second=await store.digest();
    expect(second).not.toBe(first);expect(store.lastStats.hashedFiles).toBe(1);
    await rm(root,{recursive:true,force:true});
  });
});
