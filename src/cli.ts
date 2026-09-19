import readline from "node:readline/promises";
import { stdin as input, stdout as output, stderr as errorOutput } from "node:process";
import { loadConfig } from "./config.js";
import { StateStore } from "./storage/state.js";
import { repositoryIdentity, gitState } from "./repository.js";
import { PiAgentKernel } from "./agent/kernel.js";
import { reconcileCheckpoints } from "./storage/checkpoint.js";
import { buildReview } from "./review.js";
import { reconcileExecutions } from "./storage/recovery.js";
import { readTranscriptCorrelation } from "./storage/transcript.js";
import { featureEnabled } from "./capabilities.js";
import { registerDefaultCommands } from "./cli/commands.js";
import { RuntimeLockCoordinator } from "./runtime/lock-coordinator.js";
import { SessionCoordinator } from "./runtime/session-coordinator.js";
import { CliCommandRegistry } from "./cli/registry.js";

interface ParsedArgs {
  help:boolean;
  json:boolean;
  configPath?:string;
  resumeId?:string;
  authorize?:string;
  prompt:string;
}

function parseArgs(argv:string[]):ParsedArgs{
  const rest:string[]=[];
  const parsed:ParsedArgs={help:false,json:false,prompt:""};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==="--help"||arg==="-h"){parsed.help=true;continue;}
    if(arg==="--json"){parsed.json=true;continue;}
    if(arg==="--config"){if(!argv[i+1])throw new Error("--config requires a path");parsed.configPath=argv[++i];continue;}
    if(arg==="--resume"){if(!argv[i+1])throw new Error("--resume requires a session ID");parsed.resumeId=argv[++i];continue;}
    if(arg==="--authorize"){if(!argv[i+1])throw new Error("--authorize requires edits|shell|all");parsed.authorize=argv[++i];continue;}
    rest.push(arg);
  }
  parsed.prompt=rest.join(" ").trim();
  return parsed;
}

function errorExitCode(error:unknown):number{
  const text=error instanceof Error?error.message:String(error);
  if(/authorization|require.*authorize|requires explicit user authorization|shell execution requires/i.test(text))return 2;
  if(/recovery|correlation|checkpoint.*mismatch|unknown_external_effect/i.test(text))return 4;
  if(/context|model.*limit|run limit|duration exceeded/i.test(text))return 5;
  return 1;
}

function verificationExitCode(envelope:any):number{
  const evidence=Array.isArray(envelope?.evidence)?envelope.evidence:[];
  if(!evidence.length)return 0;
  const latest=evidence[0];
  return latest?.status==="passed"&&latest?.fresh===true?0:3;
}

