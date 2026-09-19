import { describe,it,expect } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/storage/state.js";
import { reconcileExecutions } from "../src/storage/recovery.js";
import type { TranscriptCorrelation } from "../src/storage/transcript.js";

describe("transcript-aware execution recovery",()=>{
  it("uses matching Pi tool result to finalize an unknown shell execution",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-recovery-transcript-"));
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");const runId=store.createRun(sid);
    store.prepareExecution({executionId:"exec_shell",sessionId:sid,runId,toolCallId:"tc1",effectClass:"shell",command:"true"});
    store.markExecution("exec_shell","started");
    const transcript:TranscriptCorrelation={
      leafId:"leaf",entryIds:new Set(["call","result"]),toolCalls:new Set(["tc1"]),
      toolResults:new Map([["tc1",{toolCallId:"tc1",entryId:"result",isError:false,details:{executionId:"exec_shell",exitCode:0,timedOut:false,cancelled:false,outputComplete:true}}]])
    };
    const findings=await reconcileExecutions(root,store,sid,transcript);
    expect(findings).toEqual([expect.objectContaining({executionId:"exec_shell",runId,toolCallId:"tc1",status:"completed_from_transcript"})]);
    const row=store.db.prepare("SELECT status FROM executions WHERE execution_id='exec_shell'").get() as any;
    expect(row.status).toBe("completed");
    store.close();await rm(root,{recursive:true,force:true});
  });

  it("flags a journal tool call that is absent from the selected transcript branch",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-recovery-correlation-"));
    const store=await StateStore.open(root);const sid=store.createSession(root,"repo");const runId=store.createRun(sid);
    store.prepareExecution({executionId:"exec_missing",sessionId:sid,runId,toolCallId:"tc-missing",effectClass:"shell",command:"true"});
    store.markExecution("exec_missing","started");
    const transcript:TranscriptCorrelation={leafId:"leaf",entryIds:new Set(["leaf"]),toolCalls:new Set(),toolResults:new Map()};
    const findings=await reconcileExecutions(root,store,sid,transcript);
    expect(findings[0]).toMatchObject({executionId:"exec_missing",status:"correlation_conflict",replayAllowed:false});
    expect(findings[0].detail).toMatch(/absent from the selected transcript branch/i);
    store.close();await rm(root,{recursive:true,force:true});
  });
});
