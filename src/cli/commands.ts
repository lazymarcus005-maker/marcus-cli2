import type { MacusConfig } from "../types.js";
import type { StateStore } from "../storage/state.js";
import type { SessionCoordinator } from "../runtime/session-coordinator.js";
import type { RuntimeLockCoordinator } from "../runtime/lock-coordinator.js";
import type { PiAgentKernel } from "../agent/kernel.js";
import { ManifestStore } from "../context/manifest-store.js";
import { featureEnabled } from "../capabilities.js";
import { gitState,gitDiff } from "../repository.js";
import { buildReview } from "../review.js";
import { renderContext,renderMetrics,renderReview,renderStatus,renderTasks,renderTrustDiff,renderTrustStatus } from "./render.js";
import { ContextLedger } from "../context/ledger.js";
import { createCheckpoint,listCheckpoints,loadCheckpoint,restoreCheckpoint } from "../storage/checkpoint.js";
import { currentTranscriptRef,readTranscriptCorrelation } from "../storage/transcript.js";
import { reconcileExecutions } from "../storage/recovery.js";
import { captureTrustedCommandSnapshot,diffTrustedCommandSnapshots,trustedSnapshotDigest } from "../testing/discovery.js";
import type { CliCommandContext,CliCommandRegistry } from "./registry.js";

export interface CliCommandServices {
  root:string;
  repoId:string;
  config:MacusConfig;
  store:StateStore;
  sessions:SessionCoordinator;
  locks:RuntimeLockCoordinator;
  authorized:Set<"edits"|"shell">;
  getModelAlias():string;
  setModelAlias(alias:string):void;
  getKernel():PiAgentKernel|undefined;
  ensureKernel():Promise<PiAgentKernel>;
  disposeKernel():Promise<void>;
  resumeSession(id:string):Promise<unknown>;
  statusObject():Promise<unknown>;
  getPendingTranscriptRef():string|undefined;
  setPendingTranscriptRef(ref:string|undefined):void;
}

function add(
  registry:CliCommandRegistry,
  name:string,
  usage:string,
  description:string,
  execute:(ctx:CliCommandContext)=>Promise<void>,
):void{
  registry.register({name,usage,description,execute});
}

