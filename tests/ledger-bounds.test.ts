import { describe,it,expect } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/storage/state.js";
import { ContextLedger } from "../src/context/ledger.js";

describe("durable ledger bounds",()=>{
  it("bounds retained decisions, working files, blockers and free text",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-ledger-bounds-"));
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");const ledger=new ContextLedger(store,sid);
    ledger.append({
      goal:"g".repeat(6000),
      decisions:Array.from({length:80},(_,i)=>({text:"d"+i+":"+"x".repeat(3000),provenance:"p".repeat(800)})),
      workingFiles:Array.from({length:300},(_,i)=>({path:"f"+i,hash:"h"+i})),
      blockers:Array.from({length:80},(_,i)=>"b"+i+":"+"y".repeat(5000)),
      nextAction:"n".repeat(6000)
    });
    const state=ledger.latest()!.state;
    expect(state.decisions).toHaveLength(50);expect(state.decisions.every(d=>d.text.length<=2001&&(d.provenance?.length??0)<=501)).toBe(true);
    expect(state.workingFiles).toHaveLength(200);expect(state.blockers).toHaveLength(50);
    expect(state.goal!.length).toBeLessThanOrEqual(4001);expect(state.nextAction!.length).toBeLessThanOrEqual(4001);
    store.close();await rm(root,{recursive:true,force:true});
  });
});
