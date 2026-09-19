import path from "node:path";
import { StateStore } from "./state.js";
import { fileHash } from "../utils.js";
import type { TranscriptCorrelation } from "./transcript.js";

export interface RecoveryFinding {
  executionId:string;
  runId?:string;
  toolCallId?:string;
  status:
    |"completed_on_disk"
    |"completed_from_transcript"
    |"failed_from_transcript"
    |"cancelled_from_transcript"
    |"not_applied"
    |"conflict"
    |"correlation_conflict"
    |"unknown_external_effect";
  replayAllowed:boolean;
  detail:string;
}

function correlationProblem(store:StateStore,sessionId:string,row:any,transcript?:TranscriptCorrelation):string|undefined{
  if(row.run_id){
    if(!store.runBelongsToSession(String(row.run_id),sessionId)) return `Execution references missing/foreign run ${row.run_id}`;
  }
  if(transcript&&row.tool_call_id&&!transcript.toolCalls.has(String(row.tool_call_id))){
    return `Pi tool call ${row.tool_call_id} is absent from the selected transcript branch`;
  }
  return undefined;
}

export async function reconcileExecutions(
  root:string,
  store:StateStore,
  sessionId:string,
  transcript?:TranscriptCorrelation
):Promise<RecoveryFinding[]>{
  const rows=store.unknownExecutions(sessionId) as any[];
  const out:RecoveryFinding[]=[];
  for(const r of rows){
    const base={executionId:String(r.execution_id),runId:r.run_id?String(r.run_id):undefined,toolCallId:r.tool_call_id?String(r.tool_call_id):undefined};
    const correlation=correlationProblem(store,sessionId,r,transcript);
    if(correlation){
      store.markExecution(r.execution_id,"unknown");
      out.push({...base,status:"correlation_conflict",replayAllowed:false,detail:correlation});
      continue;
    }

    let payload:any={};
    try{payload=JSON.parse(r.payload??"{}")??{};}catch{}

    if(r.effect_class==="workspace_edit" && payload.path){
      const current=await fileHash(path.resolve(root,payload.path));
      const before=r.before_hash??null;
      const expectedAfter=payload.expectedAfterHash??null;
      if(expectedAfter && current===expectedAfter){
        store.markExecution(r.execution_id,"completed",{afterHash:current??undefined});
        out.push({...base,status:"completed_on_disk",replayAllowed:false,detail:"Filesystem matches expected after-hash; durable result reconciled without replay."});
      }else if(current===before){
        store.markExecution(r.execution_id,"unknown");
        out.push({...base,status:"not_applied",replayAllowed:false,detail:"Filesystem still matches before-hash; operation was not auto-replayed."});
      }else{
        store.markExecution(r.execution_id,"unknown");
        out.push({...base,status:"conflict",replayAllowed:false,detail:"Filesystem matches neither known before nor expected after hash."});
      }
      continue;
    }

    const toolResult=r.tool_call_id&&transcript?transcript.toolResults.get(String(r.tool_call_id)):undefined;
    if(toolResult){
      const details=toolResult.details??{};
      if(details.executionId&&String(details.executionId)!==String(r.execution_id)){
        store.markExecution(r.execution_id,"unknown");
        out.push({...base,status:"correlation_conflict",replayAllowed:false,detail:`Transcript tool result references different execution ${details.executionId}`});
      }else if(toolResult.isError||details.timedOut||details.exitCode!==undefined&&details.exitCode!==null&&Number(details.exitCode)!==0){
        store.markExecution(r.execution_id,"failed",{exitCode:details.exitCode??null,signal:details.signal??null,timedOut:Boolean(details.timedOut),cancelled:Boolean(details.cancelled),outputComplete:details.outputComplete!==false,truncated:Boolean(details.truncated),logRef:details.logRef});
        out.push({...base,status:"failed_from_transcript",replayAllowed:false,detail:"Pi transcript contains a terminal failing tool result for this execution."});
      }else if(details.cancelled){
        store.markExecution(r.execution_id,"cancelled",{cancelled:true,signal:details.signal??null,outputComplete:details.outputComplete!==false,truncated:Boolean(details.truncated),logRef:details.logRef});
        out.push({...base,status:"cancelled_from_transcript",replayAllowed:false,detail:"Pi transcript contains a terminal cancelled tool result for this execution."});
      }else{
        store.markExecution(r.execution_id,"completed",{exitCode:details.exitCode??0,signal:details.signal??null,outputComplete:details.outputComplete!==false,truncated:Boolean(details.truncated),logRef:details.logRef});
        out.push({...base,status:"completed_from_transcript",replayAllowed:false,detail:"Pi transcript contains a matching terminal tool result; durable result reconciled without replay."});
      }
      continue;
    }

    store.markExecution(r.execution_id,"unknown");
    const detail=r.tool_call_id&&transcript?.toolCalls.has(String(r.tool_call_id))
      ?"Pi transcript contains the tool call but no matching terminal tool result; effect remains unknown."
      :"External/shell effect cannot be proven safe to replay automatically.";
    out.push({...base,status:"unknown_external_effect",replayAllowed:false,detail});
  }
  return out;
}
