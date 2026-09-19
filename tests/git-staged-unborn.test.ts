import { describe,it,expect } from "vitest";
import { mkdtemp,writeFile,appendFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gitDiff,gitState } from "../src/repository.js";
const exec=promisify(execFile);

describe("Git staged and unborn states",()=>{
  it("reports an unborn repository as Git",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-unborn-"));await exec("git",["init","-b","main"],{cwd:root});
    const state=await gitState(root);expect(state.isGit).toBe(true);expect(state.branch).toBe("main");expect(state.head).toBeUndefined();
    await rm(root,{recursive:true,force:true});
  });
  it("includes staged changes in bounded diff",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-staged-"));await exec("git",["init","-b","main"],{cwd:root});
    await exec("git",["config","user.email","x@y"],{cwd:root});await exec("git",["config","user.name","x"],{cwd:root});
    await writeFile(path.join(root,"a.txt"),"one\n");await exec("git",["add","."],{cwd:root});await exec("git",["commit","-m","initial"],{cwd:root});
    await appendFile(path.join(root,"a.txt"),"STAGED_MARKER=two\n");await exec("git",["add","a.txt"],{cwd:root});
    const diff=await gitDiff(root);expect(diff).toContain("[staged]");expect(diff).toContain("STAGED_MARKER");
    await rm(root,{recursive:true,force:true});
  });
});
