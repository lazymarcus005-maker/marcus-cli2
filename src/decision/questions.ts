import type { DecisionKind,JevQuestions } from "./types.js";

export function questionsFor(kind:DecisionKind):JevQuestions{
  if(kind==="failure_triage"){
    return {
      failure_type:{
        type:"choice",
        instructions:"What is the most likely primary class of this coding-agent execution failure?",
        criteria:{
          code_bug:"The implementation or source code is incorrect.",
          test_bug:"The test itself or test expectation is incorrect.",
          dependency:"A dependency, package, or external library state is the primary cause.",
          environment:"Runtime machine, process, operating-system, or service environment is the primary cause.",
          configuration:"Project or tool configuration is the primary cause.",
          flaky:"The failure is likely transient or nondeterministic.",
          unknown:"There is not enough evidence to assign another class.",
        },
      },
      retry_same_strategy:{type:"noul",instructions:"Would repeating the same strategy without changing source, configuration, dependencies, or environment likely succeed?"},
      needs_source_change:{type:"noul",instructions:"Is a source-code change likely required to resolve this failure?"},
      likely_external_issue:{type:"noul",instructions:"Is the primary cause likely outside the code currently being implemented?"},
    };
  }
  if(kind==="progress_judge"){
    return {
      meaningful_progress:{type:"noul",instructions:"Does the latest attempt represent meaningful progress toward resolving the current failure?"},
      strategy_materially_changed:{type:"noul",instructions:"Did the latest attempt materially change the strategy rather than repeat the same approach?"},
      likely_looping:{type:"noul",instructions:"Is the coding agent likely looping without meaningful progress?"},
    };
  }
  return {
    implementation_matches_task:{type:"noul",instructions:"Based only on the supplied review state, does the implementation appear aligned with the recorded task scope?"},
    regression_risk:{
      type:"choice",
      instructions:"What is the overall regression-risk level of the reviewed change given its evidence and unresolved risks?",
      criteria:{
        negligible:"No meaningful regression risk is visible in the supplied state.",
        low:"Minor regression risk exists but evidence is strong.",
        medium:"Material regression risk exists or evidence has notable gaps.",
        high:"Serious regression risk or major evidence gaps exist.",
        critical:"The supplied state indicates a likely unsafe or severely incomplete change.",
      },
    },
    evidence_sufficient:{type:"noul",instructions:"Is the supplied fresh linked evidence sufficient for the reviewed tasks?"},
    needs_more_testing:{type:"noul",instructions:"Would additional testing materially improve confidence in this change?"},
    likely_scope_creep:{type:"noul",instructions:"Does the supplied change/review state suggest work outside the recorded task scope?"},
  };
}
