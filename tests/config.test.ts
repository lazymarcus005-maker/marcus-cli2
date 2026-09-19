import { describe,it,expect } from "vitest";
import { mkdtemp,mkdir,writeFile,rm } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { DEFAULT_CONFIG, validateConfig, loadConfig } from "../src/config.js";

describe("config",()=>{
  it("rejects unsafe unsupported features",()=>{
    const c=structuredClone(DEFAULT_CONFIG); c.features.semantic_search=true;
    expect(()=>validateConfig(c)).toThrow(/unsupported/);
  });
  it("rejects invalid context ratios",()=>{
    const c=structuredClone(DEFAULT_CONFIG); c.context.compact_prompt_ratio=0.4;
    expect(()=>validateConfig(c)).toThrow(/target/);
  });
  it("accepts OpenAI Responses API providers",()=>{
    const c=structuredClone(DEFAULT_CONFIG);
    c.models={default:"primary",providers:{zen:{protocol:"openai-responses",base_url:"https://opencode.ai/zen/v1",api_key_env:"MACUS_RESPONSES_TEST_KEY",profile:"standard",model:"muse-spark-1.3-contributor-free"}},aliases:{primary:"zen"}};
    c.model_profiles={standard:{context_window:65536,max_output_tokens:1024,tokenizer:"conservative-byte-estimate"}};
    const original=process.env.MACUS_RESPONSES_TEST_KEY;
    try{
      process.env.MACUS_RESPONSES_TEST_KEY="test-key";
      expect(validateConfig(c).models.providers.zen.protocol).toBe("openai-responses");
    }finally{
      if(original===undefined)delete process.env.MACUS_RESPONSES_TEST_KEY;
      else process.env.MACUS_RESPONSES_TEST_KEY=original;
    }
  });
  it("rejects unknown fields and project budget escalation",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-config-")); await mkdir(path.join(root,".macus"),{recursive:true});
    const global=path.join(root,"global.yaml");
    await writeFile(global,"schema_version: 1\nunknown_field: true\n");
    await expect(loadConfig(root,global)).rejects.toThrow(/Unknown config field/);
    await writeFile(global,"schema_version: 1\ncontext:\n  budget:\n    repo_map_tokens: 100\n");
    await writeFile(path.join(root,".macus","config.yaml"),"context:\n  budget:\n    repo_map_tokens: 101\n");
    await expect(loadConfig(root,global)).rejects.toThrow(/exceeds user\/global ceiling/);
    await rm(root,{recursive:true,force:true});
  });
});
