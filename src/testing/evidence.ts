import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { StateStore } from "../storage/state.js";
import { PolicyExecutor, type CommandResult } from "../policy.js";
import { id, nowIso } from "../utils.js";
import { PathPolicy } from "../path-policy.js";
import { classifyTestCommand, trustedSnapshotDigest } from "./discovery.js";
import { gitState, repositoryIdentity } from "../repository.js";
import { snapshotDigestCached, workspaceSnapshotStore } from "./snapshot-store.js";

export interface TestCounts {total:number;passed:number;failed:number;skipped:number;}
export interface TestEvidence {
  id:string; command:string; cwd:string; startedAt:string; finishedAt:string;
  exitCode:number|null; signal:string|null; timedOut:boolean; cancelled:boolean;
  outputComplete:boolean; parserStatus:"parsed"|"partial"|"unsupported"|"error";
  testCounts:TestCounts|null;
  logRef?:string; snapshotDigest:string; status:"passed"|"failed"|"unknown"|"not_run";
  trustedCommand:boolean; trustReason:string; trustSources:string[]; trustSnapshotDigest?:string;
  repoIdentity:string; head?:string;
  reportPath?:string; reportFormat?:"junit"|"trx"; reportFresh?:boolean; reportBytes?:number;
}

export async function snapshotDigest(root:string):Promise<string>{ return snapshotDigestCached(root); }

function xmlIntAttr(tag:string,name:string):number|undefined{
  const m=tag.match(new RegExp(`\\b${name}=["'](\\d+)["']`,"i"));
  return m?Number(m[1]):undefined;
}

export function parseJUnitXml(xml:string):TestCounts|null{
  const suites=[...xml.matchAll(/<testsuite\b[^>]*>/gi)].map(m=>m[0]);
  let child:TestCounts|null=null;
  if(suites.length){
    let total=0,failed=0,skipped=0;
    for(const suite of suites){
      const tests=xmlIntAttr(suite,"tests");
      if(tests===undefined)return null;
      total+=tests;
      failed+=(xmlIntAttr(suite,"failures")??0)+(xmlIntAttr(suite,"errors")??0);
      skipped+=(xmlIntAttr(suite,"skipped")??0)+(xmlIntAttr(suite,"disabled")??0);
    }
    if(failed+skipped>total)return null;
    child={total,failed,skipped,passed:total-failed-skipped};
  }
  const root=xml.match(/<testsuites\b[^>]*>/i)?.[0];
  if(root){
    const total=xmlIntAttr(root,"tests");
    if(total!==undefined){
      const failed=(xmlIntAttr(root,"failures")??0)+(xmlIntAttr(root,"errors")??0);
      const skipped=(xmlIntAttr(root,"skipped")??0)+(xmlIntAttr(root,"disabled")??0);
      if(failed+skipped>total)return null;
      const aggregate={total,failed,skipped,passed:total-failed-skipped};
      if(child&&(child.total!==aggregate.total||child.failed!==aggregate.failed||child.skipped!==aggregate.skipped))return null;
      return aggregate;
    }
  }
  return child;
}

