import { spawn } from "node:child_process";
import path from "node:path";
import { access, readFile } from "node:fs/promises";
import type { MacusConfig } from "../types.js";
import { sha256 } from "../utils.js";
import { PathPolicy } from "../path-policy.js";

export interface SearchMatch { path: string; line: number; text: string; sourceHash?: string; }
export interface SearchResult {
  matches: SearchMatch[];
  returnedCount: number;
  totalKnown: number | null;
  truncated: boolean;
  nextCursor?: string;
  partialReason?: string;
}

interface CursorPayload { q: string; g: string; o: number; }

async function hasFile(file:string):Promise<boolean>{try{await access(file);return true;}catch{return false;}}

function decodeCursor(cursor:string):CursorPayload {
  try {
    const parsed=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8"));
    if(typeof parsed?.q!=="string"||typeof parsed?.g!=="string"||!Number.isInteger(parsed?.o)||parsed.o<0) throw new Error();
    return parsed;
  } catch {
    throw new Error("Invalid search cursor");
  }
}


export async function verifySearchMatchesAgainstSnapshots(canonicalRoot:string,page:SearchMatch[]):Promise<{matches:SearchMatch[];raced:boolean}>{
  const snapshots=new Map<string,{hash:string;lines:string[]}|undefined>();
  let raced=false;
  const verified:SearchMatch[]=[];
  for(const match of page){
    if(!snapshots.has(match.path)){
      try{
        const source=await readFile(path.join(canonicalRoot,match.path),"utf8");
        snapshots.set(match.path,{hash:sha256(source),lines:source.split(/\r?\n/)});
      }catch{snapshots.set(match.path,undefined);}
    }
    const snapshot=snapshots.get(match.path);
    const currentLine=snapshot?.lines[match.line-1];
    if(!snapshot||currentLine!==match.text){raced=true;continue;}
    verified.push({...match,sourceHash:snapshot.hash});
  }
  return {matches:verified,raced};
}

export async function searchCode(root: string, config: MacusConfig, input: {
  query: string; path?: string; fileType?: string; maxResults?: number;
  caseSensitive?: boolean; literal?: boolean; cursor?: string; signal?: AbortSignal;
}): Promise<SearchResult> {
  if (!input.query) throw new Error("query is required");
  const max = Math.min(input.maxResults ?? config.retrieval.search_max_results, config.retrieval.search_max_results);
  if(max<=0) return {matches:[],returnedCount:0,totalKnown:0,truncated:false};

  const policy=new PathPolicy(root);
  const [targetInfo,rootInfo]=await Promise.all([policy.resolveSearchTarget(input.path??"."),policy.resolveSearchTarget(".")]);
  const target=targetInfo.absolute;
  const canonicalRoot=rootInfo.absolute;
  const queryKey=sha256([input.query,targetInfo.relative,input.fileType??"",String(input.caseSensitive),String(input.literal!==false)].join("|"));
  let offset=0;
  if(input.cursor){
    const cursor=decodeCursor(input.cursor);
    if(cursor.q!==queryKey) throw new Error("Stale or mismatched search cursor");
    const currentGeneration=await policy.sourceGeneration(input.path??".");
    if(cursor.g!==currentGeneration) throw new Error("Stale search cursor: repository source generation changed");
    offset=cursor.o;
  }

  if(input.signal?.aborted) return {matches:[],returnedCount:0,totalKnown:null,truncated:true,partialReason:"cancelled"};

  const args=["--json","--line-number","--hidden"];
  for(const glob of policy.ripgrepExcludes()) args.push("--glob",glob);
  if(await hasFile(path.join(root,".macusignore"))) args.push("--ignore-file",path.join(root,".macusignore"));
  if(input.literal!==false) args.push("--fixed-strings");
  if(!input.caseSensitive) args.push("--ignore-case");
  if(input.fileType) args.push("--type",input.fileType);
  args.push("--",input.query,target);

  const child=spawn("rg",args,{cwd:root,stdio:["ignore","pipe","pipe"]});
  const wanted=offset+max+1;
  const all:SearchMatch[]=[];
  let stderr="",lineBuf="",deliberatelyStopped=false,timedOut=false,cancelled=false,parseError:Error|undefined;

  const stop=()=>{try{child.kill("SIGTERM");}catch{}};
  const consume=(line:string)=>{
    if(!line.trim()||all.length>=wanted)return;
    const item=JSON.parse(line);
    if(item.type!=="match")return;
    const d=item.data;
    const abs=path.isAbsolute(d.path.text)?d.path.text:path.resolve(root,d.path.text);
    const rel=path.relative(canonicalRoot,abs);
    if(policy.isDeniedRelative(rel))return;
    all.push({path:rel,line:d.line_number,text:d.lines.text.replace(/\n$/,"")});
    if(all.length>=wanted){deliberatelyStopped=true;stop();}
  };

  child.stdout.on("data",(c:Buffer)=>{
    lineBuf+=c.toString("utf8");
    let i:number;
    while((i=lineBuf.indexOf("\n"))>=0){
      const line=lineBuf.slice(0,i);lineBuf=lineBuf.slice(i+1);
      try{consume(line);}catch(e){parseError=e instanceof Error?e:new Error(String(e));stop();break;}
    }
  });
  child.stderr.on("data",(c:Buffer)=>stderr+=c.toString("utf8"));

  const timer=setTimeout(()=>{timedOut=true;stop();},config.retrieval.search_timeout_seconds*1000);
  const onAbort=()=>{cancelled=true;stop();};
  input.signal?.addEventListener("abort",onAbort,{once:true});
  if(input.signal?.aborted) onAbort();
  const code=await new Promise<number|null>((resolve,reject)=>{
    child.once("error",reject);
    child.once("close",resolve);
  });
  clearTimeout(timer);
  input.signal?.removeEventListener("abort",onAbort);

  if(lineBuf.trim()&&!deliberatelyStopped&&!parseError){try{consume(lineBuf);}catch(e){parseError=e instanceof Error?e:new Error(String(e));}}
  if(parseError) throw parseError;

  const page=all.slice(offset,offset+max);
  const verifiedSnapshot=await verifySearchMatchesAgainstSnapshots(canonicalRoot,page);
  const verified=verifiedSnapshot.matches;
  const raced=verifiedSnapshot.raced;
  if(cancelled) return {matches:verified,returnedCount:verified.length,totalKnown:null,truncated:true,partialReason:"cancelled"};
  if(timedOut) return {matches:verified,returnedCount:verified.length,totalKnown:null,truncated:true,partialReason:"timeout"};
  if(!deliberatelyStopped&&code!==0&&code!==1) throw new Error("ripgrep failed: "+stderr.trim());

  const truncated=deliberatelyStopped||all.length>offset+max;
  let nextCursor:string|undefined;
  if(truncated){
    const generation=await policy.sourceGeneration(input.path??".");
    nextCursor=Buffer.from(JSON.stringify({q:queryKey,g:generation,o:offset+max} satisfies CursorPayload)).toString("base64url");
  }
  return {matches:verified,returnedCount:verified.length,totalKnown:truncated||raced?null:all.length,truncated:truncated||raced,nextCursor,partialReason:raced?"source_changed_during_search":truncated?"result_limit":undefined};
}
