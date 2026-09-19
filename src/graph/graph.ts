import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { ensureDir, nowIso, sha256 } from "../utils.js";
import type { Resolution } from "../types.js";
import type { SymbolRecord } from "../retrieval/symbols.js";

export interface GraphEdge {
  id: string; edgeType: string; fromId: string; toId?: string;
  targetText: string; resolution: Resolution; confidence: number;
  evidence: { path:string; startLine:number; endLine:number; hash:string; method:string };
  resolverVersion: string; indexGeneration: number;
}

export class GraphStore {
  private constructor(readonly db: DatabaseSync) {}
  static async open(root:string): Promise<GraphStore> {
    const dir=path.join(root,".macus","cache"); await ensureDir(dir);
    const db=new DatabaseSync(path.join(dir,"index.db"));
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS graph_edges(id TEXT PRIMARY KEY, edge_type TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT, target_text TEXT NOT NULL, resolution TEXT NOT NULL, confidence REAL NOT NULL, evidence TEXT NOT NULL, resolver_version TEXT NOT NULL, index_generation INTEGER NOT NULL, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_graph_from ON graph_edges(from_id); CREATE INDEX IF NOT EXISTS idx_graph_to ON graph_edges(to_id);");
    return new GraphStore(db);
  }

  private insertEdges(edges:Omit<GraphEdge,"id">[]):void{
    const stmt=this.db.prepare("INSERT INTO graph_edges(id,edge_type,from_id,to_id,target_text,resolution,confidence,evidence,resolver_version,index_generation,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    for(const e of edges){
      const edgeId=sha256([e.edgeType,e.fromId,e.toId??"",e.targetText,JSON.stringify(e.evidence),e.indexGeneration].join("|")).slice(0,32);
      stmt.run(edgeId,e.edgeType,e.fromId,e.toId??null,e.targetText,e.resolution,e.confidence,JSON.stringify(e.evidence),e.resolverVersion,e.indexGeneration,nowIso());
    }
  }

  replaceEdgesForSource(fromId:string,edges:Omit<GraphEdge,"id">[]):void{
    this.db.exec("BEGIN IMMEDIATE");
    try{
      this.db.prepare("DELETE FROM graph_edges WHERE from_id=?").run(fromId);
      this.insertEdges(edges);
      this.db.exec("COMMIT");
    }catch(e){this.db.exec("ROLLBACK");throw e;}
  }

  invalidateFile(filePath:string):void{
    this.replaceEdgesForFile(filePath,[]);
  }

  replaceEdgesForFile(filePath:string,edges:Omit<GraphEdge,"id">[]):void{
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const rows=this.db.prepare("SELECT id,evidence FROM graph_edges").all() as any[];
      const del=this.db.prepare("DELETE FROM graph_edges WHERE id=?");
      for(const row of rows){
        try{
          const evidence=JSON.parse(row.evidence);
          if(evidence?.path===filePath) del.run(row.id);
        }catch{}
      }
      this.insertEdges(edges);
      this.db.exec("COMMIT");
    }catch(e){this.db.exec("ROLLBACK");throw e;}
  }

  pruneDangling(validSymbolIds:Iterable<string>):number{
    const valid=new Set(validSymbolIds);
    const rows=this.db.prepare("SELECT id,to_id,from_id,edge_type FROM graph_edges").all() as any[];
    const del=this.db.prepare("DELETE FROM graph_edges WHERE id=?");
    let removed=0;
    this.db.exec("BEGIN IMMEDIATE");
    try{
      for(const row of rows){
        const staleTarget=row.to_id && !valid.has(row.to_id);
        const staleSource=row.edge_type!=="contains" && !String(row.from_id).startsWith("file:") && !valid.has(row.from_id);
        if(staleTarget||staleSource){del.run(row.id);removed++;}
      }
      this.db.exec("COMMIT");
      return removed;
    }catch(e){this.db.exec("ROLLBACK");throw e;}
  }

  find(id:string):GraphEdge[]{
    const rows=this.db.prepare("SELECT * FROM graph_edges WHERE from_id=? OR to_id=? ORDER BY confidence DESC").all(id,id) as any[];
    return rows.map(r=>({id:r.id,edgeType:r.edge_type,fromId:r.from_id,toId:r.to_id??undefined,targetText:r.target_text,resolution:r.resolution,confidence:r.confidence,evidence:JSON.parse(r.evidence),resolverVersion:r.resolver_version,indexGeneration:r.index_generation}));
  }
  references(symbolId:string):GraphEdge[]{return this.find(symbolId).filter(e=>e.edgeType==="references"&&e.toId===symbolId);}
  dependencies(symbolId:string):GraphEdge[]{return this.find(symbolId).filter(e=>e.fromId===symbolId);}
  dependents(symbolId:string):GraphEdge[]{return this.find(symbolId).filter(e=>e.toId===symbolId);}
  impact(symbolId:string):{confirmed:GraphEdge[];candidate:GraphEdge[];unresolved:GraphEdge[];coverage:"partial"}{
    const edges=this.find(symbolId);
    return {confirmed:edges.filter(e=>e.resolution==="confirmed"),candidate:edges.filter(e=>e.resolution==="candidate"),unresolved:edges.filter(e=>e.resolution==="unresolved"),coverage:"partial"};
  }
  close(){this.db.close();}
}

export async function buildLightweightEdges(root:string,filePath:string,fileHash:string,symbols:SymbolRecord[],allSymbols:SymbolRecord[],generation=1):Promise<Array<Omit<GraphEdge,"id">>>{
  const source=await readFile(path.join(root,filePath),"utf8");
  const edges:Array<Omit<GraphEdge,"id">>=[];
  const fileId="file:"+sha256(filePath).slice(0,20);
  const words=new Set(source.slice(0,Math.min(source.length,200000)).match(/[A-Za-z_$][\w$]*/g)??[]);
  for(const s of symbols){
    edges.push({edgeType:"contains",fromId:fileId,toId:s.id,targetText:s.qualifiedName,resolution:"confirmed",confidence:1,evidence:{path:filePath,startLine:s.startLine,endLine:s.endLine,hash:fileHash,method:"tree-sitter-containment"},resolverVersion:"1",indexGeneration:generation});
    for(const name of words){
      if(name===s.name)continue;
      const candidates=allSymbols.filter(x=>x.name===name&&x.id!==s.id);
      if(candidates.length===1){
        edges.push({edgeType:"references",fromId:s.id,toId:candidates[0].id,targetText:name,resolution:"candidate",confidence:0.5,evidence:{path:filePath,startLine:s.startLine,endLine:s.endLine,hash:fileHash,method:"identifier-candidate"},resolverVersion:"1",indexGeneration:generation});
      }else if(candidates.length>1){
        edges.push({edgeType:"references",fromId:s.id,targetText:name,resolution:"unresolved",confidence:0.2,evidence:{path:filePath,startLine:s.startLine,endLine:s.endLine,hash:fileHash,method:"ambiguous-identifier"},resolverVersion:"1",indexGeneration:generation});
      }
    }
  }
  return edges;
}
