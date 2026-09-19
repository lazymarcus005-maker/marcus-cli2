import { describe,it,expect } from "vitest";
import { mkdtemp,rm,mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { StateStore } from "../src/storage/state.js";

describe("state migrations",()=>{
  it("rolls back an interrupted fresh migration atomically",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-migrate-"));
    const dir=path.join(root,".macus","state"); await mkdir(dir,{recursive:true});
    const dbPath=path.join(dir,"state.db"); const db=new DatabaseSync(dbPath);
    const store=new (StateStore as any)(dbPath,db) as StateStore;
    expect(()=>store.migrate("after_schema_metadata")).toThrow(/Injected migration failure/);
    const tables=(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(x=>x.name);
    expect(tables).not.toContain("schema_metadata");
    expect(tables).not.toContain("sessions");
    db.close(); await rm(root,{recursive:true,force:true});
  });


  it("upgrades schema v1 to v2 idempotently",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-schema-v1-"));
    const dir=path.join(root,".macus","state"); await mkdir(dir,{recursive:true});
    const dbPath=path.join(dir,"state.db"); const db=new DatabaseSync(dbPath);
    db.exec("CREATE TABLE schema_metadata(version INTEGER NOT NULL); INSERT INTO schema_metadata(version) VALUES(1);");
    const store=new (StateStore as any)(dbPath,db) as StateStore;
    expect(()=>store.migrate()).not.toThrow();
    expect(Number((db.prepare("SELECT version FROM schema_metadata").get() as any).version)).toBe(2);
    const tables=(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(x=>x.name);
    expect(tables).toContain("runtime_metrics");
    expect(tables).toContain("session_trust_history");
    expect(()=>store.migrate()).not.toThrow();
    db.close(); await rm(root,{recursive:true,force:true});
  });

  it("rejects a future schema before writing current tables",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-future-schema-"));
    const dir=path.join(root,".macus","state"); await mkdir(dir,{recursive:true});
    const dbPath=path.join(dir,"state.db"); const db=new DatabaseSync(dbPath);
    db.exec("CREATE TABLE schema_metadata(version INTEGER NOT NULL); INSERT INTO schema_metadata(version) VALUES(99);");
    const store=new (StateStore as any)(dbPath,db) as StateStore;
    expect(()=>store.migrate()).toThrow(/Unsupported future state schema 99/);
    const tables=(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(x=>x.name);
    expect(tables).toEqual(["schema_metadata"]);
    db.close(); await rm(root,{recursive:true,force:true});
  });
});
