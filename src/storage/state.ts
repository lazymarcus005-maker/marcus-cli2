import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ExecutionRecord, TaskRecord, TaskStatus } from "../types.js";
import { ensureDir, id, nowIso } from "../utils.js";
import { captureTrustedCommandSnapshot, type TrustedCommandSnapshot } from "../testing/discovery.js";

export class StateStore {
  readonly db: DatabaseSync;
  readonly dbPath: string;

  private constructor(dbPath: string, db: DatabaseSync) {
    this.dbPath = dbPath;
    this.db = db;
  }

  private timedSql<T>(sessionId:string|undefined,operation:string,fn:()=>T):T{
    const started=performance.now();
    try{return fn();}
    finally{
      const elapsed=performance.now()-started;
      try{
        this.db.prepare("INSERT INTO runtime_metrics(session_id,run_id,name,value,unit,metadata,created_at) VALUES(?,?,?,?,?,?,?)")
          .run(sessionId??null,null,"sqlite.operation_ms",elapsed,"ms",JSON.stringify({operation}),nowIso());
      }catch{}
    }
  }

  static async open(root: string): Promise<StateStore> {
    const dir = path.join(root, ".macus", "state");
    await ensureDir(dir);
    const dbPath = path.join(dir, "state.db");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
    const store = new StateStore(dbPath, db);
    store.migrate();
    return store;
  }

  migrate(failpoint?: "after_schema_metadata"): void {
    const metadataExists = Number((this.db.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='schema_metadata'"
    ).get() as any)?.n ?? 0) > 0;
    if (metadataExists) {
      const existing = Number((this.db.prepare("SELECT version FROM schema_metadata LIMIT 1").get() as any)?.version ?? 0);
      if (existing > 2) throw new Error(`Unsupported future state schema ${existing}`);
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS schema_metadata(version INTEGER NOT NULL);
        INSERT INTO schema_metadata(version) SELECT 2 WHERE NOT EXISTS(SELECT 1 FROM schema_metadata);
      `);
      if (failpoint === "after_schema_metadata") throw new Error("Injected migration failure");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions(
          id TEXT PRIMARY KEY, root TEXT NOT NULL, repo_identity TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS runs(
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
          status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT
        );
        CREATE TABLE IF NOT EXISTS tasks(
          session_id TEXT NOT NULL REFERENCES sessions(id), id TEXT NOT NULL, title TEXT NOT NULL,
          status TEXT NOT NULL, related_files TEXT NOT NULL, related_symbols TEXT NOT NULL,
          notes TEXT, evidence_ids TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          PRIMARY KEY(session_id,id)
        );
        CREATE TABLE IF NOT EXISTS ledger_revisions(
          session_id TEXT NOT NULL REFERENCES sessions(id), revision INTEGER NOT NULL,
          payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(session_id,revision)
        );
        CREATE TABLE IF NOT EXISTS executions(
          execution_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
          run_id TEXT, tool_call_id TEXT, command TEXT, cwd TEXT, status TEXT NOT NULL,
          effect_class TEXT NOT NULL, prepared_at TEXT NOT NULL, finished_at TEXT,
          exit_code INTEGER, signal TEXT, timed_out INTEGER, cancelled INTEGER,
          output_complete INTEGER, truncated INTEGER, log_ref TEXT, before_hash TEXT, after_hash TEXT,
          payload TEXT
        );
        CREATE TABLE IF NOT EXISTS execution_events(
          id INTEGER PRIMARY KEY AUTOINCREMENT, execution_id TEXT NOT NULL REFERENCES executions(execution_id),
          status TEXT NOT NULL, at TEXT NOT NULL, payload TEXT
        );
        CREATE TABLE IF NOT EXISTS test_evidence(
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
          run_id TEXT, payload TEXT NOT NULL, snapshot_digest TEXT NOT NULL,
          status TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS checkpoints(
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
          state_revision INTEGER NOT NULL, file_path TEXT NOT NULL, committed INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS session_trust_snapshots(
          session_id TEXT PRIMARY KEY REFERENCES sessions(id), payload TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS decision_events(
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), run_id TEXT, event_id TEXT NOT NULL,
          kind TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, mode TEXT NOT NULL, schema_version INTEGER NOT NULL,
          state_digest TEXT NOT NULL, request_metadata TEXT NOT NULL, response_payload TEXT, confidence_summary TEXT,
          latency_ms INTEGER, status TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_decision_events_session_created ON decision_events(session_id,created_at);
        CREATE TABLE IF NOT EXISTS session_trust_history(
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), payload TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS runtime_metrics(
          id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, run_id TEXT, name TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL,
          metadata TEXT, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runtime_metrics_session_name ON runtime_metrics(session_id,name,created_at);
        UPDATE schema_metadata SET version=2 WHERE version<2;
      `);
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  createSession(root: string, repoIdentity: string, sessionId = id("session")): string {
    const started=performance.now();
    const now=nowIso();
    const trust=captureTrustedCommandSnapshot(root);
    this.timedSql(sessionId,"session.create",()=>{
      this.db.prepare("INSERT INTO sessions(id,root,repo_identity,created_at,updated_at) VALUES(?,?,?,?,?)").run(sessionId,root,repoIdentity,now,now);
      this.db.prepare("INSERT INTO session_trust_snapshots(session_id,payload,created_at) VALUES(?,?,?)").run(sessionId,JSON.stringify(trust),now);
    });
    this.recordMetric({sessionId,name:"session.create_ms",value:performance.now()-started});
    return sessionId;
  }

