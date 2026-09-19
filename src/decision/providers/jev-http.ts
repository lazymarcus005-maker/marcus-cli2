import type { JevInternalModelConfig } from "../../types.js";
import type { JevProviderResponse,JevQuestions } from "../types.js";

export type JevTransportFailure="timeout"|"provider_error"|"parse_error"|"cancelled";

export class JevTransportError extends Error {
  constructor(readonly category:JevTransportFailure,message:string,readonly statusCode?:number){
    super(message);
    this.name="JevTransportError";
  }
}

function finiteProbability(value:unknown):value is number {
  return typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=1;
}

function validateAnswer(question:any,answer:any,key:string):void{
  if(!answer||typeof answer!=="object"||answer.type!==question.type) throw new JevTransportError("parse_error",`Jev answer type mismatch for ${key}`);
  if(question.type==="noul"){
    if(!finiteProbability(answer.noul)) throw new JevTransportError("parse_error",`Invalid Jev noul answer for ${key}`);
    return;
  }
  if(!finiteProbability(answer.confidence)||!answer.probabilities||typeof answer.probabilities!=="object") throw new JevTransportError("parse_error",`Invalid Jev probabilistic answer for ${key}`);
  for(const value of Object.values(answer.probabilities)) if(!finiteProbability(value)) throw new JevTransportError("parse_error",`Invalid Jev probability for ${key}`);
  if(question.type==="choice"){
    if(typeof answer.choice!=="string"||!(answer.choice in question.criteria)) throw new JevTransportError("parse_error",`Invalid Jev choice for ${key}`);
  }else{
    if(typeof answer.score!=="number"||!Number.isFinite(answer.score)||answer.score<0||answer.score>question.criteria.length-1) throw new JevTransportError("parse_error",`Invalid Jev score for ${key}`);
  }
}

export function validateJevResponse(raw:any,questions:JevQuestions):JevProviderResponse{
  if(!raw||typeof raw!=="object"||typeof raw.model!=="string"||!raw.answers||typeof raw.answers!=="object") throw new JevTransportError("parse_error","Malformed Jev response");
  for(const [key,question] of Object.entries(questions)){
    if(!(key in raw.answers)) throw new JevTransportError("parse_error",`Jev did not answer ${key}`);
    validateAnswer(question,raw.answers[key],key);
  }
  if(raw.usage!==undefined&&(!raw.usage||typeof raw.usage!=="object")) throw new JevTransportError("parse_error","Malformed Jev usage");
  return raw as JevProviderResponse;
}

export class JevHttpDecisionProvider {
  constructor(readonly config:JevInternalModelConfig){}

  get endpoint():string{
    if(this.config.base_url) return this.config.base_url;
    return this.config.transport==="openrouter"
      ?"https://openrouter.ai/api/alpha/decisions"
      :"https://api.typesafe.ai/v1/systemone";
  }

  async decide(state:unknown,questions:JevQuestions,signal?:AbortSignal):Promise<JevProviderResponse>{
    const key=process.env[this.config.api_key_env];
    if(!key) throw new JevTransportError("provider_error",`Missing environment variable ${this.config.api_key_env}`);
    let response:Response;
    try{
      response=await fetch(this.endpoint,{
        method:"POST",
        headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},
        body:JSON.stringify({model:this.config.model,state,questions}),
        signal,
      });
    }catch(error:any){
      if(signal?.aborted||error?.name==="AbortError") throw new JevTransportError("cancelled","Jev request aborted");
      throw new JevTransportError("provider_error",`Jev request failed: ${error instanceof Error?error.message:String(error)}`);
    }
    if(!response.ok){
      const body=(await response.text()).slice(0,2000);
      throw new JevTransportError("provider_error",`Jev HTTP ${response.status}: ${body}`,response.status);
    }
    let raw:any;
    try{raw=await response.json();}catch{throw new JevTransportError("parse_error","Jev response was not JSON");}
    return validateJevResponse(raw,questions);
  }
}
