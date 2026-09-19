import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sha256 } from "./utils.js";
import { PathPolicy } from "./path-policy.js";
const exec=promisify(execFile);

async function git(root:string,args:string[],maxBytes=128*1024):Promise<string>{
  const {stdout}=await exec("git",args,{cwd:root,maxBuffer:maxBytes});
  return stdout.length>maxBytes?stdout.slice(0,maxBytes)+"\n[truncated]":stdout;
}

export async function repositoryIdentity(root:string):Promise<string>{
  try{
    const gitDir=(await git(root,["rev-parse","--git-dir"],4096)).trim();
    const common=(await git(root,["rev-parse","--git-common-dir"],4096)).trim();
    return sha256(path.resolve(root)+"|"+path.resolve(root,gitDir)+"|"+path.resolve(root,common));
  }catch{return sha256(path.resolve(root));}
}

export async function gitState(root:string):Promise<{isGit:boolean;branch?:string;head?:string;status?:string}>{
  try{
    await git(root,["rev-parse","--is-inside-work-tree"],4096);
    const policy=new PathPolicy(root);
    const [branchResult,headResult,statusResult]=await Promise.allSettled([
      git(root,["branch","--show-current"],4096),git(root,["rev-parse","HEAD"],4096),git(root,["status","--short"],64*1024)
    ]);
    const branch=branchResult.status==="fulfilled"?branchResult.value.trim():undefined;
    const head=headResult.status==="fulfilled"?headResult.value.trim():undefined;
    const status=statusResult.status==="fulfilled"?statusResult.value:"";
    const filtered=status.split(/\r?\n/).filter(Boolean).filter(line=>{
      const raw=line.slice(3).replace(/^"|"$/g,"");
      const candidate=raw.includes(" -> ")?raw.split(" -> ").at(-1)!:raw;
      return !policy.isDeniedRelative(candidate);
    }).join("\n");
    return {isGit:true,branch,head,status:filtered.trim()};
  }catch{return {isGit:false};}
}

export async function gitDiff(root:string,args:string[]=[]):Promise<string>{
  const policy=new PathPolicy(root);
  const paths=args.length?args.map(p=>path.relative(root,policy.lexical(p))):["."];
  const pathspec=[...paths,...policy.gitExcludePathspecs()];
  const [unstaged,staged]=await Promise.all([
    git(root,["diff","--no-ext-diff","--",...pathspec],128*1024),
    git(root,["diff","--cached","--no-ext-diff","--",...pathspec],128*1024)
  ]);
  const sections:string[]=[];
  if(staged.trim())sections.push("[staged]\n"+staged.trimEnd());
  if(unstaged.trim())sections.push("[unstaged]\n"+unstaged.trimEnd());
  return sections.join("\n\n");
}
export async function gitLog(root:string,max=20):Promise<string>{return git(root,["log","--oneline","--decorate","-n",String(Math.min(Math.max(1,max),100))],64*1024);}
export async function gitShow(root:string,ref:string):Promise<string>{
  if(!/^[A-Za-z0-9_./~^{}-]+$/.test(ref)) throw new Error("Invalid git ref");
  const policy=new PathPolicy(root);
  return git(root,["show","--stat","--oneline","--decorate",ref,"--",".",...policy.gitExcludePathspecs()],128*1024);
}
export async function gitBlame(root:string,file:string,startLine?:number,endLine?:number):Promise<string>{
  const policy=new PathPolicy(root);
  const rel=path.relative(root,policy.lexical(file));
  const args=["blame"];
  if(startLine&&endLine)args.push("-L",String(startLine)+","+String(endLine));
  args.push("--",rel);
  return git(root,args,128*1024);
}
