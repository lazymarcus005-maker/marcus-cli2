import path from "node:path";
import os from "node:os";
import {
  createAgentSession, DefaultResourceLoader, SettingsManager, SessionManager,
  type InlineExtension, type AgentSession
} from "@earendil-works/pi-coding-agent";
import type { MacusConfig, RequestManifest } from "../types.js";
import { ManifestStore } from "../context/manifest-store.js";
import { resolveInstructions, renderInstructions } from "../instructions.js";
import { StateStore } from "../storage/state.js";
import { PolicyExecutor } from "../policy.js";
import { TaskEngine } from "../workflow/tasks.js";
import { GraphStore } from "../graph/graph.js";
import { createMacusTools } from "./tools.js";
import { createJevDecisionEngine } from "../decision/engine.js";
import { HarnessDecisionCoordinator } from "../decision/coordinator.js";
import type { DecisionKind } from "../decision/types.js";
import { WorkingSet } from "../context/working-set.js";
import { fileHash } from "../utils.js";
import { ContextLedger } from "../context/ledger.js";
import { DurableContinuity } from "../runtime/durable-continuity.js";
import { repositoryIdentity } from "../repository.js";
import { PathPolicy } from "../path-policy.js";
import { ContextCoordinator } from "../context/coordinator.js";
import { ToolResultCoordinator } from "./tool-result-coordinator.js";
import { RunController, type RunStatus } from "../runtime/run-controller.js";
import { ProviderRuntime } from "./provider-runtime.js";

export interface KernelEvents { type:string; text?:string; raw?:unknown; }

export class PiAgentKernel {
  private session?:AgentSession;
  private unsubscribe?:()=>void;
  private manifests:RequestManifest[]=[];
  private graph?:GraphStore;
  private executor?:PolicyExecutor;
  private latestSourceHashes=new Map<string,string>();
  private providerRuntime?:ProviderRuntime;
  private activeModelAlias:string;
  private activeProfileName="";
  private workingSet=new WorkingSet();
  private readonly decisionCoordinator:HarnessDecisionCoordinator;
  private readonly runController:RunController;
  private readonly contextCoordinator:ContextCoordinator;
  private readonly toolResultCoordinator:ToolResultCoordinator;
  private providerRequestStartedAt:number|undefined;
  private currentGoal?:string;

  constructor(
    readonly root:string, readonly config:MacusConfig, readonly sessionId:string,
    readonly store:StateStore, readonly modelAlias:string,
    readonly ensureMutationAccess?:()=>Promise<void>
  ){
    this.activeModelAlias=modelAlias;
    this.runController=new RunController(config,store,sessionId);
    const engine=createJevDecisionEngine(config,store,sessionId,()=>this.runController.runId);
    this.decisionCoordinator=new HarnessDecisionCoordinator(engine,(kind:DecisionKind)=>config.internal_models.jev.decisions[kind]===true);
    this.contextCoordinator=new ContextCoordinator(root,config,this.workingSet,this.latestSourceHashes,store,sessionId,manifest=>this.manifests.push(manifest),()=>this.runController.harness);
    this.toolResultCoordinator=new ToolResultCoordinator(this.decisionCoordinator,this.workingSet,()=>this.runController.runId,()=>this.runController.abortController?.signal);
  }

  get lastManifest(){ return this.manifests.at(-1); }
  get runState(){ return this.runController.harness?.state; }
  get runId(){ return this.runController.runId; }
  get transcriptRef(){ return this.session?.sessionManager.getLeafId()??undefined; }
  async branchTranscript(ref:string):Promise<void>{
    const session=this.current;
    if(!session.sessionManager.getEntry(ref)) throw new Error(`Unknown transcript entry ${ref}`);
    const result=await session.navigateTree(ref,{summarize:false});
    if(result.cancelled||result.aborted) throw new Error(`Unable to navigate Pi transcript to ${ref}`);
  }