export function registerDefaultCommands(registry:CliCommandRegistry,s:CliCommandServices):void{
  add(registry,"/help","/help","Show help",async ctx=>ctx.printText(registry.help()));
  add(registry,"/exit","/exit","Exit",async()=>{});

  add(registry,"/authorize","/authorize edits|shell|all","Authorize effectful operations",async ctx=>{
    const scope=ctx.args[0];
    if(!["edits","shell","all"].includes(scope))throw new Error("Usage: /authorize edits|shell|all");
    if(scope==="all"||scope==="edits")s.authorized.add("edits");
    if(scope==="all"||scope==="shell")s.authorized.add("shell");
    s.getKernel()?.authorize(scope as "edits"|"shell"|"all");
    ctx.printText(scope==="shell"||scope==="all"
      ?"Authorized. Repository shell scripts are not OS-sandboxed."
      :"Authorized workspace edits for this session.");
  });

  add(registry,"/status","/status [--json]","Show session/model/repository status",async ctx=>{
    const value=await s.statusObject();
    if(ctx.json)ctx.printJson(value);else ctx.printText(renderStatus(value));
  });

  add(registry,"/model","/model [alias]","Show or switch trusted model alias",async ctx=>{
    const next=ctx.args[0];
    if(!next){ctx.printText(s.getModelAlias());return;}
    if(!(next in s.config.models.aliases))throw new Error("Unknown trusted model alias "+next);
    if(s.getKernel())await s.getKernel()!.switchModel(next);
    s.setModelAlias(next);ctx.printText("Model: "+next);
  });

  add(registry,"/models","/models","List trusted model aliases",async ctx=>{
    ctx.printText(Object.keys(s.config.models.aliases).join("\n")||"(none configured)");
  });

  add(registry,"/settings","/settings","Show resolved settings with secrets redacted",async ctx=>{
    const { redactConfig }=await import("../config.js");
    ctx.printJson(redactConfig(s.config));
  });

  add(registry,"/context","/context [files] [--json]","Show request context",async ctx=>{
    const sid=s.sessions.sessionId;
    if(!sid)throw new Error("No active session. Send a prompt, use /clear, or /resume <sessionId>.");
    const manifest=await new ManifestStore(s.root,sid).load();
    if(ctx.args[0]==="files"){ctx.printJson({included:manifest?.includedFragments??[],omitted:manifest?.omissions??[]});return;}
    if(ctx.json)ctx.printJson(manifest);else ctx.printText(renderContext(manifest));
  });

  add(registry,"/tasks","/tasks [--json]","Show durable tasks",async ctx=>{
    if(!featureEnabled(s.config,"task_engine"))throw new Error("task_engine unavailable: feature disabled");
    const sid=s.sessions.sessionId;
    if(!sid)throw new Error("No active session. Send a prompt, use /clear, or /resume <sessionId>.");
    const tasks=s.store.listTasks(sid);
    if(ctx.json)ctx.printJson(tasks);else ctx.printText(renderTasks(tasks));
  });

  add(registry,"/decisions","/decisions [n]","Show Jev shadow decisions",async ctx=>{
    const sid=s.sessions.sessionId;
    if(!sid)throw new Error("No active session. Send a prompt, use /clear, or /resume <sessionId>.");
    const limit=Math.min(Math.max(1,Number(ctx.args[0]??20)||20),100);
    ctx.printJson({
      enabled:s.config.features.jev_harness&&s.config.internal_models.jev.enabled,
      metrics:s.store.decisionMetrics(sid),
      events:s.store.listDecisionEvents(sid,limit),
    });
  });

  add(registry,"/metrics","/metrics [--json]","Show local runtime metrics",async ctx=>{
    const metrics=s.store.metricSummary(s.sessions.sessionId);
    if(ctx.json)ctx.printJson(metrics);else ctx.printText(renderMetrics(metrics));
  });

  add(registry,"/diff","/diff","Show bounded Git status/review evidence",async ctx=>{
    if(!featureEnabled(s.config,"git_context"))throw new Error("git_context unavailable: feature disabled");
    const state=await gitState(s.root);
    ctx.printJson({state,diff:state.isGit?await gitDiff(s.root):null});
  });

  add(registry,"/review","/review [--json]","Show Changed/Tested/Risk/Unresolved review",async ctx=>{
    const sid=s.sessions.sessionId;
    if(!sid)throw new Error("No active session. Send a prompt, use /clear, or /resume <sessionId>.");
    const review=await buildReview(s.root,s.store,sid,featureEnabled(s.config,"git_context"));
    if(ctx.json)ctx.printJson(review);else ctx.printText(renderReview(review));
  });

  add(registry,"/compact","/compact","Run Pi manual compaction",async ctx=>{
    const kernel=await s.ensureKernel();
    await kernel.compact("Preserve user goal, constraints, current task, unresolved failures, pending work and unknown executions.");
    ctx.printText("Compaction completed.");
  });

  add(registry,"/checkpoint","/checkpoint [create|list|select <id>]","Manage state checkpoints",async ctx=>{
    if(!s.config.features.checkpoint)throw new Error("checkpoint unavailable: feature disabled");
    const sid=s.sessions.sessionId;
    if(!sid)throw new Error("No active session. Send a prompt, use /clear, or /resume <sessionId>.");
    const action=ctx.args[0]??"create";
    if(action==="list"){ctx.printJson(listCheckpoints(s.store,sid));return;}

    if(action==="select"){
      const checkpointId=ctx.args[1];
      if(!checkpointId)throw new Error("Usage: /checkpoint select <id>");
      await s.disposeKernel();await s.locks.release();await s.locks.ensureMutationAccess();
      try{
        const cp=await loadCheckpoint(s.store,checkpointId);
        const currentTranscript=readTranscriptCorrelation(s.root,sid);
        if(!cp.transcriptRef&&currentTranscript.entryIds.size)throw new Error("Checkpoint lacks transcriptRef and cannot be selected safely for a non-empty Pi transcript");
        const transcript=readTranscriptCorrelation(s.root,sid,cp.transcriptRef);
        const started=performance.now();
        const restored=await restoreCheckpoint({root:s.root,store:s.store,sessionId:sid,repoIdentity:s.repoId,checkpointId});
        const recovery=await reconcileExecutions(s.root,s.store,sid,transcript);
        s.store.recordMetric({sessionId:sid,name:"checkpoint.restore_ms",value:performance.now()-started});
        s.setPendingTranscriptRef(cp.transcriptRef);s.authorized.clear();
        ctx.printJson({restored,recovery,sourceRollback:false});
      }finally{await s.locks.release();}
      return;
    }

    if(action!=="create")throw new Error("Usage: /checkpoint [create|list|select <id>]");
    const started=performance.now();
    const ledger=featureEnabled(s.config,"context_ledger")?new ContextLedger(s.store,sid).latest():undefined;
    const revision=ledger?.revision??0;
    const evidence=s.store.listEvidence(sid,20).map(row=>({id:row.id,status:row.status,snapshotDigest:row.snapshotDigest,payload:row.payload}));
    const transcriptRef=s.getKernel()?.transcriptRef??s.getPendingTranscriptRef()??currentTranscriptRef(s.root,sid);
    const cp=await createCheckpoint(s.root,s.store,{
      schemaVersion:1,sessionId:sid,repoIdentity:s.repoId,root:s.root,transcriptRef,stateRevision:revision,
      goal:ledger?.state.goal,tasks:s.store.listTasks(sid),decisions:ledger?.state.decisions??[],
      changedFiles:ledger?.state.workingFiles??[],evidence,nextAction:ledger?.state.nextAction,
      unknownExecutions:s.store.unknownExecutions(sid)
    });
    s.store.recordMetric({sessionId:sid,name:"checkpoint.create_ms",value:performance.now()-started});
    ctx.printText(cp);
  });

  add(registry,"/clear","/clear","Start a new durable session",async ctx=>{
    await s.disposeKernel();await s.locks.release();
    const sid=s.sessions.createNew();s.setPendingTranscriptRef(undefined);s.authorized.clear();
    ctx.printText("New session: "+sid);
  });

  add(registry,"/resume","/resume <id>","Resume a durable session",async ctx=>{
    const id=ctx.args[0];if(!id)throw new Error("Usage: /resume <sessionId>");
    const result=await s.resumeSession(id);ctx.printJson({sessionId:id,...(result as any)});
  });

  add(registry,"/trust","/trust status|diff|refresh","Inspect or explicitly refresh trusted test baseline",async ctx=>{
    const sid=s.sessions.sessionId;
    if(!sid)throw new Error("No active session. Send a prompt, use /clear, or /resume <sessionId>.");
    const action=ctx.args[0]??"status";
    const baseline=s.store.trustedCommandSnapshot(sid);
    const current=captureTrustedCommandSnapshot(s.root);
    const diff=diffTrustedCommandSnapshots(baseline,current);
    const status={
      baselineDigest:trustedSnapshotDigest(baseline),currentDigest:trustedSnapshotDigest(current),
      changed:diff.changedSources.length>0||diff.addedCommands.length>0||diff.removedCommands.length>0,
      ...diff,commands:Object.keys(baseline?.commands??{}).sort(),
    };
    if(action==="status"){if(ctx.json)ctx.printJson(status);else ctx.printText(renderTrustStatus(status));return;}
    if(action==="diff"){if(ctx.json)ctx.printJson(diff);else ctx.printText(renderTrustDiff(diff));return;}
    if(action!=="refresh")throw new Error("Usage: /trust status|diff|refresh");
    if(ctx.json)throw new Error("/trust refresh requires an explicit interactive user confirmation");
    if(!(await ctx.confirm("Refresh trusted command baseline for this session?"))){ctx.printText("Trust refresh cancelled.");return;}
    const next=s.store.refreshTrustedCommandSnapshot(sid,s.root);
    const result={refreshed:true,digest:trustedSnapshotDigest(next),commands:Object.keys(next.commands).sort()};
    if(ctx.json)ctx.printJson(result);else ctx.printText(`Trust baseline refreshed. ${result.commands.length} trusted commands.`);
  });
}
