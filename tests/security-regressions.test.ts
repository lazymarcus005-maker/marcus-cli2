import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,readFile,rm,readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { PolicyExecutor } from "../src/policy.js";
import { searchCode } from "../src/retrieval/search.js";
import { readRange } from "../src/retrieval/symbols.js";
import { SymbolIndex } from "../src/retrieval/index.js";

describe("security regressions",()=>{
  it("force-kills a process group that ignores SIGTERM",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-term-"));
    const store=await StateStore.open(root); const sid=store.createSession(root,"repo");
    const cfg=structuredClone(DEFAULT_CONFIG); cfg.execution.command_timeout_seconds=1; cfg.execution.termination_grace_seconds=1;
    const ex=new PolicyExecutor(root,sid,store,cfg); ex.authorize("shell");
    const started=Date.now();
    const result=await ex.run("trap '' TERM; while :; do sleep 1; done");
    const elapsed=Date.now()-started;
    expect(result.timedOut).toBe(true);
    expect(elapsed).toBeLessThan(3500);
    store.close(); await rm(root,{recursive:true,force:true});
  },6000);

  it("strips provider credentials from subprocess env and redacts persisted/output values",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-redact-"));
    process.env.MACUS_FAKE_PROVIDER_KEY="synthetic-provider-key-123";
    const cfg=structuredClone(DEFAULT_CONFIG);
    cfg.execution.environment_allowlist.push("MACUS_FAKE_PROVIDER_KEY");
    cfg.model_profiles.p={context_window:4096,max_output_tokens:512,tokenizer:"conservative-byte-estimate"};
    cfg.models={default:"primary",providers:{p:{protocol:"openai-compatible",base_url:"http://127.0.0.1:1/v1",api_key_env:"MACUS_FAKE_PROVIDER_KEY",profile:"p",model:"mock"}},aliases:{primary:"p"}};
    const store=await StateStore.open(root); const sid=store.createSession(root,"repo");
    const ex=new PolicyExecutor(root,sid,store,cfg); ex.authorize("shell");

    const absent=await ex.run("printf '%s' \"${MACUS_FAKE_PROVIDER_KEY-unset}\"");
    expect(absent.stdout).toBe("unset");

    const redacted=await ex.run("printf '%s' 'synthetic-provider-key-123'");
    expect(redacted.stdout).toContain("[REDACTED]");
    expect(redacted.stdout).not.toContain("synthetic-provider-key-123");
    const row=store.db.prepare("SELECT command FROM executions WHERE execution_id=?").get(redacted.executionId) as any;
    expect(String(row.command)).not.toContain("synthetic-provider-key-123");
    const log=await readFile(path.join(root,".macus","logs",sid,redacted.executionId+".log"),"utf8");
    expect(log).not.toContain("synthetic-provider-key-123");

    store.close(); delete process.env.MACUS_FAKE_PROVIDER_KEY; await rm(root,{recursive:true,force:true});
  });

  it("denies known secret paths independently of gitignore",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-secret-path-"));
    await writeFile(path.join(root,".env.ts"),"export const PRIVATE_MARKER = 'synthetic';\n");
    await writeFile(path.join(root,"safe.ts"),"export const PUBLIC_MARKER = 'ok';\n");
    const cfg=structuredClone(DEFAULT_CONFIG);

    const secretSearch=await searchCode(root,cfg,{query:"PRIVATE_MARKER"});
    expect(secretSearch.matches).toEqual([]);
    const publicSearch=await searchCode(root,cfg,{query:"PUBLIC_MARKER"});
    expect(publicSearch.matches.some(x=>x.path==="safe.ts")).toBe(true);
    await expect(readRange(root,".env.ts",1,1)).rejects.toThrow(/denied/i);

    const index=await SymbolIndex.open(root,cfg);
    const discovered=await index.discover();
    expect(discovered.truncated).toBe(false);
    expect(discovered.files).toContain("safe.ts");
    expect(discovered.files).not.toContain(".env.ts");
    index.close();

    // Ensure no internal temp files leaked into the source directory.
    expect((await readdir(root)).some(x=>x.includes("macus-tmp"))).toBe(false);
    await rm(root,{recursive:true,force:true});
  });
});
