import { describe,it,expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { StateStore } from "../src/storage/state.js";
import { TaskEngine } from "../src/workflow/tasks.js";

describe("state",()=>{
  it("isolates sessions and task transitions",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-state-"));
    const store=await StateStore.open(root);
    const a=store.createSession(root,"repo-a"), b=store.createSession(root,"repo-a");
    const ta=new TaskEngine(store,a); ta.create("1","first"); ta.transition("1","in_progress");
    expect(store.listTasks(a)).toHaveLength(1); expect(store.listTasks(b)).toHaveLength(0);
    expect(()=>ta.create("2","second")).not.toThrow();
    expect(()=>ta.transition("2","in_progress")).toThrow(/one in_progress/);
    store.close(); await rm(root,{recursive:true,force:true});
  });
});