  ensureSession(root: string, repoIdentity: string, sessionId?: string): string {
    if (sessionId) {
      const row = this.db.prepare("SELECT id,root,repo_identity FROM sessions WHERE id=?").get(sessionId) as any;
      if (!row) throw new Error(`Unknown session ${sessionId}`);
      if (row.root !== root || row.repo_identity !== repoIdentity) throw new Error("Session/worktree identity mismatch");
      return sessionId;
    }
    return this.createSession(root, repoIdentity);
  }


  trustedCommandSnapshot(sessionId:string):TrustedCommandSnapshot|undefined {
    const row=this.db.prepare("SELECT payload FROM session_trust_snapshots WHERE session_id=?").get(sessionId) as any;
    if(!row) return undefined;
    try{return JSON.parse(row.payload) as TrustedCommandSnapshot;}catch{return undefined;}
  }

  createRun(sessionId: string): string {
    const runId=id("run");
    this.timedSql(sessionId,"run.create",()=>this.db.prepare("INSERT INTO runs(id,session_id,status,started_at) VALUES(?,?,?,?)").run(runId,sessionId,"running",nowIso()));
    return runId;
  }

  finishRun(runId: string, status: string): void {
    const row=this.db.prepare("SELECT session_id FROM runs WHERE id=?").get(runId) as any;
    this.timedSql(row?.session_id?String(row.session_id):undefined,"run.finish",()=>this.db.prepare("UPDATE runs SET status=?,finished_at=? WHERE id=?").run(status,nowIso(),runId));
  }

  upsertTask(task: TaskRecord): void {
    if (task.status === "in_progress") {
      const other = this.db.prepare("SELECT id FROM tasks WHERE session_id=? AND status='in_progress' AND id<>?")
        .get(task.sessionId, task.id);
      if (other) throw new Error("Only one in_progress task is allowed per session");
    }
    this.db.prepare(`INSERT INTO tasks(session_id,id,title,status,related_files,related_symbols,notes,evidence_ids,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(session_id,id) DO UPDATE SET title=excluded.title,status=excluded.status,
      related_files=excluded.related_files,related_symbols=excluded.related_symbols,notes=excluded.notes,
      evidence_ids=excluded.evidence_ids,updated_at=excluded.updated_at`)
      .run(task.sessionId, task.id, task.title, task.status, JSON.stringify(task.relatedFiles),
        JSON.stringify(task.relatedSymbols), task.notes ?? null, JSON.stringify(task.evidenceIds), task.createdAt, task.updatedAt);
  }