export function parseTrxXml(xml:string):TestCounts|null{
  const counters=xml.match(/<Counters\b[^>]*\btotal=["'](\d+)["'][^>]*>/i);
  if(!counters)return null;
  const tag=counters[0];
  const attr=(name:string)=>Number((tag.match(new RegExp("\\b"+name+"=[\"'](\\d+)[\"']","i"))??[])[1]??0);
  const total=Number(counters[1]); const passed=attr("passed"); const failed=attr("failed")+attr("error"); const skipped=attr("notExecuted")+attr("inconclusive");
  if(passed+failed+skipped!==total)return null;
  return {total,passed,failed,skipped};
}

function parseConsole(text:string):TestCounts|null{
  const vitest=text.match(/Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed(?:\s*\|\s*(\d+) skipped)?/i);
  if(vitest){
    const failed=Number(vitest[1]??0),passed=Number(vitest[2]??0),skipped=Number(vitest[3]??0);
    return {total:failed+passed+skipped,passed,failed,skipped};
  }
  const m=text.match(/tests?\s+(\d+).*passed\s+(\d+).*failed\s+(\d+)/i);
  if(!m) return null;
  return {total:Number(m[1]),passed:Number(m[2]),failed:Number(m[3]),skipped:0};
}

export async function parseReport(reportPath:string,format:"junit"|"trx",maxBytes=8*1024*1024):Promise<{counts:TestCounts|null;status:"parsed"|"partial"|"error";bytes?:number}>{
  try{
    const info=await stat(reportPath);
    if(!info.isFile()||info.size>maxBytes)return {counts:null,status:"partial",bytes:info.size};
    const xml=await readFile(reportPath,"utf8");
    const counts=format==="junit"?parseJUnitXml(xml):parseTrxXml(xml);
    return {counts,status:counts?"parsed":"partial",bytes:info.size};
  }catch{return {counts:null,status:"error"};}
}


async function validateReportContainer(policy:PathPolicy,reportPath:string):Promise<void>{
  let candidate=path.dirname(reportPath)||".";
  while(true){
    try{await policy.resolveReadable(candidate);return;}
    catch(error:any){
      if(error?.code!=="ENOENT")throw error;
      const parent=path.dirname(candidate);
      if(parent===candidate)throw error;
      candidate=parent||".";
    }
  }
}

async function reportState(file:string|undefined):Promise<{exists:boolean;mtimeMs?:number;ctimeMs?:number;size?:number}>{
  if(!file)return {exists:false};
  try{
    const s=await stat(file);
    return {exists:s.isFile(),mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs,size:s.size};
  }catch{return {exists:false};}
}

interface VerificationExecutionArgs {
  root:string;sessionId:string;runId?:string;toolCallId?:string;command:string;executor:PolicyExecutor;store:StateStore;
  reportPath?:string;reportFormat?:"junit"|"trx"; signal?:AbortSignal;
}

async function runVerifiedCommand(
  args:VerificationExecutionArgs & { effectClass:"test_build"|"shell"; timeoutSeconds?:number },
  execute:()=>Promise<CommandResult>,
):Promise<{evidence:TestEvidence;command:CommandResult}>{
  const metricStarted=performance.now();
  const snapshotStore=workspaceSnapshotStore(args.root);
  const policy=new PathPolicy(args.root);
  let reportFile:string|undefined;
  if(args.reportPath){
    reportFile=policy.lexical(args.reportPath);
    const rel=path.relative(args.root,reportFile);
    policy.assertAllowedRelative(rel);
    await validateReportContainer(policy,args.reportPath);
  }

  const trustSnapshot=args.store.trustedCommandSnapshot(args.sessionId);
  const trust=await classifyTestCommand(args.root,args.command,trustSnapshot);
  const beforeReport=await reportState(reportFile);
  if(beforeReport.exists&&args.reportPath) await policy.resolveReadable(args.reportPath);
  const beforeStarted=performance.now();
  const [before,repoIdBefore,gitBefore]=await Promise.all([
    snapshotStore.digest(),repositoryIdentity(args.root),gitState(args.root)
  ]);
  const beforeStats=snapshotStore.lastStats;
  args.store.recordMetric({sessionId:args.sessionId,runId:args.runId,name:"snapshot.digest_ms",value:performance.now()-beforeStarted});
  args.store.recordMetric({sessionId:args.sessionId,runId:args.runId,name:"snapshot.bytes_read",value:beforeStats.bytesRead,unit:"bytes"});
  args.store.recordMetric({sessionId:args.sessionId,runId:args.runId,name:"snapshot.hash_reused_files",value:beforeStats.reusedFiles,unit:"files"});
  args.store.recordMetric({sessionId:args.sessionId,runId:args.runId,name:"snapshot.hash_rehashed_files",value:beforeStats.hashedFiles,unit:"files"});
  const startedAt=nowIso();
  const r=await execute();
  const afterStarted=performance.now();
  const [after,repoIdAfter,gitAfter,afterReport]=await Promise.all([
    snapshotStore.digest(),repositoryIdentity(args.root),gitState(args.root),reportState(reportFile)
  ]);
  const afterStats=snapshotStore.lastStats;
  args.store.recordMetric({sessionId:args.sessionId,runId:args.runId,name:"snapshot.digest_ms",value:performance.now()-afterStarted});
  args.store.recordMetric({sessionId:args.sessionId,runId:args.runId,name:"snapshot.bytes_read",value:afterStats.bytesRead,unit:"bytes"});
  args.store.recordMetric({sessionId:args.sessionId,runId:args.runId,name:"snapshot.hash_reused_files",value:afterStats.reusedFiles,unit:"files"});
  args.store.recordMetric({sessionId:args.sessionId,runId:args.runId,name:"snapshot.hash_rehashed_files",value:afterStats.hashedFiles,unit:"files"});
  if(afterReport.exists&&args.reportPath) await policy.resolveReadable(args.reportPath);

  let parsed:TestCounts|null=null;
  let parserStatus:TestEvidence["parserStatus"]="unsupported";
  let reportBytes:number|undefined;
  const structured=Boolean(reportFile&&args.reportFormat);
  const reportFresh=structured && afterReport.exists && (
    !beforeReport.exists ||
    beforeReport.mtimeMs!==afterReport.mtimeMs ||
    beforeReport.ctimeMs!==afterReport.ctimeMs ||
    beforeReport.size!==afterReport.size
  );

  if(reportFile&&args.reportFormat&&reportFresh){
    const maxReportBytes=Math.min(args.executor.config.execution.max_output_memory_bytes,8*1024*1024);
    const rp=await parseReport(reportFile,args.reportFormat,maxReportBytes);
    parsed=rp.counts; parserStatus=rp.status; reportBytes=rp.bytes;
  }else if(structured){
    parserStatus="partial";
  }else{
    parsed=parseConsole(r.stdout+"\n"+r.stderr); parserStatus=parsed?"parsed":"unsupported";
  }

  let status:TestEvidence["status"]="unknown";
  const identityStable=repoIdBefore===repoIdAfter&&gitBefore.head===gitAfter.head;
  const outputSufficient=structured?parserStatus==="parsed"&&reportFresh:r.outputComplete;
  if(r.exitCode!==0 || (parsed?.failed??0)>0) status="failed";
  else if(
    trust.trusted&&!r.timedOut&&!r.cancelled&&r.exitCode===0&&parsed&&parsed.total>0&&parsed.failed===0&&
    before===after&&identityStable&&outputSufficient
  ) status="passed";

  const ev:TestEvidence={
    id:id("evidence"),command:args.command,cwd:args.root,startedAt,finishedAt:nowIso(),
    exitCode:r.exitCode,signal:r.signal,timedOut:r.timedOut,cancelled:r.cancelled,outputComplete:r.outputComplete,
    parserStatus,testCounts:parsed,logRef:r.logRef,snapshotDigest:after,status,
    trustedCommand:trust.trusted,trustReason:trust.reason,trustSources:trust.sources,trustSnapshotDigest:trustedSnapshotDigest(trustSnapshot),
    repoIdentity:repoIdAfter,head:gitAfter.head,
    reportPath:reportFile?path.relative(args.root,reportFile):undefined,reportFormat:args.reportFormat,
    reportFresh:structured?Boolean(reportFresh):undefined,reportBytes,
  };
  args.store.recordEvidence({id:ev.id,sessionId:args.sessionId,runId:args.runId,payload:ev,snapshotDigest:ev.snapshotDigest,status:ev.status});
  args.store.recordMetric({sessionId:args.sessionId,runId:args.runId,name:"test.duration_ms",value:performance.now()-metricStarted});
  return {evidence:ev,command:r};
}

export async function runTest(args:VerificationExecutionArgs):Promise<TestEvidence>{
  const result=await runVerifiedCommand({...args,effectClass:"test_build"},()=>args.executor.run(args.command,{
    timeoutSeconds:args.executor.config.execution.test_build_timeout_seconds,
    effectClass:"test_build",signal:args.signal,runId:args.runId,toolCallId:args.toolCallId,
  }));
  return result.evidence;
}

export async function runCommandWithEvidence(args:VerificationExecutionArgs & {timeoutSeconds?:number}):Promise<{command:CommandResult;evidence?:TestEvidence}>{
  const trust=await classifyTestCommand(args.root,args.command,args.store.trustedCommandSnapshot(args.sessionId));
  if(!trust.trusted){
    const command=await args.executor.run(args.command,{
      timeoutSeconds:args.timeoutSeconds,
      effectClass:"shell",signal:args.signal,runId:args.runId,toolCallId:args.toolCallId,
    });
    return {command};
  }
  const result=await runVerifiedCommand({...args,effectClass:"shell"},()=>args.executor.run(args.command,{
    timeoutSeconds:args.timeoutSeconds,
    effectClass:"shell",signal:args.signal,runId:args.runId,toolCallId:args.toolCallId,
  }));
  return result;
}
