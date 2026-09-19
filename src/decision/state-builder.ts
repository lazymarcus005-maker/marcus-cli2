import type { AgentHarness } from "../workflow/harness.js";
import type { ToolOutcome } from "../agent/tool-outcome.js";

function bounded(value:unknown,max=2000):string{
  const text=String(value??"");
  return text.length<=max?text:text.slice(0,max)+"…";
}

export function buildFailureTriageState(args:{
  harness:AgentHarness;
  outcome:Extract<ToolOutcome,{kind:"test"|"command"}>;
  diagnostic:string;
  changedFiles:string[];
}){
  const command=String(args.outcome.input.command??"");
  const details=args.outcome.kind==="test"?args.outcome.evidence:args.outcome.result;
  const evidenceStatus=args.outcome.kind==="test"?args.outcome.evidence.status:args.outcome.evidence?.status;
  return {
    stage:args.harness.state.stage,
    attempt:args.harness.state.noProgress,
    tool:args.outcome.toolName,
    command:bounded(command,500),
    exitCode:details.exitCode??null,
    timedOut:Boolean(details.timedOut),
    cancelled:Boolean(details.cancelled),
    evidenceStatus,
    diagnosticSummary:bounded(args.diagnostic),
    changedFiles:args.changedFiles.slice(0,50),
    sourceChangedSincePreviousFailure:false,
  };
}

export function buildProgressJudgeState(args:{
  harness:AgentHarness;
  diagnostic:string;
  changedFiles:string[];
}){
  return {
    stage:args.harness.state.stage,
    noProgressAttempts:args.harness.state.noProgress,
    sameFailureFingerprint:args.harness.state.noProgress>=2,
    diagnosticSummary:bounded(args.diagnostic),
    changedFiles:args.changedFiles.slice(0,50),
    sourceChanged:false,
  };
}

export function buildReviewRiskState(review:Record<string,unknown>){
  const changed=review.Changed as any;
  const tested=review.Tested;
  const taskEvidence=review.TaskEvidence;
  const remainingRisk=review.RemainingRisk;
  const unresolvedIssue=review.UnresolvedIssue;
  return {
    changed:{
      branch:changed?.repository?.branch,
      head:changed?.repository?.head,
      status:bounded(changed?.repository?.status,1000),
      diffPresent:Boolean(changed?.diff),
      diffChars:typeof changed?.diff==="string"?changed.diff.length:0,
      agentPaths:Array.isArray(changed?.attribution?.agentPaths)?changed.attribution.agentPaths.slice(0,50):[],
    },
    tested:Array.isArray(tested)?tested.slice(0,20).map((x:any)=>({id:x.id,status:x.status,fresh:Boolean(x.fresh),identityFresh:Boolean(x.identityFresh)})):[],
    tasks:Array.isArray(taskEvidence)?taskEvidence.slice(0,50):[],
    remainingRisk:Array.isArray(remainingRisk)?remainingRisk.slice(0,30).map((x:any)=>bounded(x,1000)):[],
    unresolvedIssue:Array.isArray(unresolvedIssue)?unresolvedIssue.slice(0,30):[],
  };
}
