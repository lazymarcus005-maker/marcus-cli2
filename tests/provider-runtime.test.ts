import { describe,it,expect } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { ProviderRuntime } from "../src/agent/provider-runtime.js";

describe("provider runtime",()=>{
  it("normalizes configured protocols and resolves every model alias through one runtime",async()=>{
    const config=structuredClone(DEFAULT_CONFIG);
    config.models={
      default:"chat",
      providers:{
        chat:{protocol:"openai-compatible",base_url:"http://127.0.0.1:1/v1",profile:"standard",model:"chat-model"},
        responses:{protocol:"openai-responses",base_url:"http://127.0.0.1:1/v1",profile:"standard",model:"responses-model"},
        router:{protocol:"openrouter",base_url:"http://127.0.0.1:1/v1",profile:"standard",model:"router-model"},
        lite:{protocol:"litellm",base_url:"http://127.0.0.1:1/v1",profile:"standard",model:"lite-model"},
      },
      aliases:{chat:"chat",responses:"responses",router:"router",lite:"lite"},
    };
    config.model_profiles={standard:{context_window:65536,max_output_tokens:1024,tokenizer:"conservative-byte-estimate"}};
    config.context.reserved_output_tokens=1024;
    config.context.safety_margin_tokens=512;

    const providers=await ProviderRuntime.create(config);
    expect(providers.resolve("chat").model.api).toBe("openai-completions");
    expect(providers.resolve("responses").model.api).toBe("openai-responses");
    expect(providers.resolve("router").model.api).toBe("openai-completions");
    expect(providers.resolve("lite").model.api).toBe("openai-completions");
    expect(()=>providers.resolve("missing")).toThrow(/Unknown model alias/);
  });
});
