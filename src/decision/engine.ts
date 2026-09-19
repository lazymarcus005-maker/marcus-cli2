import { estimateTokens } from "../context/budget.js";
import { StateStore } from "../storage/state.js";
import type { MacusConfig } from "../types.js";
import { id,sha256 } from "../utils.js";
import { sanitizeDecisionState } from "./policy.js";
import { JevHttpDecisionProvider,JevTransportError } from "./providers/jev-http.js";
import type { DecisionContext,DecisionRequest,DecisionResult,JevAnswer } from "./types.js";

function confidenceSummary(answers:Record<string,JevAnswer>):Record<string,number>{
  const out:Record<string,number>={};
  for(const [key,answer] of Object.entries(answers)){
    out[key]=answer.type==="noul"?answer.noul:answer.confidence;
  }
  return out;
}

export class JevDecisionEngine {
  private readonly provider:JevHttpDecisionProvider;
  constructor(
    readonly config:MacusConfig,
    readonly store:StateStore,
    readonly sessionId:string,
    readonly getCurrentRunId:()=>string|undefined,
  ){
    this.provider=new JevHttpDecisionProvider(config.internal_models.jev);
  }

  private persist(args:{
    context:DecisionContext;request:DecisionRequest;stateDigest:string;stateTokens:number;status:string;
    latencyMs?:number;result?:any;confidence?:unknown;model?:string;provider?:string;
  }):void{
    const jev=this.config.internal_models.jev;
    this.store.recordDecisionEvent({
      id:id("decision"),sessionId:this.sessionId,runId:args.context.runId,eventId:args.context.eventId,
      kind:args.request.kind,provider:args.provider??jev.transport,model:args.model??jev.model,mode:jev.mode,
      schemaVersion:args.request.schemaVersion,stateDigest:args.stateDigest,
      requestMetadata:{
        questionTypes:Object.fromEntries(Object.entries(args.request.questions).map(([k,q])=>[k,q.type])),
        questionCount:Object.keys(args.request.questions).length,stateEstimatedTokens:args.stateTokens,
      },
      responsePayload:args.result,confidenceSummary:args.confidence,latencyMs:args.latencyMs,status:args.status,
    });
  }

  async evaluate(request:DecisionRequest,context:DecisionContext):Promise<DecisionResult|null>{
    const jev=this.config.internal_models.jev;
    if(!this.config.features.jev_harness||!jev.enabled) return null;

    const state=sanitizeDecisionState(request.state,this.config);
    const encoded=JSON.stringify(state);
    const stateTokens=estimateTokens(encoded);
    const stateDigest=sha256(encoded);
    if(stateTokens>jev.max_state_tokens){
      this.persist({context,request,stateDigest,stateTokens,status:"skipped_oversize"});
      return null;
    }

    if(context.signal?.aborted){
      this.persist({context,request,stateDigest,stateTokens,status:"cancelled"});
      return null;
    }

    const controller=new AbortController();
    let timedOut=false;
    const onAbort=()=>controller.abort();
    context.signal?.addEventListener("abort",onAbort,{once:true});
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},jev.timeout_ms);
    const started=Date.now();
    try{
      const response=await this.provider.decide(state,request.questions,controller.signal);
      const latencyMs=Date.now()-started;
      if(context.runId&&this.getCurrentRunId()!==context.runId){
        this.persist({
          context,request,stateDigest,stateTokens,status:"stale",latencyMs,
          result:{answers:response.answers,usage:response.usage,id:response.id},
          confidence:confidenceSummary(response.answers),model:response.model,provider:response.provider??jev.transport,
        });
        return null;
      }
      const result:DecisionResult={
        kind:request.kind,eventId:context.eventId,model:response.model,provider:response.provider??jev.transport,
        latencyMs,stateDigest,answers:response.answers,usage:response.usage,
      };
      this.persist({
        context,request,stateDigest,stateTokens,status:"success",latencyMs,
        result:{answers:response.answers,usage:response.usage,id:response.id},
        confidence:confidenceSummary(response.answers),model:response.model,provider:response.provider??jev.transport,
      });
      return result;
    }catch(error){
      const latencyMs=Date.now()-started;
      const category=timedOut?"timeout"
        :context.signal?.aborted?"cancelled"
        :error instanceof JevTransportError?error.category
        :"provider_error";
      const safeError=sanitizeDecisionState(error instanceof Error?error.message:String(error),this.config);
      this.persist({
        context,request,stateDigest,stateTokens,status:category,latencyMs,
        result:{error:safeError},
      });
      return null;
    }finally{
      clearTimeout(timer);
      context.signal?.removeEventListener("abort",onAbort);
    }
  }
}

export function createJevDecisionEngine(
  config:MacusConfig,store:StateStore,sessionId:string,getCurrentRunId:()=>string|undefined
):JevDecisionEngine|undefined{
  if(!config.features.jev_harness||!config.internal_models.jev.enabled) return undefined;
  return new JevDecisionEngine(config,store,sessionId,getCurrentRunId);
}
