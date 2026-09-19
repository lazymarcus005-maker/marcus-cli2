import { describe,it,expect } from "vitest";
import { DEFAULT_CONFIG,validateConfig } from "../src/config.js";

describe("config execution/run limits",()=>{
  it("rejects zero or negative run and execution limits",()=>{
    const a=structuredClone(DEFAULT_CONFIG);a.run.max_model_turns=0;
    expect(()=>validateConfig(a)).toThrow(/run limit/i);
    const b=structuredClone(DEFAULT_CONFIG);b.execution.command_timeout_seconds=-1;
    expect(()=>validateConfig(b)).toThrow(/execution limit/i);
    const c=structuredClone(DEFAULT_CONFIG);c.retrieval.search_timeout_seconds=0;
    expect(()=>validateConfig(c)).toThrow(/search_timeout_seconds/i);
  });
});
