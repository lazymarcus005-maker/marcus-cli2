export type DecisionKind="failure_triage"|"progress_judge"|"review_risk";
export type JevMode="shadow"|"advisory"|"limited-routing";

export interface JevChoiceQuestion {
  type:"choice";
  instructions:string;
  criteria:Record<string,string>;
}
export interface JevScoreQuestion {
  type:"score";
  instructions:string;
  criteria:string[];
}
export interface JevNoulQuestion {
  type:"noul";
  instructions:string;
}
export type JevQuestion=JevChoiceQuestion|JevScoreQuestion|JevNoulQuestion;
export type JevQuestions=Record<string,JevQuestion>;

export interface JevChoiceAnswer {
  type:"choice";
  choice:string;
  probabilities:Record<string,number>;
  confidence:number;
}
export interface JevScoreAnswer {
  type:"score";
  score:number;
  legend?:Record<string,string>;
  probabilities:Record<string,number>;
  confidence:number;
}
export interface JevNoulAnswer {
  type:"noul";
  noul:number;
}
export type JevAnswer=JevChoiceAnswer|JevScoreAnswer|JevNoulAnswer;

export interface JevUsage {
  input_tokens?:number;
  output_tokens?:number;
  cost?:number;
}

export interface JevProviderResponse {
  id?:string;
  model:string;
  provider?:string;
  answers:Record<string,JevAnswer>;
  usage?:JevUsage;
}

export interface DecisionRequest {
  kind:DecisionKind;
  schemaVersion:number;
  state:unknown;
  questions:JevQuestions;
}

export interface DecisionContext {
  sessionId:string;
  runId?:string;
  eventId:string;
  signal?:AbortSignal;
}

export interface DecisionResult {
  kind:DecisionKind;
  eventId:string;
  model:string;
  provider:string;
  latencyMs:number;
  stateDigest:string;
  answers:Record<string,JevAnswer>;
  usage?:JevUsage;
}
