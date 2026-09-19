import { describe,it,expect } from "vitest";
import { execFile } from "node:child_process"; import { promisify } from "node:util";
const exec=promisify(execFile);
describe("cli",()=>{it("build output exposes help",async()=>{const {stdout}=await exec(process.execPath,["dist/cli.js","--help"]);expect(stdout).toContain("Macus Code");});});