  listTasks(sessionId: string): TaskRecord[] {
    return (this.db.prepare("SELECT * FROM tasks WHERE session_id=? ORDER BY created_at").all(sessionId) as any[]).map(r => ({
      sessionId: r.session_id, id: r.id, title: r.title, status: r.status as TaskStatus,
      relatedFiles: JSON.parse(r.related_files), relatedSymbols: JSON.parse(r.related_symbols),
      notes: r.notes ?? undefined, evidenceIds: JSON.parse(r.evidence_ids), createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  }

  prepareExecution(record: Omit<ExecutionRecord, "status" | "preparedAt"> & { payload?: unknown }): void {
    const preparedAt = nowIso();
    this.db.prepare(`INSERT INTO executions(execution_id,session_id,run_id,tool_call_id,command,cwd,status,effect_class,prepared_at,before_hash,payload)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(record.executionId, record.sessionId, record.runId ?? null,
      record.toolCallId ?? null, record.command ?? null, record.cwd ?? null, "prepared", record.effectClass,
      preparedAt, record.beforeHash ?? null, JSON.stringify(record.payload ?? null));
    this.event(record.executionId, "prepared");
  }

  markExecution(executionId: string, status: ExecutionRecord["status"], patch: Partial<ExecutionRecord> = {}): void {
    this.db.prepare(`UPDATE executions SET status=?,finished_at=?,exit_code=?,signal=?,timed_out=?,cancelled=?,
      output_complete=?,truncated=?,log_ref=?,after_hash=? WHERE execution_id=?`)
      .run(status, patch.finishedAt ?? (status === "started" ? null : nowIso()), patch.exitCode ?? null,
        patch.signal ?? null, patch.timedOut ? 1 : 0, patch.cancelled ? 1 : 0,
        patch.outputComplete === false ? 0 : 1, patch.truncated ? 1 : 0,
        patch.logRef ?? null, patch.afterHash ?? null, executionId);
    this.event(executionId, status, patch);
  }

  private event(executionId: string, status: string, payload?: unknown): void {
    this.db.prepare("INSERT INTO execution_events(execution_id,status,at,payload) VALUES(?,?,?,?)")
      .run(executionId, status, nowIso(), JSON.stringify(payload ?? null));
  }

  unknownExecutions(sessionId: string): any[] {
    return this.db.prepare("SELECT * FROM executions WHERE session_id=? AND status IN ('prepared','started','unknown')")
      .all(sessionId) as any[];
  }


  recordDecisionEvent(input:{
    id:string;sessionId:string;runId?:string;eventId:string;kind:string;provider:string;model:string;mode:string;schemaVersion:number;
    stateDigest:string;requestMetadata:unknown;responsePayload?:unknown;confidenceSummary?:unknown;latencyMs?:number;status:string;
  }):void{
    this.db.prepare(`INSERT INTO decision_events(id,session_id,run_id,event_id,kind,provider,model,mode,schema_version,state_digest,request_metadata,response_payload,confidence_summary,latency_ms,status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        input.id,input.sessionId,input.runId??null,input.eventId,input.kind,input.provider,input.model,input.mode,input.schemaVersion,input.stateDigest,
        JSON.stringify(input.requestMetadata??null),input.responsePayload===undefined?null:JSON.stringify(input.responsePayload),
        input.confidenceSummary===undefined?null:JSON.stringify(input.confidenceSummary),input.latencyMs??null,input.status,nowIso()
      );
  }

  listDecisionEvents(sessionId:string,limit=100):any[]{
    return this.db.prepare("SELECT * FROM decision_events WHERE session_id=? ORDER BY created_at DESC LIMIT ?").all(sessionId,Math.min(Math.max(1,limit),1000)) as any[];
  }


  decisionMetrics(sessionId:string):{total:number;success:number;byKind:Record<string,number>;byStatus:Record<string,number>;averageLatencyMs:number|null}{
    const rows=this.db.prepare("SELECT kind,status,latency_ms FROM decision_events WHERE session_id=?").all(sessionId) as any[];
    const byKind:Record<string,number>={},byStatus:Record<string,number>={};
    let latencyTotal=0,latencyCount=0;
    for(const row of rows){
      byKind[row.kind]=(byKind[row.kind]??0)+1;
      byStatus[row.status]=(byStatus[row.status]??0)+1;
      if(Number.isFinite(row.latency_ms)){latencyTotal+=Number(row.latency_ms);latencyCount++;}
    }
    return {total:rows.length,success:byStatus.success??0,byKind,byStatus,averageLatencyMs:latencyCount?latencyTotal/latencyCount:null};
  }

  appendLedger(sessionId: string, payload: unknown): number {
    return this.timedSql(sessionId,"ledger.append",()=>{
      const row=this.db.prepare("SELECT COALESCE(MAX(revision),0)+1 AS n FROM ledger_revisions WHERE session_id=?").get(sessionId) as any;
      const revision=Number(row.n);
      this.db.prepare("INSERT INTO ledger_revisions(session_id,revision,payload,created_at) VALUES(?,?,?,?)").run(sessionId,revision,JSON.stringify(payload),nowIso());
      return revision;
    });
  }

  session(sessionId:string):{id:string;root:string;repoIdentity:string;createdAt:string;updatedAt:string}|undefined{
    const row=this.db.prepare("SELECT id,root,repo_identity,created_at,updated_at FROM sessions WHERE id=?").get(sessionId) as any;
    return row?{id:String(row.id),root:String(row.root),repoIdentity:String(row.repo_identity),createdAt:String(row.created_at),updatedAt:String(row.updated_at)}:undefined;
  }

  sessionCount():number{
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as any)?.n??0);
  }

  runBelongsToSession(runId:string,sessionId:string):boolean{
    return Boolean(this.db.prepare("SELECT 1 FROM runs WHERE id=? AND session_id=?").get(runId,sessionId));
  }

  latestLedgerRevision(sessionId:string):{revision:number;payload:any}|undefined{
    const row=this.db.prepare("SELECT revision,payload FROM ledger_revisions WHERE session_id=? ORDER BY revision DESC LIMIT 1").get(sessionId) as any;
    if(!row)return undefined;
    try{return {revision:Number(row.revision),payload:JSON.parse(row.payload)};}catch{return undefined;}
  }

  recordEvidence(input:{id:string;sessionId:string;runId?:string;payload:unknown;snapshotDigest:string;status:string}):void{
    this.timedSql(input.sessionId,"evidence.record",()=>this.db.prepare("INSERT INTO test_evidence(id,session_id,run_id,payload,snapshot_digest,status,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(input.id,input.sessionId,input.runId??null,JSON.stringify(input.payload),input.snapshotDigest,input.status,nowIso()));
  }

  listEvidence(sessionId:string,limit?:number):Array<{id:string;status:string;snapshotDigest:string;payload:any}>{
    const rows=(limit
      ?this.db.prepare("SELECT id,status,snapshot_digest,payload FROM test_evidence WHERE session_id=? ORDER BY created_at DESC LIMIT ?").all(sessionId,limit)
      :this.db.prepare("SELECT id,status,snapshot_digest,payload FROM test_evidence WHERE session_id=? ORDER BY created_at DESC").all(sessionId)) as any[];
    return rows.map(row=>{let payload:any={};try{payload=JSON.parse(row.payload);}catch{}return {id:String(row.id),status:String(row.status),snapshotDigest:String(row.snapshot_digest),payload};});
  }

  completedWorkspaceEditPayloads(sessionId:string):any[]{
    return (this.db.prepare("SELECT payload FROM executions WHERE session_id=? AND effect_class='workspace_edit' AND status='completed'").all(sessionId) as any[]).map(row=>{try{return JSON.parse(row.payload??"{}")??{};}catch{return {};}});
  }

  recordCheckpoint(input:{id:string;sessionId:string;stateRevision:number;filePath:string;committed?:boolean}):void{
    this.db.prepare("INSERT INTO checkpoints(id,session_id,state_revision,file_path,committed,created_at) VALUES(?,?,?,?,?,?)")
      .run(input.id,input.sessionId,input.stateRevision,input.filePath,input.committed===false?0:1,nowIso());
  }

  checkpoints(sessionId:string):any[]{
    return this.db.prepare("SELECT id,state_revision,committed,created_at,file_path FROM checkpoints WHERE session_id=? ORDER BY created_at DESC").all(sessionId) as any[];
  }

  checkpoint(checkpointId:string):any|undefined{
    return this.db.prepare("SELECT id,session_id,state_revision,file_path,committed,created_at FROM checkpoints WHERE id=?").get(checkpointId) as any;
  }

  invalidateCheckpoint(checkpointId:string):void{this.db.prepare("UPDATE checkpoints SET committed=0 WHERE id=?").run(checkpointId);}

  replaceTasks(sessionId:string,tasks:TaskRecord[]):void{
    this.db.prepare("DELETE FROM tasks WHERE session_id=?").run(sessionId);
    for(const task of tasks)this.upsertTask(task);
  }

  transaction<T>(fn:()=>T):T{
    this.db.exec("BEGIN IMMEDIATE");
    try{const result=fn();this.db.exec("COMMIT");return result;}catch(error){try{this.db.exec("ROLLBACK");}catch{}throw error;}
  }

  refreshTrustedCommandSnapshot(sessionId:string,root:string,reason="explicit_user_refresh"):TrustedCommandSnapshot{
    const previous=this.trustedCommandSnapshot(sessionId);
    if(previous)this.db.prepare("INSERT INTO session_trust_history(id,session_id,payload,reason,created_at) VALUES(?,?,?,?,?)")
      .run(id("trust"),sessionId,JSON.stringify(previous),reason,nowIso());
    const next=captureTrustedCommandSnapshot(root);
    this.db.prepare("INSERT INTO session_trust_snapshots(session_id,payload,created_at) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at")
      .run(sessionId,JSON.stringify(next),nowIso());
    return next;
  }

  trustHistory(sessionId:string,limit=20):TrustedCommandSnapshot[]{
    return (this.db.prepare("SELECT payload FROM session_trust_history WHERE session_id=? ORDER BY created_at DESC LIMIT ?").all(sessionId,limit) as any[])
      .flatMap(row=>{try{return [JSON.parse(row.payload) as TrustedCommandSnapshot];}catch{return [];}});
  }

  recordMetric(input:{sessionId?:string;runId?:string;name:string;value:number;unit?:string;metadata?:unknown}):void{
    if(!Number.isFinite(input.value))return;
    this.db.prepare("INSERT INTO runtime_metrics(session_id,run_id,name,value,unit,metadata,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(input.sessionId??null,input.runId??null,input.name,input.value,input.unit??"ms",JSON.stringify(input.metadata??null),nowIso());
  }

  metricSummary(sessionId?:string):Record<string,{count:number;avg:number;min:number;max:number}>{
    const rows=(sessionId
      ?this.db.prepare("SELECT name,COUNT(*) count,AVG(value) avg,MIN(value) min,MAX(value) max FROM runtime_metrics WHERE session_id=? GROUP BY name").all(sessionId)
      :this.db.prepare("SELECT name,COUNT(*) count,AVG(value) avg,MIN(value) min,MAX(value) max FROM runtime_metrics GROUP BY name").all()) as any[];
    return Object.fromEntries(rows.map(r=>[String(r.name),{count:Number(r.count),avg:Number(r.avg),min:Number(r.min),max:Number(r.max)}]));
  }

  close(): void { this.db.close(); }
}
