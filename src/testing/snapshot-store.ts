import { createHash, type Hash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir,stat } from "node:fs/promises";
import path from "node:path";
import { PathPolicy } from "../path-policy.js";

const GENERATED_DIRS=new Set(["coverage","dist","build",".next","test-results",".nyc_output","bin","obj"]);

interface CachedFile {
  size:number;
  mtimeNs:string;
  ctimeNs:string;
  ino:string;
  hash:string;
}

export interface WorkspaceSnapshotStats {
  files:number;
  hashedFiles:number;
  reusedFiles:number;
  bytesRead:number;
  durationMs:number;
}

async function contentHash(file:string):Promise<{hash:string;bytes:number}>{
  const h=createHash("sha256");let bytes=0;
  await new Promise<void>((resolve,reject)=>{
    const stream=createReadStream(file);
    stream.on("data",(chunk:string|Buffer)=>{const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=b.length;h.update(b);});
    stream.once("error",reject);stream.once("end",resolve);
  });
  return {hash:h.digest("hex"),bytes};
}

function feedDigest(h:Hash,relative:string,hash:string):void{
  h.update(relative);h.update("\0");h.update(hash);h.update("\0");
}

export class WorkspaceSnapshotStore {
  private readonly cache=new Map<string,CachedFile>();
  private last:WorkspaceSnapshotStats={files:0,hashedFiles:0,reusedFiles:0,bytesRead:0,durationMs:0};

  constructor(readonly root:string){}

  get lastStats():WorkspaceSnapshotStats{return {...this.last};}

  async digest():Promise<string>{
    const started=performance.now();
    const policy=new PathPolicy(this.root);
    const ignore=await policy.ignoreMatcher();
    const discovered:Array<{full:string;rel:string}>=[];
    const walk=async(dir:string):Promise<void>=>{
      for(const entry of await readdir(dir,{withFileTypes:true})){
        if(GENERATED_DIRS.has(entry.name))continue;
        const full=path.join(dir,entry.name);
        const rel=path.relative(this.root,full);
        const key=rel.split(path.sep).join("/");
        if(policy.isDeniedRelative(rel))continue;
        if(ignore.ignores(entry.isDirectory()?key+"/":key))continue;
        if(entry.isSymbolicLink())continue;
        if(entry.isDirectory())await walk(full);
        else if(entry.isFile())discovered.push({full,rel:key});
      }
    };
    await walk(this.root);
    discovered.sort((a,b)=>a.rel.localeCompare(b.rel));

    const digest=createHash("sha256");
    const seen=new Set<string>();
    let hashedFiles=0,reusedFiles=0,bytesRead=0;
    for(const file of discovered){
      const s=await stat(file.full,{bigint:true}) as any;
      const identity={
        size:Number(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs),ino:String(s.ino),
      };
      const previous=this.cache.get(file.rel);
      let hash:string;
      if(previous&&previous.size===identity.size&&previous.mtimeNs===identity.mtimeNs&&previous.ctimeNs===identity.ctimeNs&&previous.ino===identity.ino){
        hash=previous.hash;reusedFiles++;
      }else{
        const result=await contentHash(file.full);hash=result.hash;bytesRead+=result.bytes;hashedFiles++;
        this.cache.set(file.rel,{...identity,hash});
      }
      seen.add(file.rel);feedDigest(digest,file.rel,hash);
    }
    for(const key of [...this.cache.keys()])if(!seen.has(key))this.cache.delete(key);
    this.last={files:discovered.length,hashedFiles,reusedFiles,bytesRead,durationMs:performance.now()-started};
    return digest.digest("hex");
  }

  async noteWrite(inputPath:string,hash:string):Promise<void>{
    const full=path.isAbsolute(inputPath)?inputPath:path.join(this.root,inputPath);
    const rel=path.relative(this.root,full).split(path.sep).join("/");
    try{
      const s=await stat(full,{bigint:true}) as any;
      this.cache.set(rel,{size:Number(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs),ino:String(s.ino),hash});
    }catch{this.cache.delete(rel);}
  }

  invalidate(inputPath?:string):void{
    if(!inputPath){this.cache.clear();return;}
    const full=path.isAbsolute(inputPath)?inputPath:path.join(this.root,inputPath);
    this.cache.delete(path.relative(this.root,full).split(path.sep).join("/"));
  }
}

const stores=new Map<string,WorkspaceSnapshotStore>();

export function workspaceSnapshotStore(root:string):WorkspaceSnapshotStore{
  const key=path.resolve(root);
  let store=stores.get(key);
  if(!store){store=new WorkspaceSnapshotStore(key);stores.set(key,store);}
  return store;
}

export async function snapshotDigestCached(root:string):Promise<string>{
  return workspaceSnapshotStore(root).digest();
}

export async function noteWorkspaceWrite(root:string,inputPath:string,hash:string):Promise<void>{
  await workspaceSnapshotStore(root).noteWrite(inputPath,hash);
}
