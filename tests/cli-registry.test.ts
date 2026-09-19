import { describe,it,expect } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CliApplication } from "../src/cli/application.js";
import { DEFAULT_CONFIG } from "../src/config.js";

describe("CLI application",()=>{
  it("runs user commands through the application lifecycle without booting readline or the model",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-cli-application-"));
    const app=await CliApplication.open(root,structuredClone(DEFAULT_CONFIG));
    try{
      const text:string[]=[];
      const json:unknown[]=[];
      const io={print:(value:unknown)=>text.push(String(value)),printText:(value:string)=>text.push(value),printJson:(value:unknown)=>json.push(value),confirm:async()=>false};
      await app.executeCommand("/status",[],false,io);
      expect(text.join("\n")).toContain("Session   (none)");
      expect(text.join("\n")).toContain("Lock      read-only");
      await app.executeCommand("/models",[],false,io);
      expect(text.join("\n")).toContain("(none configured)");
      await app.executeCommand("/authorize",["edits"],false,io);
      expect(text.join("\n")).toContain("Authorized workspace edits");
    }finally{
      await app.dispose();
      await rm(root,{recursive:true,force:true});
    }
  });
});