  private persistLedger(nextAction?:string):number{
    if(!this.config.features.context_ledger) return 0;
    const ledger=new ContextLedger(this.store,this.sessionId);
    const latest=ledger.latest();
    const blockers=this.runController.harness?.state.stage==="blocked"?["run_limit_or_no_progress"]:[];
    return ledger.append({
      goal:this.currentGoal??latest?.state.goal,
      decisions:latest?.state.decisions??[],
      workingFiles:this.workingSet.list().filter(x=>x.status!=="STALE").map(x=>({path:x.path,hash:x.sourceHash})),
      blockers,
      nextAction
    });
  }

  private async hydrateLedger():Promise<void>{
    if(!this.config.features.context_ledger) return;
    const latest=new ContextLedger(this.store,this.sessionId).latest();
    if(!latest) return;
    this.currentGoal=latest.state.goal;
    const policy=new PathPolicy(this.root);
    const now=Date.now();
    for(const saved of latest.state.workingFiles.slice(0,200)){
      try{
        const resolved=await policy.resolveReadable(saved.path);
        const current=await fileHash(resolved.absolute);
        if(!current) continue;
        const fresh=current===saved.hash;
        if(fresh) this.latestSourceHashes.set(resolved.relative,current);
        this.workingSet.upsert({
          path:resolved.relative,sourceHash:current,symbols:[],lastAccess:now,reason:"resume-ledger",
          status:fresh?"RELATED":"STALE",tier:fresh?"WARM":"COLD"
        });
      }catch{
        // Missing, denied, or escaping paths from durable state are never trusted on resume.
      }
    }
  }

  private async checkpointBeforeCompaction(event:any):Promise<void>{
    this.persistLedger("continue after compaction");
    if(!this.config.features.checkpoint) return;
    const continuity=new DurableContinuity(
      this.root,await repositoryIdentity(this.root),
      this.store,this.sessionId,this.config.features.context_ledger,
    );
    await continuity.createCheckpoint({
      transcriptRef:event?.branchEntries?.at?.(-1)?.id,
      nextAction:"continue after compaction",
      changedFiles:this.workingSet.list().filter(x=>x.status!=="STALE").map(x=>({path:x.path,hash:x.sourceHash})),
    });
  }

  private contextExtension(manifestStore:ManifestStore,instructionHashes:string[]):InlineExtension {
    return {
      name:"macus-context-runtime",hidden:true,
      factory:(pi)=>{
        pi.on("tool_result",async(event:any)=>{
          await this.contextCoordinator.observeToolResult(event);
          this.toolResultCoordinator.observe(event,this.runController.harness);
        });
        pi.on("context",async(event:any)=>({messages:await this.contextCoordinator.transform(event.messages)}));
        pi.on("before_provider_request",async(event:any,ctx:any)=>{
          this.providerRequestStartedAt=performance.now();
          try{
            return await this.contextCoordinator.beforeProviderRequest({
              payload:event.payload,ctx,harness:this.runController.harness,activeProfileName:this.activeProfileName,
              activeModelAlias:this.activeModelAlias,instructionHashes,manifestStore
            });
          }catch(error){
            this.runController.blockedReason=error instanceof Error?error.message:String(error);
            return event.payload;
          }
        });
        pi.on("session_before_compact",async(event:any)=>{
          try{await this.checkpointBeforeCompaction(event);return;}
          catch(error){
            this.runController.blockedReason="Compaction checkpoint failed: "+(error instanceof Error?error.message:String(error));
            return {cancel:true};
          }
        });
        pi.on("tool_call",(event:any)=>{
          if(["bash","write","edit"].includes(event.toolName))return {block:true,terminate:true,reason:"Built-in "+event.toolName+" is disabled; use Macus policy tools"};
        });
      }
    };
  }