async function main(){
  const parsed=parseArgs(process.argv.slice(2));
  const registry=new CliCommandRegistry();
  if(parsed.help){
    // Register lightweight metadata only so --help does not create state or load configuration.
    for(const [name,usage,description] of [
      ["/help","/help","Show help"],
      ["/status","/status [--json]","Show session/model/repository status"],
      ["/model","/model [alias]","Show or switch trusted model alias"],
      ["/models","/models","List trusted model aliases"],
      ["/settings","/settings","Show resolved settings with secrets redacted"],
      ["/resume","/resume <id>","Resume a durable session"],
      ["/clear","/clear","Start a new durable session"],
      ["/compact","/compact","Run Pi manual compaction"],
      ["/context","/context [files] [--json]","Show request context"],
      ["/tasks","/tasks [--json]","Show durable tasks"],
      ["/decisions","/decisions [n]","Show Jev shadow decisions"],
      ["/metrics","/metrics [--json]","Show local runtime metrics"],
      ["/trust","/trust status|diff|refresh","Inspect or explicitly refresh trusted test baseline"],
      ["/diff","/diff","Show bounded Git status/review evidence"],
      ["/checkpoint","/checkpoint [create|list|select <id>]","Manage state checkpoints"],
      ["/authorize","/authorize edits|shell|all","Authorize effectful operations"],
      ["/review","/review [--json]","Show Changed/Tested/Risk/Unresolved review"],
      ["/exit","/exit","Exit"],
    ] as string[][]){
      registry.register({name,usage,description,execute:async()=>{}});
    }
    output.write(registry.help()+"\n");
    return;
  }

  const root=process.cwd();
  const startupStarted=performance.now();
  const {config}=await loadConfig(root,parsed.configPath);
  const store=await StateStore.open(root);
  const repoId=await repositoryIdentity(root);
  const sessions=new SessionCoordinator(root,repoId,store);
  const locks=new RuntimeLockCoordinator(root);
  let modelAlias=config.models.default;
  let kernel:PiAgentKernel|undefined;
  let kernelSessionId:string|undefined;
  let pendingTranscriptRef:string|undefined;
  let assistantBuffer="";
  let rl:readline.Interface|undefined;
  const authorized=new Set<"edits"|"shell">();

  const ensureSession=():string=>sessions.ensure();

  const disposeKernel=async()=>{
    if(kernel){await kernel.dispose();kernel=undefined;kernelSessionId=undefined;}
  };

  const ensureKernel=async()=>{
    const sessionId=ensureSession();
    if(kernel&&kernelSessionId!==sessionId)await disposeKernel();
    if(!kernel){
      const started=performance.now();
      kernel=new PiAgentKernel(root,config,sessionId,store,modelAlias,()=>locks.ensureMutationAccess());
      await kernel.create(e=>{
        if(e.text){
          assistantBuffer+=e.text;
          if(!parsed.json)output.write(e.text);
        }
      });
      kernelSessionId=sessionId;
      if(pendingTranscriptRef){await kernel.branchTranscript(pendingTranscriptRef);pendingTranscriptRef=undefined;}
      if(authorized.has("edits"))kernel.authorize("edits");
      if(authorized.has("shell"))kernel.authorize("shell");
      store.recordMetric({sessionId,name:"kernel.create_ms",value:performance.now()-started});
    }
    return kernel;
  };

  const resumeSession=async(id:string)=>{
    await disposeKernel();
    await locks.release();
    await locks.ensureMutationAccess();
    try{
      sessions.resume(id);
      const checkpointStarted=performance.now();
      const checkpointRecovery=featureEnabled(config,"checkpoint")?await reconcileCheckpoints(root,store,id):undefined;
      const findings=await reconcileExecutions(root,store,id,readTranscriptCorrelation(root,id));
      store.recordMetric({sessionId:id,name:"recovery.duration_ms",value:performance.now()-checkpointStarted});
      pendingTranscriptRef=undefined;
      authorized.clear();
      return {recovery:findings,checkpoints:checkpointRecovery};
    }finally{
      await locks.release();
    }
  };

  if(parsed.resumeId)await resumeSession(parsed.resumeId);

  if(parsed.authorize){
    if(!["edits","shell","all"].includes(parsed.authorize))throw new Error("--authorize requires edits|shell|all");
    if(parsed.authorize==="all"||parsed.authorize==="edits")authorized.add("edits");
    if(parsed.authorize==="all"||parsed.authorize==="shell")authorized.add("shell");
  }

  const statusObject=async()=>{
    const sid=sessions.sessionId;
    const tasks=sid?store.listTasks(sid):[];
    const latestEvidence=sid?store.listEvidence(sid,1)[0]:undefined;
    const manifest=kernel?.lastManifest;
    return {
      sessionId:sid??null,
      model:modelAlias,
      repository:await gitState(root),
      run:kernel?.runState?.stage??"idle",
      context:manifest?{estimatedPromptTokens:manifest.estimatedPromptTokens,contextWindow:manifest.contextWindow}:null,
      mutationLock:locks.mutationOwned,
      authorization:{edits:authorized.has("edits"),shell:authorized.has("shell")},
      tasks:{total:tasks.length,done:tasks.filter(t=>t.status==="completed"||t.status==="skipped").length,active:tasks.find(t=>t.status==="in_progress")?.id},
      evidence:latestEvidence?{id:latestEvidence.id,status:latestEvidence.status}:null,
      unknownExecutions:sid?store.unknownExecutions(sid).length:0,
      jev:{
        enabled:config.features.jev_harness&&config.internal_models.jev.enabled,
        mode:config.internal_models.jev.mode,
        model:config.internal_models.jev.model,
        metrics:sid?store.decisionMetrics(sid):{total:0,success:0,byKind:{},byStatus:{},averageLatencyMs:null},
      },
    };
  };

  const buildJsonEnvelope=async(status:"completed"|"failed"|"blocked",result:string,error?:unknown,runId?:string)=>{
    const sid=sessions.sessionId;
    let review:any=undefined;
    if(sid){
      try{review=await buildReview(root,store,sid,featureEnabled(config,"git_context"));}catch{}
    }
    return {
      sessionId:sid??null,
      runId:runId??kernel?.runId??null,
      status,
      result,
      tasks:sid?store.listTasks(sid):[],
      evidence:review?.Tested??[],
      remainingRisk:review?.RemainingRisk??[],
      error:error?(error instanceof Error?error.message:String(error)):undefined,
    };
  };

  const runPrompt=async(text:string)=>{
    assistantBuffer="";
    const k=await ensureKernel();
    if(authorized.has("edits"))k.authorize("edits");
    if(authorized.has("shell"))k.authorize("shell");
    try{
      const run=await k.prompt(text);
      await k.current.waitForIdle();
      if(!parsed.json&&!text.endsWith("\n"))output.write("\n");
      return {ok:true,result:assistantBuffer,runId:run.runId};
    }catch(error){
      if(!parsed.json)errorOutput.write("macus: "+(error instanceof Error?error.message:String(error))+"\n");
      return {ok:false,result:assistantBuffer,error,runId:undefined};
    }
  };

  const emit=(value:unknown,asJson=false)=>{
    if(asJson||parsed.json)output.write(JSON.stringify(value,null,2)+"\n");
    else output.write(String(value)+"\n");
  };

  registerDefaultCommands(registry,{
    root,repoId,config,store,sessions,locks,authorized,
    getModelAlias:()=>modelAlias,
    setModelAlias:alias=>{modelAlias=alias;},
    getKernel:()=>kernel,
    ensureKernel,disposeKernel,resumeSession,statusObject,
    getPendingTranscriptRef:()=>pendingTranscriptRef,
    setPendingTranscriptRef:ref=>{pendingTranscriptRef=ref;},
  });

  store.recordMetric({sessionId:sessions.sessionId,name:"cli.startup_ms",value:performance.now()-startupStarted});

  if(parsed.prompt){
    const result=await runPrompt(parsed.prompt);
    if(parsed.json){
      const envelope=await buildJsonEnvelope(result.ok?"completed":kernel?.runState?.stage==="blocked"?"blocked":"failed",result.result,result.error,result.runId);
      output.write(JSON.stringify(envelope,null,2)+"\n");
      process.exitCode=result.ok?verificationExitCode(envelope):errorExitCode(result.error);
      await disposeKernel();await locks.release();store.close();return;
    }
  }else if(parsed.json){
    output.write(JSON.stringify(await statusObject(),null,2)+"\n");
    await disposeKernel();await locks.release();store.close();return;
  }

  rl=readline.createInterface({input,output});
  output.write(registry.help()+"\n");
  while(true){
    let line:string;
    try{line=(await rl.question("macus> ")).trim();}
    catch(error:any){
      if(error?.code==="ERR_USE_AFTER_CLOSE"||error?.code==="ABORT_ERR")break;
      throw error;
    }
    if(!line)continue;
    if(!line.startsWith("/")){await runPrompt(line);continue;}
    const [cmd,...rawArgs]=line.split(/\s+/);
    if(cmd==="/exit")break;
    const command=registry.get(cmd);
    if(!command){errorOutput.write("macus: Unknown command: "+cmd+"\n");continue;}
    const json=rawArgs.includes("--json");
    const args=rawArgs.filter(x=>x!=="--json");
    try{
      await command.execute({
        json,args,
        print:value=>emit(value,json),
        printJson:value=>emit(value,true),
        printText:value=>emit(value),
        confirm:async(question)=>{
          const answer=(await rl!.question(question+" [y/N] ")).trim().toLowerCase();
          return answer==="y"||answer==="yes";
        },
      });
    }catch(error){
      errorOutput.write("macus: "+(error instanceof Error?error.message:String(error))+"\n");
    }
  }

  rl.close();
  await disposeKernel();
  await locks.release();
  store.close();
}

const startupJson=process.argv.includes("--json");
main().catch(error=>{
  const message=error instanceof Error?error.message:String(error);
  if(startupJson){
    output.write(JSON.stringify({sessionId:null,runId:null,status:"failed",result:"",tasks:[],evidence:[],remainingRisk:[],error:message},null,2)+"\n");
    errorOutput.write("macus: "+message+"\n");
  }else errorOutput.write("macus: "+(error instanceof Error?error.stack??error.message:String(error))+"\n");
  process.exitCode=errorExitCode(error);
});
