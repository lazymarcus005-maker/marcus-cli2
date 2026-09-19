import { describe,it,expect } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/storage/state.js";

describe("runtime metrics",()=>{
  it("persists and summarizes local metrics without an external backend",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-metrics-"));const store=await StateStore.open(root);const sid=store.createSession(root,"repo");
    store.recordMetric({sessionId:sid,name:"search.latency_ms",value:10});
    store.recordMetric({sessionId:sid,name:"search.latency_ms",value:20});
    store.recordMetric({sessionId:sid,name:"snapshot.bytes_read",value:100,unit:"bytes"});
    const summary=store.metricSummary(sid);
    expect(summary["search.latency_ms"]).toEqual({count:2,avg:15,min:10,max:20});
    expect(summary["snapshot.bytes_read"].count).toBe(1);
    store.close();await rm(root,{recursive:true,force:true});
  });
});
