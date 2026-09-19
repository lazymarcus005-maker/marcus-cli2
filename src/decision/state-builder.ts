import type { AgentHarness } from "../workflow/harness.js";

function bounded(value:unknown,max=2000):string{
  const text=String(value??"");
  return text.length<=max?text:text.slice(0,max)+"…";
}

export function buildFailureTriageState(args:{
  harness:AgentHarness;
  toolName:string;
  input:any;
  details:any;
  diagnostic:string;
  changedFiles:string[];
}){
  return {
    stage:args.harness.state.stage,
    attempt:args.harness.state.noProgress,
    tool:args.toolName,
    command:args.toolName==="run_command"||args.toolName==="run_test"?bounded(args.input?.command,500):undefined,
    exitCode:args.details?.exitCode??null,
    timedOut:Boolean(args.details?.timedOut),
    cancelled:Boolean(args.details?.cancelled),
    evidenceStatus:args.toolName==="run_test"?args.details?.status:undefined,
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

export function buildReviewRiskState(review:any){
  return {
    changed:{
      branch:review?.Changed?.repository?.branch,
      head:review?.Changed?.repository?.head,
      status:bounded(review?.Changed?.repository?.status,1000),
      diffPresent:Boolean(review?.Changed?.diff),
      diffChars:typeof review?.Changed?.diff==="string"?review.Changed.diff.length:0,
      agentPaths:Array.isArray(review?.Changed?.attribution?.agentPaths)?review.Changed.attribution.agentPaths.slice(0,50):[],
    },
    tested:Array.isArray(review?.Tested)?review.Tested.slice(0,20).map((x:any)=>({id:x.id,status:x.status,fresh:Boolean(x.fresh),identityFresh:Boolean(x.identityFresh)})):[],
    tasks:Array.isArray(review?.TaskEvidence)?review.TaskEvidence.slice(0,50):[],
    remainingRisk:Array.isArray(review?.RemainingRisk)?review.RemainingRisk.slice(0,30).map((x:any)=>bounded(x,1000)):[],
    unresolvedIssue:Array.isArray(review?.UnresolvedIssue)?review.UnresolvedIssue.slice(0,30):[],
  };
}
