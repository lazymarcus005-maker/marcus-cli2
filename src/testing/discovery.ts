import { createHash } from "node:crypto";
import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { fileHash } from "../utils.js";
import { PathPolicy } from "../path-policy.js";

const TRUSTED_SCRIPT = /^(?:test(?::|$)|build(?::|$)|check(?::|$)|typecheck$|lint$)/i;

export interface TrustedCommandSnapshot {
  commands: Record<string,string[]>;
  sourceHashes: Record<string,string>;
  capturedAt: string;
}

function sha256Text(text:string):string{
  return createHash("sha256").update(text).digest("hex");
}

function addCommand(commands:Record<string,string[]>,command:string,source:string):void{
  const current=commands[command]??[];
  if(!current.includes(source)) current.push(source);
  commands[command]=current.sort();
}

export function captureTrustedCommandSnapshot(root:string):TrustedCommandSnapshot{
  const commands:Record<string,string[]>={};
  const sourceHashes:Record<string,string>={};
  const policy=new PathPolicy(root);

  try{
    const rel="package.json";
    const full=policy.lexical(rel);
    const text=readFileSync(full,"utf8");
    const pkg=JSON.parse(text);
    const scripts=pkg?.scripts&&typeof pkg.scripts==="object"?pkg.scripts:{};
    for(const name of Object.keys(scripts)){
      if(TRUSTED_SCRIPT.test(name)) addCommand(commands,name==="test"?"npm test":`npm run ${name}`,rel);
    }
    sourceHashes[rel]=sha256Text(text);
  }catch{}

  const walk=(dir:string,depth:number):void=>{
    if(depth>3)return;
    let entries;
    try{entries=readdirSync(dir,{withFileTypes:true});}catch{return;}
    for(const entry of entries){
      const full=path.join(dir,entry.name);
      const rel=path.relative(root,full);
      if(policy.isDeniedRelative(rel)||entry.isSymbolicLink()) continue;
      if(entry.isDirectory()){walk(full,depth+1);continue;}
      if(!/\.(?:sln|csproj)$/i.test(entry.name)) continue;
      try{
        const text=readFileSync(full,"utf8");
        const normalized=rel.split(path.sep).join("/");
        sourceHashes[normalized]=sha256Text(text);
        addCommand(commands,`dotnet test ${normalized}`,normalized);
      }catch{}
    }
  };
  walk(root,0);

  return {commands,sourceHashes,capturedAt:new Date().toISOString()};
}


export function trustedSnapshotDigest(snapshot:TrustedCommandSnapshot|undefined):string|undefined{
  if(!snapshot)return undefined;
  const commands=Object.fromEntries(Object.entries(snapshot.commands).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,[...v].sort()]));
  const sourceHashes=Object.fromEntries(Object.entries(snapshot.sourceHashes).sort(([a],[b])=>a.localeCompare(b)));
  return sha256Text(JSON.stringify({commands,sourceHashes}));
}

export interface TrustedSnapshotDiff {
  changedSources:Array<{path:string;baseline?:string;current?:string}>;
  addedCommands:string[];
  removedCommands:string[];
  unchangedCommands:string[];
}

export function diffTrustedCommandSnapshots(baseline:TrustedCommandSnapshot|undefined,current:TrustedCommandSnapshot):TrustedSnapshotDiff{
  const sourcePaths=[...new Set([...Object.keys(baseline?.sourceHashes??{}),...Object.keys(current.sourceHashes)])].sort();
  const changedSources=sourcePaths.flatMap(path=>{
    const before=baseline?.sourceHashes[path],after=current.sourceHashes[path];
    return before===after?[]:[{path,baseline:before,current:after}];
  });
  const beforeCommands=new Set(Object.keys(baseline?.commands??{}));
  const afterCommands=new Set(Object.keys(current.commands));
  return {
    changedSources,
    addedCommands:[...afterCommands].filter(x=>!beforeCommands.has(x)).sort(),
    removedCommands:[...beforeCommands].filter(x=>!afterCommands.has(x)).sort(),
    unchangedCommands:[...afterCommands].filter(x=>beforeCommands.has(x)).sort(),
  };
}

export async function classifyTestCommand(
  root:string,
  command:string,
  snapshot:TrustedCommandSnapshot|undefined
):Promise<{trusted:boolean;reason:string;sources:string[]}>{
  const normalized=command.trim().replace(/\s+/g," ");
  if(!snapshot) return {trusted:false,reason:"no_session_trust_snapshot",sources:[]};
  const sources=snapshot.commands[normalized]??[];
  if(!sources.length) return {trusted:false,reason:"command_not_in_session_trust_baseline",sources:[]};

  for(const source of sources){
    const expected=snapshot.sourceHashes[source];
    const current=await fileHash(path.join(root,source));
    if(!expected||current!==expected){
      return {trusted:false,reason:"trust_source_changed_since_session_start",sources};
    }
  }
  return {trusted:true,reason:"session_baseline_trusted_test_or_build_command",sources};
}
