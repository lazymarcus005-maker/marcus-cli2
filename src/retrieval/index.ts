import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readdir, stat } from "node:fs/promises";
import type { MacusConfig } from "../types.js";
import { ensureDir, fileHash, nowIso } from "../utils.js";
import { parseSymbols, type SymbolRecord } from "./symbols.js";
import { PathPolicy } from "../path-policy.js";
import { estimateTokens } from "../context/budget.js";

export class SymbolIndex {
  private constructor(readonly root:string, readonly config:MacusConfig, readonly db:DatabaseSync){}
  static async open(root:string,config:MacusConfig):Promise<SymbolIndex>{
    const dir=path.join(root,".macus","cache"); await ensureDir(dir);
    const db=new DatabaseSync(path.join(dir,"index.db"));
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS indexed_files(path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime_ns TEXT NOT NULL, content_hash TEXT NOT NULL, language TEXT, parse_status TEXT NOT NULL, parser_version TEXT NOT NULL, generation INTEGER NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS symbols(id TEXT PRIMARY KEY, path TEXT NOT NULL, language TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, qualified_name TEXT NOT NULL, signature TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, source_hash TEXT NOT NULL, coverage TEXT NOT NULL, generation INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name); CREATE INDEX IF NOT EXISTS idx_symbols_path ON symbols(path);");
    return new SymbolIndex(root,config,db);
  }

  async refresh(relPath:string):Promise<{changed:boolean;parseStatus:string;symbols:number;sourceHash:string}>{
    const policy=new PathPolicy(this.root);
    const {absolute:full,relative}=await policy.resolveReadable(relPath);
    const s=await stat(full); const observedHash=(await fileHash(full))!;
    const prior=this.db.prepare("SELECT content_hash,generation FROM indexed_files WHERE path=?").get(relative) as any;
    if(prior?.content_hash===observedHash) return {changed:false,parseStatus:"cached",symbols:Number((this.db.prepare("SELECT COUNT(*) n FROM symbols WHERE path=?").get(relative) as any).n),sourceHash:String(prior.content_hash)};
    const parsed=await parseSymbols(this.root,this.config,relative);
    const gen=Number(prior?.generation??0)+1;
    this.db.exec("BEGIN IMMEDIATE");
    try{
      this.db.prepare("DELETE FROM symbols WHERE path=?").run(relative);
      const ins=this.db.prepare("INSERT INTO symbols(id,path,language,kind,name,qualified_name,signature,start_line,end_line,source_hash,coverage,generation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
      for(const x of parsed.symbols) ins.run(x.id,x.path,x.language,x.kind,x.name,x.qualifiedName,x.signature,x.startLine,x.endLine,x.sourceHash,x.coverage,gen);
      this.db.prepare("INSERT INTO indexed_files(path,size,mtime_ns,content_hash,language,parse_status,parser_version,generation,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET size=excluded.size,mtime_ns=excluded.mtime_ns,content_hash=excluded.content_hash,language=excluded.language,parse_status=excluded.parse_status,parser_version=excluded.parser_version,generation=excluded.generation,updated_at=excluded.updated_at")
        .run(relative,s.size,String((s as any).mtimeNs??BigInt(Math.floor(s.mtimeMs*1e6))),parsed.sourceHash,parsed.symbols[0]?.language??null,parsed.parseStatus,"tree-sitter-0.21.1",gen,nowIso());
      this.db.exec("COMMIT");
    }catch(e){this.db.exec("ROLLBACK");throw e;}
    return {changed:true,parseStatus:parsed.parseStatus,symbols:parsed.symbols.length,sourceHash:parsed.sourceHash};
  }

  search(query:string,limit=50,scopePath?:string):SymbolRecord[]{
    const safeLimit=Math.min(Math.max(1,limit),100000);
    const rows=(scopePath
      ? this.db.prepare("SELECT * FROM symbols WHERE path=? AND (name LIKE ? OR qualified_name LIKE ?) ORDER BY start_line LIMIT ?").all(scopePath,"%"+query+"%","%"+query+"%",safeLimit)
      : this.db.prepare("SELECT * FROM symbols WHERE name LIKE ? OR qualified_name LIKE ? ORDER BY path,start_line LIMIT ?").all("%"+query+"%","%"+query+"%",safeLimit)) as any[];
    return rows.map(r=>({id:r.id,path:r.path,language:r.language,kind:r.kind,name:r.name,qualifiedName:r.qualified_name,signature:r.signature,startLine:r.start_line,endLine:r.end_line,sourceHash:r.source_hash,coverage:r.coverage}));
  }

  allSymbols(limit?:number):SymbolRecord[]{
    const rows=(limit===undefined
      ? this.db.prepare("SELECT * FROM symbols ORDER BY path,start_line").all()
      : this.db.prepare("SELECT * FROM symbols ORDER BY path,start_line LIMIT ?").all(Math.max(1,limit))) as any[];
    return rows.map(r=>({id:r.id,path:r.path,language:r.language,kind:r.kind,name:r.name,qualifiedName:r.qualified_name,signature:r.signature,startLine:r.start_line,endLine:r.end_line,sourceHash:r.source_hash,coverage:r.coverage}));
  }

  reconcileDiscovered(discovered:string[]):string[]{
    const keep=new Set(discovered);
    const indexed=(this.db.prepare("SELECT path FROM indexed_files").all() as any[]).map(r=>String(r.path));
    const removed=indexed.filter(p=>!keep.has(p));
    if(!removed.length) return [];
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const delSymbols=this.db.prepare("DELETE FROM symbols WHERE path=?");
      const delFiles=this.db.prepare("DELETE FROM indexed_files WHERE path=?");
      for(const file of removed){delSymbols.run(file);delFiles.run(file);}
      this.db.exec("COMMIT");
      return removed;
    }catch(e){this.db.exec("ROLLBACK");throw e;}
  }

  removeMissing(relPath:string):void{
    const policy=new PathPolicy(this.root);
    const relative=path.relative(this.root,policy.lexical(relPath));
    this.db.exec("BEGIN IMMEDIATE");
    try{this.db.prepare("DELETE FROM symbols WHERE path=?").run(relative);this.db.prepare("DELETE FROM indexed_files WHERE path=?").run(relative);this.db.exec("COMMIT");}
    catch(e){this.db.exec("ROLLBACK");throw e;}
  }

  repoMap(maxTokens=1200):string{
    const rows=this.db.prepare("SELECT path,name,signature,kind,start_line FROM symbols ORDER BY path,start_line").all() as any[];
    let out="",current="";
    for(const r of rows){
      if(r.path!==current){
        const h=(out?"\n\n":"")+r.path+"\n";
        if(estimateTokens(out+h)>maxTokens)break;
        out+=h;current=r.path;
      }
      const line="  "+r.kind+" "+(r.signature||r.name)+"\n";
      if(estimateTokens(out+line)>maxTokens)break;
      out+=line;
    }
    return out;
  }

  repoMapSnapshot(maxTokens=1200):{map:string;sources:Array<{path:string;hash:string}>}{
    const rows=this.db.prepare("SELECT s.path,s.name,s.signature,s.kind,s.start_line,f.content_hash FROM symbols s JOIN indexed_files f ON f.path=s.path ORDER BY s.path,s.start_line").all() as any[];
    let out="",current=""; const sourceMap=new Map<string,string>();
    for(const r of rows){
      if(r.path!==current){
        const h=(out?"\n\n":"")+r.path+"\n";
        if(estimateTokens(out+h)>maxTokens)break;
        out+=h;current=r.path;sourceMap.set(String(r.path),String(r.content_hash));
      }
      const line="  "+r.kind+" "+(r.signature||r.name)+"\n";
      if(estimateTokens(out+line)>maxTokens)break;
      out+=line;sourceMap.set(String(r.path),String(r.content_hash));
    }
    return {map:out,sources:[...sourceMap].map(([path,hash])=>({path,hash}))};
  }

  async discover(maxFiles=10000):Promise<{files:string[];truncated:boolean}>{
    const out:string[]=[]; let truncated=false; const policy=new PathPolicy(this.root); const ig=await policy.ignoreMatcher();
    const walk=async(dir:string):Promise<void>=>{
      const entries=await readdir(dir,{withFileTypes:true});
      for(const entry of entries){
        if(truncated)return;
        const full=path.join(dir,entry.name); const rel=path.relative(this.root,full); const key=rel.split(path.sep).join("/");
        if(policy.isDeniedRelative(rel)) continue;
        if(ig.ignores(entry.isDirectory()?key+"/":key)) continue;
        if(entry.isSymbolicLink()) continue;
        if(entry.isDirectory()) await walk(full);
        else if(entry.isFile()&&/\.(tsx?|jsx?|cs)$/.test(entry.name)){
          if(out.length>=maxFiles){truncated=true;return;}
          out.push(rel);
        }
      }
    };
    await walk(this.root); return {files:out,truncated};
  }

  close(){this.db.close();}
}
