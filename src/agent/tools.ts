import path from "node:path";
import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { MacusConfig } from "../types.js";
import { PolicyExecutor } from "../policy.js";
import { searchCode } from "../retrieval/search.js";
import { readRange } from "../retrieval/symbols.js";
import { SymbolIndex } from "../retrieval/index.js";
import { TaskEngine } from "../workflow/tasks.js";
import { GraphStore, buildLightweightEdges } from "../graph/graph.js";
import { gitState, gitDiff, gitLog, gitShow, gitBlame } from "../repository.js";
import { featureEnabled, featureUnavailable } from "../capabilities.js";
import { runTest } from "../testing/evidence.js";
import { buildReview } from "../review.js";
import type { AgentHarness } from "../workflow/harness.js";
import { PathPolicy } from "../path-policy.js";
import { ContextLedger } from "../context/ledger.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], details: value };
}

export function createMacusTools(args:{
  root:string;
  config:MacusConfig;
  executor:PolicyExecutor;
  tasks:TaskEngine;
  graph?:GraphStore;
  getHarness?:()=>AgentHarness|undefined;
  getRunId?:()=>string|undefined;
}): ToolDefinition[] {
  const {root,config,executor,tasks,graph,getHarness,getRunId}=args;
  const tools:ToolDefinition[]=[];

  tools.push(
    defineTool({
      name:"search_code", label:"Search Code", description:"Bounded repository search with secret/internal path policy.",
      parameters:Type.Object({query:Type.String(),path:Type.Optional(Type.String()),maxResults:Type.Optional(Type.Number({minimum:1})),literal:Type.Optional(Type.Boolean()),caseSensitive:Type.Optional(Type.Boolean()),cursor:Type.Optional(Type.String())}),
      async execute(_id,p,signal){
        getHarness?.()?.advance("discover");
        const started=performance.now();
        try{return textResult(await searchCode(root,config,{...p,signal}));}
        finally{executor.store.recordMetric({sessionId:executor.sessionId,runId:getRunId?.(),name:"search.latency_ms",value:performance.now()-started});}
      }
    }),
    defineTool({
      name:"read_range", label:"Read Range", description:"Read a fresh, bounded line range with source hash.",
      parameters:Type.Object({path:Type.String(),startLine:Type.Number({minimum:1}),endLine:Type.Number({minimum:1}),expectedHash:Type.Optional(Type.String())}),
      async execute(_id,p){
        getHarness?.()?.advance("discover");
        return textResult(await readRange(root,p.path,p.startLine,p.endLine,p.expectedHash));
      }
    }),
    defineTool({
      name:"search_symbol", label:"Search Symbol", description:"Refresh one supported file and return disambiguated structural symbols.",
      parameters:Type.Object({path:Type.String(),query:Type.Optional(Type.String())}),
      async execute(_id,p){
        getHarness?.()?.advance("discover");
        const idx=await SymbolIndex.open(root,config);
        try{
          let refreshed;
          try {
            refreshed=await idx.refresh(p.path);
          } catch (error: any) {
            if (error?.code === "ENOENT") {
              const rel=path.relative(root,new PathPolicy(root).lexical(p.path));
              idx.removeMissing(rel);
              if(featureEnabled(config,"code_graph")&&graph){
                graph.invalidateFile(rel);
                graph.pruneDangling(idx.allSymbols().map(x=>x.id));
              }
              throw new Error("Source file missing: "+rel);
            }
            throw error;
          }
          const pathPolicy=new PathPolicy(root);
          const [resolved,rootResolved]=await Promise.all([pathPolicy.resolveReadable(p.path),pathPolicy.resolveReadable(".")]);
          const canonicalPath=path.relative(rootResolved.absolute,resolved.absolute);
          const fileSymbols=idx.search("",100000,canonicalPath);
          if(featureEnabled(config,"code_graph")&&graph){
            const all=idx.allSymbols();
            const edges=await buildLightweightEdges(root,canonicalPath,refreshed.sourceHash,fileSymbols,all,1);
            graph.replaceEdgesForFile(canonicalPath,edges);
            graph.pruneDangling(all.map(x=>x.id));
          }
          return textResult({path:canonicalPath,sourceHash:refreshed.sourceHash,symbols:p.query?idx.search(p.query,100,canonicalPath):fileSymbols.slice(0,100),coverage:"syntax-only"});
        } finally{idx.close();}
      }
    }),
    defineTool({
      name:"repo_map", label:"Repository Map", description:"Bounded structural repository map.",
      parameters:Type.Object({}),
      async execute(){
        if(!featureEnabled(config,"repo_map")) return textResult(featureUnavailable("repo_map"));
        const started=performance.now();
        const idx=await SymbolIndex.open(root,config);
        try{
          const discovered=await idx.discover(2000);
          const removed=discovered.truncated?[]:idx.reconcileDiscovered(discovered.files);
          if(featureEnabled(config,"code_graph")&&graph) for(const file of removed) graph.invalidateFile(file);
          for(const file of discovered.files) await idx.refresh(file);
          if(featureEnabled(config,"code_graph")&&graph) graph.pruneDangling(idx.allSymbols().map(x=>x.id));
          const snapshot=idx.repoMapSnapshot(config.context.budget.repo_map_tokens);
          return textResult({map:snapshot.map,sources:snapshot.sources,estimatedTokenMethod:"conservative-byte-estimate",removedStaleFiles:removed,discoveryTruncated:discovered.truncated,indexedFiles:discovered.files.length});
        } finally{
          idx.close();
          executor.store.recordMetric({sessionId:executor.sessionId,runId:getRunId?.(),name:"repo_map.latency_ms",value:performance.now()-started});
        }
      }
    }),
    defineTool({
      name:"write_file", label:"Write File", description:"Atomic workspace write guarded by expected source hash.",
      parameters:Type.Object({path:Type.String(),content:Type.String(),expectedHash:Type.Union([Type.String(),Type.Null()])}),
      executionMode:"sequential",
      async execute(_id,p){
        const result=await executor.safeWrite(p.path,p.content,p.expectedHash,{runId:getRunId?.(),toolCallId:_id});
        getHarness?.()?.advance("implement");
        return textResult({path:p.path,...result});
      }
    }),
    defineTool({
      name:"run_command", label:"Run Command", description:"Run a bounded authorized workspace command.",
      parameters:Type.Object({command:Type.String(),timeoutSeconds:Type.Optional(Type.Number({minimum:1}))}),
      executionMode:"sequential",
      async execute(_id,p,signal){return textResult(await executor.run(p.command,{timeoutSeconds:p.timeoutSeconds,signal,effectClass:"shell",runId:getRunId?.(),toolCallId:_id}));}
    }),
    defineTool({
      name:"run_test", label:"Run Test", description:"Run a bounded test/build command and persist structured evidence for the current source snapshot.",
      parameters:Type.Object({
        command:Type.String(),
        reportPath:Type.Optional(Type.String()),
        reportFormat:Type.Optional(Type.Union([Type.Literal("junit"),Type.Literal("trx")]))
      }),
      executionMode:"sequential",
      async execute(_id,p,signal){
        const harness=getHarness?.();
        harness?.advance("test");
        const evidence=await runTest({root,sessionId:executor.sessionId,runId:getRunId?.(),toolCallId:_id,command:p.command,executor,store:executor.store,reportPath:p.reportPath,reportFormat:p.reportFormat,signal});
        tasks.attachEvidence(evidence.id);
        if(evidence.status==="passed") harness?.advance("review");
        else {
          harness?.onFailure(`${evidence.status}:${evidence.command}`,evidence.snapshotDigest,false);
          if(harness?.state.stage!=="blocked") harness?.advance("fix");
        }
        return textResult(evidence);
      }
    }),
    defineTool({
      name:"read_log", label:"Read Log", description:"Read a bounded redacted execution log by opaque reference.",
      parameters:Type.Object({logRef:Type.String(),start:Type.Optional(Type.Number({minimum:0})),maxBytes:Type.Optional(Type.Number({minimum:1,maximum:65536}))}),
      async execute(_id,p){return textResult(await executor.readLog(p.logRef,p.start??0,p.maxBytes??65536));}
    }),
    defineTool({
      name:"review", label:"Review", description:"Inspect current diff, durable tasks and fresh test evidence before completion.",
      parameters:Type.Object({}),
      async execute(){
        getHarness?.()?.advance("review");
        return textResult(await buildReview(root,executor.store,executor.sessionId,featureEnabled(config,"git_context")));
      }
    })
  );

  if(featureEnabled(config,"git_context")){
    tools.push(
      defineTool({name:"git_state",label:"Git State",description:"Bounded repository branch/status identity context.",parameters:Type.Object({}),async execute(){return textResult(await gitState(root));}}),
      defineTool({name:"git_diff",label:"Git Diff",description:"Bounded current Git diff.",parameters:Type.Object({path:Type.Optional(Type.String())}),async execute(_id,p){return textResult(await gitDiff(root,p.path?[p.path]:[]));}}),
      defineTool({name:"git_log",label:"Git Log",description:"Bounded recent Git history.",parameters:Type.Object({max:Type.Optional(Type.Number({minimum:1,maximum:100}))}),async execute(_id,p){return textResult(await gitLog(root,p.max??20));}}),
      defineTool({name:"git_show",label:"Git Show",description:"Bounded Git commit/ref summary.",parameters:Type.Object({ref:Type.String()}),async execute(_id,p){return textResult(await gitShow(root,p.ref));}}),
      defineTool({name:"git_blame",label:"Git Blame",description:"Bounded Git blame for an authorized repository path.",parameters:Type.Object({path:Type.String(),startLine:Type.Optional(Type.Number({minimum:1})),endLine:Type.Optional(Type.Number({minimum:1}))}),async execute(_id,p){return textResult(await gitBlame(root,p.path,p.startLine,p.endLine));}})
    );
  }

  if(featureEnabled(config,"context_ledger")){
    tools.push(
      defineTool({
        name:"decision_record",label:"Record Decision",description:"Persist a durable implementation decision with provenance for resume/compaction.",
        parameters:Type.Object({text:Type.String({maxLength:2000}),provenance:Type.Optional(Type.String({maxLength:500}))}),executionMode:"sequential",
        async execute(_id,p){
          const ledger=new ContextLedger(executor.store,executor.sessionId);
          const latest=ledger.latest();
          const revision=ledger.append({
            goal:latest?.state.goal,
            decisions:[...(latest?.state.decisions??[]),{text:p.text,provenance:p.provenance??(`pi-tool:${_id}`)}],
            workingFiles:latest?.state.workingFiles??[],blockers:latest?.state.blockers??[],nextAction:latest?.state.nextAction
          });
          return textResult({revision,decision:{text:p.text,provenance:p.provenance??(`pi-tool:${_id}`)}});
        }
      })
    );
  }

  if(featureEnabled(config,"task_engine")){
    tools.push(
      defineTool({name:"tasks",label:"Tasks",description:"List durable session tasks.",parameters:Type.Object({}),async execute(){return textResult(tasks.list());}}),
      defineTool({name:"task_create",label:"Create Task",description:"Create a durable task.",parameters:Type.Object({id:Type.String(),title:Type.String()}),executionMode:"sequential",async execute(_id,p){getHarness?.()?.advance("plan");return textResult(tasks.create(p.id,p.title));}}),
      defineTool({name:"task_transition",label:"Transition Task",description:"Move a durable task through valid workflow states.",parameters:Type.Object({id:Type.String(),status:Type.Union([Type.Literal("pending"),Type.Literal("in_progress"),Type.Literal("completed"),Type.Literal("blocked"),Type.Literal("skipped")])}),executionMode:"sequential",async execute(_id,p){return textResult(tasks.transition(p.id,p.status));}})
    );
  }

  tools.push(
    defineTool({name:"find_references",label:"Find References",description:"Optional relationship references with explicit resolution and partial coverage.",parameters:Type.Object({symbolId:Type.String()}),async execute(_id,p){if(!featureEnabled(config,"code_graph")||!graph)return textResult(featureUnavailable("code_graph"));return textResult({references:graph.references(p.symbolId),coverage:"partial"});}}),
    defineTool({name:"find_dependencies",label:"Find Dependencies",description:"Optional outgoing relationship evidence.",parameters:Type.Object({symbolId:Type.String()}),async execute(_id,p){if(!featureEnabled(config,"code_graph")||!graph)return textResult(featureUnavailable("code_graph"));return textResult({dependencies:graph.dependencies(p.symbolId),coverage:"partial"});}}),
    defineTool({name:"find_dependents",label:"Find Dependents",description:"Optional incoming relationship evidence.",parameters:Type.Object({symbolId:Type.String()}),async execute(_id,p){if(!featureEnabled(config,"code_graph")||!graph)return textResult(featureUnavailable("code_graph"));return textResult({dependents:graph.dependents(p.symbolId),coverage:"partial"});}}),
    defineTool({name:"impact",label:"Impact",description:"Optional relationship evidence for test prioritization only.",parameters:Type.Object({symbolId:Type.String()}),async execute(_id,p){if(!featureEnabled(config,"code_graph")||!graph)return textResult(featureUnavailable("code_graph"));return textResult(graph.impact(p.symbolId));}})
  );

  return tools;
}
