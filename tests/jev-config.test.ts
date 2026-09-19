import { describe,it,expect } from "vitest";
import { mkdtemp,mkdir,writeFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG,loadConfig,validateConfig } from "../src/config.js";

describe("Jev configuration authority",()=>{
  it("is disabled by default and requires explicit global enablement",()=>{
    expect(DEFAULT_CONFIG.features.jev_harness).toBe(false);
    expect(DEFAULT_CONFIG.internal_models.jev.enabled).toBe(false);
    const c=structuredClone(DEFAULT_CONFIG);
    c.features.jev_harness=true;
    expect(()=>validateConfig(c)).toThrow(/requires internal_models\.jev\.enabled/i);
  });

  it("rejects behavior-affecting modes before calibration",()=>{
    const c=structuredClone(DEFAULT_CONFIG);
    c.internal_models.jev.mode="advisory";
    expect(()=>validateConfig(c)).toThrow(/only.*shadow/i);
  });

  it("uses TypeSafe direct model and credential defaults when that transport is selected",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-typesafe-defaults-"));
    const global=path.join(root,"global.yaml");
    await writeFile(global,"schema_version: 1\ninternal_models:\n  jev:\n    transport: typesafe\n");
    const loaded=await loadConfig(root,global);
    expect(loaded.config.internal_models.jev.model).toBe("jev-latest");
    expect(loaded.config.internal_models.jev.api_key_env).toBe("TYPESAFE_API_KEY");
    await rm(root,{recursive:true,force:true});
  });

  it("project config cannot enable or reconfigure Jev but may disable it",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-jev-config-"));await mkdir(path.join(root,".macus"),{recursive:true});
    const global=path.join(root,"global.yaml");process.env.MACUS_TEST_JEV_KEY="secret";
    await writeFile(global,`schema_version: 1
features:
  jev_harness: true
internal_models:
  jev:
    enabled: true
    transport: openrouter
    model: typesafe/jev-1.13
    api_key_env: MACUS_TEST_JEV_KEY
    timeout_ms: 1000
    max_state_tokens: 4000
    mode: shadow
`);
    await writeFile(path.join(root,".macus","config.yaml"),"features:\n  jev_harness: true\n");
    await expect(loadConfig(root,global)).rejects.toThrow(/cannot enable.*jev_harness/i);

    await writeFile(path.join(root,".macus","config.yaml"),"internal_models:\n  jev:\n    model: bad\n");
    await expect(loadConfig(root,global)).rejects.toThrow(/cannot override internal_models/i);

    await writeFile(path.join(root,".macus","config.yaml"),"features:\n  jev_harness: false\n");
    const loaded=await loadConfig(root,global);
    expect(loaded.config.features.jev_harness).toBe(false);
    expect(loaded.config.internal_models.jev.enabled).toBe(true);
    delete process.env.MACUS_TEST_JEV_KEY;await rm(root,{recursive:true,force:true});
  });
});
