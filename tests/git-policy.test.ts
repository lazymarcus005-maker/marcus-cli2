import { describe,it,expect } from "vitest";
import { mkdtemp,mkdir,writeFile,appendFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gitDiff,gitShow } from "../src/repository.js";

const exec=promisify(execFile);

describe("Git context path policy",()=>{
  it("excludes tracked internal Macus paths from diff and show",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-git-policy-"));
    await exec("git",["init","-b","main"],{cwd:root});
    await exec("git",["config","user.email","macus@example.invalid"],{cwd:root});
    await exec("git",["config","user.name","Macus Test"],{cwd:root});
    await mkdir(path.join(root,".macus","state"),{recursive:true});
    await writeFile(path.join(root,".macus","state","internal.txt"),"INTERNAL_BASE=one\n");
    await writeFile(path.join(root,"safe.txt"),"SAFE_BASE=one\n");
    await exec("git",["add","-f",".macus/state/internal.txt","safe.txt"],{cwd:root});
    await exec("git",["commit","-m","initial"],{cwd:root});

    await appendFile(path.join(root,".macus","state","internal.txt"),"INTERNAL_MARKER=two\n");
    await appendFile(path.join(root,"safe.txt"),"SAFE_MARKER=two\n");
    const diff=await gitDiff(root);
    expect(diff).toContain("SAFE_MARKER");
    expect(diff).not.toContain("INTERNAL_MARKER");
    expect(diff).not.toContain(".macus/state/internal.txt");

    await exec("git",["add","-f",".macus/state/internal.txt","safe.txt"],{cwd:root});
    await exec("git",["commit","-m","second"],{cwd:root});
    const shown=await gitShow(root,"HEAD");
    expect(shown).toContain("safe.txt");
    expect(shown).not.toContain(".macus/state/internal.txt");

    await rm(root,{recursive:true,force:true});
  });
});