  async create(onEvent?:(event:KernelEvents)=>void):Promise<AgentSession>{
    const providerRuntime=await ProviderRuntime.create(this.config);
    const selected=providerRuntime.resolve(this.activeModelAlias);
    this.providerRuntime=providerRuntime;
    this.activeProfileName=selected.profileName;
    await this.hydrateLedger();
    const instructions=await resolveInstructions(this.root,this.root);
    const agentDir=path.join(os.homedir(),".macus","pi");
    const settings=SettingsManager.create(this.root,agentDir);
    const manifestStore=new ManifestStore(this.root,this.sessionId);
    const loader=new DefaultResourceLoader({
      cwd:this.root,agentDir,settingsManager:settings,noContextFiles:true,
      appendSystemPrompt:[renderInstructions(instructions)],
      extensionFactories:[this.contextExtension(manifestStore,instructions.map(x=>x.hash))]
    });
    await loader.reload();
    if(this.config.features.code_graph) this.graph=await GraphStore.open(this.root);

    const executor=new PolicyExecutor(this.root,this.sessionId,this.store,this.config,this.ensureMutationAccess);
    this.executor=executor;
    const tasks=new TaskEngine(this.store,this.sessionId);
    const customTools=createMacusTools({
      root:this.root,config:this.config,executor,tasks,graph:this.graph,getRunId:()=>this.runController.runId
    });

    const sessionDir=path.join(this.root,".macus","sessions",this.sessionId);
    const sessionManager=SessionManager.continueRecent(this.root,sessionDir);
    const {session}=await createAgentSession({
      cwd:this.root,agentDir,modelRuntime:providerRuntime.runtime,model:selected.model,resourceLoader:loader,settingsManager:settings,sessionManager,
      noTools:"builtin",customTools,tools:customTools.map(t=>t.name)
    });
    session.setAutoCompactionEnabled(this.config.features.auto_compaction);
    this.unsubscribe=session.subscribe((e:any)=>{
      if(e.type==="message_update"){
        const delta=e.assistantMessageEvent?.delta;
        if(typeof delta==="string"&&delta.length&&this.providerRequestStartedAt!==undefined){
          this.store.recordMetric({sessionId:this.sessionId,runId:this.runController.runId,name:"provider.ttft_ms",value:performance.now()-this.providerRequestStartedAt});
          this.providerRequestStartedAt=undefined;
        }
        onEvent?.({type:e.type,text:typeof delta==="string"?delta:undefined,raw:e});
      }else onEvent?.({type:e.type,raw:e});
    });
    this.session=session;
    return session;
  }

  async switchModel(alias:string){
    if(!this.providerRuntime) throw new Error("Kernel not created");
    const selected=this.providerRuntime.resolve(alias);
    await this.current.setModel(selected.model);
    this.activeModelAlias=selected.alias;
    this.activeProfileName=selected.profileName;
  }

  authorize(scope:"edits"|"shell"|"all"){
    if(!this.executor) throw new Error("Kernel not created");
    this.executor.authorize(scope);
  }

  get current():AgentSession {
    if(!this.session) throw new Error("Kernel not created");
    return this.session;
  }

  async prompt(text:string){
    if(this.runController.runId)throw new Error("A Macus run is already active");
    this.currentGoal=text;
    const {runId}=this.runController.begin(this.current);
    let status:RunStatus="failed";
    let failure:unknown;
    try{
      await this.current.prompt(text);
      this.runController.assertComplete();
      status="completed";
    }catch(error){
      const classified=this.runController.classifyFailure(error);
      failure=classified.failure;
      status=classified.status;
    }
    try{
      this.persistLedger(status==="completed"?"await user input":status==="blocked"?"inspect blocker":"inspect failure");
    }catch(error){
      if(!failure)failure=error;
      if(status==="completed")status="failed";
    }
    try{
      this.runController.finish(status);
    }catch(error){
      if(!failure)failure=error;
    }
    if(failure)throw failure;
    return {runId,status};
  }

  async steer(text:string){ await this.current.steer(text); }
  async followUp(text:string){ await this.current.followUp(text); }

  async abort(){ await this.runController.abort(this.current); }

  async compact(instructions?:string){
    this.runController.blockedReason=undefined;
    try{
      const result=await this.current.compact(instructions);
      if(this.runController.blockedReason)throw new Error(this.runController.blockedReason);
      return result;
    }catch(error){
      if(this.runController.blockedReason)throw new Error(this.runController.blockedReason);
      throw error;
    }
  }
  async dispose(){
    this.runController.dispose();
    await this.decisionCoordinator.flush();
    this.unsubscribe?.();
    this.session?.dispose();
    this.graph?.close();
  }
}
