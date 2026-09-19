import { describe,it,expect } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { StateStore } from "../src/storage/state.js";
import { ContextLedger } from "../src/context/ledger.js";

describe("ledger",()=>{it("revisions are durable and session scoped",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"macus-ledger-")); const store=await StateStore.open(root); const a=store.createSession(root,"r"),b=store.createSession(root,"r");
  const la=new ContextLedger(store,a); expect(la.append({goal:"g",decisions:[],workingFiles:[],blockers:[]})).toBe(1); expect(la.append({goal:"g2",decisions:[],workingFiles:[],blockers:[]})).toBe(2);
  expect(la.latest()?.state.goal).toBe("g2"); expect(new ContextLedger(store,b).latest()).toBeUndefined();
  store.close(); await rm(root,{recursive:true,force:true});
});});
