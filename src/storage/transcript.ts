import path from "node:path";
import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";

export interface TranscriptToolResult {
  toolCallId:string;
  entryId:string;
  isError:boolean;
  details:any;
}

export interface TranscriptCorrelation {
  leafId?:string;
  entryIds:Set<string>;
  toolCalls:Set<string>;
  toolResults:Map<string,TranscriptToolResult>;
}

function collect(entries:SessionEntry[],leafId?:string):TranscriptCorrelation{
  const entryIds=new Set<string>();
  const toolCalls=new Set<string>();
  const toolResults=new Map<string,TranscriptToolResult>();
  for(const entry of entries){
    entryIds.add(entry.id);
    if(entry.type!=="message") continue;
    const message:any=entry.message;
    if(message?.role==="assistant"&&Array.isArray(message.content)){
      for(const part of message.content){
        if(part?.type==="toolCall"&&typeof part.id==="string") toolCalls.add(part.id);
      }
    }
    if(message?.role==="toolResult"&&typeof message.toolCallId==="string"){
      toolResults.set(message.toolCallId,{
        toolCallId:message.toolCallId,
        entryId:entry.id,
        isError:Boolean(message.isError),
        details:message.details,
      });
    }
  }
  return {leafId,entryIds,toolCalls,toolResults};
}

export function readTranscriptCorrelation(root:string,sessionId:string,leafId?:string):TranscriptCorrelation{
  const sessionDir=path.join(root,".macus","sessions",sessionId);
  const manager=SessionManager.continueRecent(root,sessionDir);
  const selected=leafId??manager.getLeafId()??undefined;
  if(selected&&!manager.getEntry(selected)) throw new Error(`Unknown transcript entry ${selected}`);
  return collect(selected?manager.getBranch(selected):manager.getBranch(),selected);
}

export function currentTranscriptRef(root:string,sessionId:string):string|undefined{
  const sessionDir=path.join(root,".macus","sessions",sessionId);
  return SessionManager.continueRecent(root,sessionDir).getLeafId()??undefined;
}
