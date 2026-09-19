import { describe,it,expect } from "vitest";
import { mkdtemp,rm,writeFile,appendFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { repositoryIdentity,gitState,gitDiff,gitLog,gitShow,gitBlame } from "../src/repository.js";

const exec=promisify(execFile);

describe("Git context",()=>{
  it("reads bounded repository evidence without changing repository identity across branches",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-git-"));
    await exec("git",["init","-b","main"],{cwd:root});
    await exec("git",["config","user.email","macus@example.invalid"],{cwd:root});
    await exec("git",["config","user.name","Macus Test"],{cwd:root});
    await writeFile(path.join(root,"a.ts"),"export const a = 1;\n");
    await exec("git",["add","a.ts"],{cwd:root});
    await exec("git",["commit","-m","initial"],{cwd:root});

    const identity=await repositoryIdentity(root);
    const clean=await gitState(root);
    expect(clean.isGit).toBe(true); expect(clean.branch).toBe("main");
    expect(await gitLog(root,5)).toContain("initial");
    expect(await gitShow(root,"HEAD")).toContain("initial");
    expect(await gitBlame(root,"a.ts",1,1)).toContain("Macus Test");

    await appendFile(path.join(root,"a.ts"),"export const b = 2;\n");
    expect(await gitDiff(root)).toContain("export const b = 2");

    await exec("git",["checkout","-b","feature/test"],{cwd:root});
    const branched=await gitState(root);
    expect(branched.branch).toBe("feature/test");
    expect(await repositoryIdentity(root)).toBe(identity);

    await rm(root,{recursive:true,force:true});
  });
});
