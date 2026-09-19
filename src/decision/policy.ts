import type { MacusConfig } from "../types.js";

const MAX_DEPTH=8;
const MAX_KEYS=100;
const MAX_ARRAY=50;
const MAX_STRING=4000;

function secretValues(config:MacusConfig):string[]{
  const names=new Set<string>();
  for(const provider of Object.values(config.models.providers)) if(provider.api_key_env) names.add(provider.api_key_env);
  if(config.internal_models.jev.api_key_env) names.add(config.internal_models.jev.api_key_env);
  return [...names].map(name=>process.env[name]).filter((x):x is string=>Boolean(x&&x.length>=4)).sort((a,b)=>b.length-a.length);
}

function redactText(value:string,secrets:string[]):string{
  let out=value;
  for(const secret of secrets) out=out.split(secret).join("[REDACTED]");
  return out.length<=MAX_STRING?out:out.slice(0,MAX_STRING)+"…";
}

function sanitize(value:unknown,secrets:string[],depth:number):unknown{
  if(depth>MAX_DEPTH) return "[TRUNCATED_DEPTH]";
  if(value===null||value===undefined||typeof value==="number"||typeof value==="boolean") return value;
  if(typeof value==="string") return redactText(value,secrets);
  if(Array.isArray(value)) return value.slice(0,MAX_ARRAY).map(v=>sanitize(v,secrets,depth+1));
  if(typeof value==="object"){
    const out:Record<string,unknown>={};
    for(const [key,val] of Object.entries(value as Record<string,unknown>).slice(0,MAX_KEYS)){
      if(/(?:api[_-]?key|token|secret|password|credential)/i.test(key)){out[key]="[REDACTED_FIELD]";continue;}
      out[key]=sanitize(val,secrets,depth+1);
    }
    return out;
  }
  return String(value);
}

export function sanitizeDecisionState(value:unknown,config:MacusConfig):unknown{
  return sanitize(value,secretValues(config),0);
}
