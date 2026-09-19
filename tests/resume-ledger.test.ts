import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";
import { StateStore } from "../src/storage/state.js";
import { ContextLedger } from "../src/context/ledger.js";
import { PiAgentKernel } from "../src/agent/kernel.js";
import { repositoryIdentity } from "../src/repository.js";
import { fileHash } from "../src/utils.js";

describe("ledger resume hydration",()=>{
  it("restores goal and fresh working files into the runtime",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-ledger-resume-"));
    await writeFile(path.join(root,"a.ts"),"export const a=1;\n");
    process.env.MACUS_TEST_KEY="k";
    const cfg=structuredClone(DEFAULT_CONFIG);
    cfg.models={default:"primary",providers:{mock:{protocol:"openai-compatible",base_url:"http://127.0.0.1:1/v1",api_key_env:"MACUS_TEST_KEY",profile:"p",model:"mock"}},aliases:{primary:"mock"}};
    cfg.model_profiles={p:{context_window:65536,max_output_tokens:1024,tokenizer:"conservative-byte-estimate"}};
    cfg.context.reserved_output_tokens=1024;cfg.context.safety_margin_tokens=512;
    const store=await StateStore.open(root);const sid=store.createSession(root,await repositoryIdentity(root));
    const hash=(await fileHash(path.join(root,"a.ts")))!;
    new ContextLedger(store,sid).append({goal:"persisted goal",decisions:[],workingFiles:[{path:"a.ts",hash}],blockers:[],nextAction:"continue"});
    const kernel=new PiAgentKernel(root,cfg,sid,store,"primary");
    await kernel.create();

    expect((kernel as any).currentGoal).toBe("persisted goal");
    expect((kernel as any).workingSet.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({path:"a.ts",sourceHash:hash,status:"RELATED",tier:"WARM",reason:"resume-ledger"})
    ]));

    await kernel.dispose();store.close();delete process.env.MACUS_TEST_KEY;await rm(root,{recursive:true,force:true});
  });
});
