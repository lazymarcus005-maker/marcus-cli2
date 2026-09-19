import path from "node:path";
import type { MacusConfig, RequestManifest, SourceFragment } from "../types.js";
import { categorizeProviderPayload, estimateTokens, validateRequestBudget } from "./budget.js";
import { fileHash, sha256 } from "../utils.js";
import { WorkingSet, selectFragments } from "./working-set.js";
import type { ManifestStore } from "./manifest-store.js";
import type { AgentHarness } from "../workflow/harness.js";
import type { StateStore } from "../storage/state.js";

export class ContextCoordinator {
  private effectiveFragments:SourceFragment[]=[];
  private effectiveOmissions:Array<{fragmentId:string;reason:string}>=[];

  constructor(
    readonly root:string,
    readonly config:MacusConfig,
    readonly workingSet:WorkingSet,
    readonly latestSourceHashes:Map<string,string>,
    readonly store:StateStore,
    readonly sessionId:string,
    readonly onManifest:(manifest:RequestManifest)=>void,
    readonly getHarness:()=>AgentHarness|undefined=()=>undefined,
  ){}

  private capToolMessage(message:any,maxTokens:number,reason:string):void{
    const text=(message.content??[]).filter((x:any)=>x.type==="text").map((x:any)=>x.text).join("\n");
    if(estimateTokens(text)<=maxTokens)return;
    const maxChars=Math.max(64,Math.floor(maxTokens/2));
    message.content=[{type:"text",text:text.slice(0,maxChars)+`\n[Macus context: ${reason}; output truncated for next provider request]`}];
  }

  private workingScore(pathValue:string):{tier:"HOT"|"WARM"|"COLD";score:number;reason:string}{
    const entry=this.workingSet.get(pathValue);
    if(!entry)return {tier:"COLD",score:10,reason:"fresh-read"};
    const base=entry.status==="ACTIVE"?100:entry.status==="RELATED"?70:entry.status==="DISCOVERED"?40:0;
    const stage=this.getHarness()?.state.stage;
    const stageBonus=(stage==="implement"||stage==="test"||stage==="fix")&&entry.status==="ACTIVE"?20:stage==="discover"&&entry.status==="DISCOVERED"?10:0;
    return {tier:entry.tier,score:base+stageBonus,reason:entry.reason};
  }

  async observeToolResult(event:any):Promise<void>{
    const d=event.details as any;
    const now=Date.now();
    if(event.toolName==="read_range"&&d?.path&&d?.hash){
      this.latestSourceHashes.set(d.path,d.hash);
      this.workingSet.upsert({path:d.path,sourceHash:d.hash,symbols:[],lastAccess:now,reason:"read_range",status:"ACTIVE",tier:"HOT"});
    }
    if(event.toolName==="search_symbol"&&d?.path&&d?.sourceHash){
      this.latestSourceHashes.set(d.path,d.sourceHash);
      this.workingSet.upsert({path:d.path,sourceHash:d.sourceHash,symbols:(d.symbols??[]).map((x:any)=>String(x.id)),lastAccess:now,reason:"symbol-discovery",status:"DISCOVERED",tier:"WARM"});
    }
    if(event.toolName==="search_code"&&Array.isArray(d?.matches)){
      for(const match of d.matches.slice(0,25)){
        const sourceHash=typeof match?.sourceHash==="string"?match.sourceHash:undefined;
        if(sourceHash)this.workingSet.upsert({path:String(match.path),sourceHash,symbols:[],lastAccess:now,reason:"text-search",status:"DISCOVERED",tier:"COLD"});
      }
    }
    if(["find_references","find_dependencies","find_dependents","impact"].includes(event.toolName)){
      const edges=[...(d?.references??[]),...(d?.dependencies??[]),...(d?.dependents??[]),...(d?.confirmed??[]),...(d?.candidate??[]),...(d?.unresolved??[])];
      for(const edge of edges.slice(0,50)){
        const p=String(edge?.evidence?.path??"");
        if(!p)continue;
        const sourceHash=String(edge?.evidence?.hash??"")||await fileHash(path.resolve(this.root,p));
        if(sourceHash)this.workingSet.upsert({path:p,sourceHash,symbols:[],lastAccess:now,reason:"relationship",status:"RELATED",tier:"WARM"});
      }
    }
    if(event.toolName==="write_file"&&d?.path&&d?.afterHash){
      this.latestSourceHashes.set(d.path,d.afterHash);
      this.workingSet.upsert({path:d.path,sourceHash:d.afterHash,symbols:[],lastAccess:now,reason:"agent-edit",status:"ACTIVE",tier:"HOT"});
    }
  }

  async transform(messagesInput:any[]):Promise<any[]>{
    const started=performance.now();
    const messages=structuredClone(messagesInput) as any[];
    const candidates:Array<{messageIndex:number;category:"search"|"working"|"repo_map";fragment:SourceFragment}>=[];
    const forcedOmissions:Array<{fragmentId:string;reason:string}>=[];
    const hashCache=new Map<string,Promise<string|null>>();
    const currentHash=(p:string)=>{
      const key=path.resolve(this.root,p);
      let pending=hashCache.get(key);
      if(!pending){pending=fileHash(key);hashCache.set(key,pending);}
      return pending;
    };

    for(let i=0;i<messages.length;i++){
      const m=messages[i];
      if(m?.role!=="toolResult")continue;
      const d=m.details as any;
      const toolId=String(m.toolCallId??("tool-"+i));

      if(m.toolName==="search_code"){
        const matches=Array.isArray(d?.matches)?d.matches:[];
        const verified:any[]=[];
        const sourceHashes:string[]=[];
        for(const match of matches){
          const matchPath=String(match?.path??"");
          const sourceHash=typeof match?.sourceHash==="string"?match.sourceHash:undefined;
          if(!matchPath||!sourceHash){forcedOmissions.push({fragmentId:toolId,reason:"unverified_search_source"});continue;}
          const current=await currentHash(matchPath);
          const latest=this.latestSourceHashes.get(matchPath);
          if(current!==sourceHash||(latest&&latest!==sourceHash)){
            this.workingSet.markStale(matchPath);
            forcedOmissions.push({fragmentId:toolId,reason:latest&&latest!==sourceHash?"superseded_source":"external_source_change"});
            continue;
          }
          this.latestSourceHashes.set(matchPath,sourceHash);
          verified.push(match);sourceHashes.push(matchPath+":"+sourceHash);
        }
        const sanitized={...d,matches:verified,returnedCount:verified.length,omittedStale:Math.max(0,matches.length-verified.length)};
        m.details=sanitized;m.content=[{type:"text",text:JSON.stringify(sanitized,null,2)}];
        this.capToolMessage(m,this.config.context.budget.search_results_tokens,"search_results_budget");
        if(verified.length){
          const text=(m.content??[]).filter((x:any)=>x.type==="text").map((x:any)=>x.text).join("\n");
          const uniquePaths=[...new Set(verified.map((x:any)=>String(x.path)))].sort();
          const rank=this.workingScore(uniquePaths[0]??"");
          candidates.push({messageIndex:i,category:"search",fragment:{
            fragmentId:toolId,source:uniquePaths.join(","),startLine:Math.min(...verified.map((x:any)=>Number(x.line)||1)),endLine:Math.max(...verified.map((x:any)=>Number(x.line)||1)),
            reason:"text-search",tier:rank.tier,score:rank.score,contentHash:sha256(sourceHashes.sort().join("|")),indexGeneration:0,
            freshness:"verified",estimatedTokens:estimateTokens(text),content:text
          }});
        }else if(matches.length)m.content=[{type:"text",text:"[Macus context: stale search results omitted; tool protocol result retained]"}];
        continue;
      }

      if(m.toolName==="search_symbol"){
        if(!d?.path||!d?.sourceHash)continue;
        const current=await currentHash(d.path);
        const latest=this.latestSourceHashes.get(d.path);
        if(current!==d.sourceHash||(latest&&latest!==d.sourceHash)){
          this.workingSet.markStale(d.path);
          forcedOmissions.push({fragmentId:toolId,reason:latest&&latest!==d.sourceHash?"superseded_source":"external_source_change"});
          m.content=[{type:"text",text:"[Macus context: stale symbol result omitted; tool protocol result retained]"}];
          continue;
        }
        const text=(m.content??[]).filter((x:any)=>x.type==="text").map((x:any)=>x.text).join("\n");
        const rank=this.workingScore(d.path);
        candidates.push({messageIndex:i,category:"working",fragment:{fragmentId:toolId,source:d.path,startLine:1,endLine:1,reason:"symbol-discovery",tier:rank.tier,score:rank.score,contentHash:d.sourceHash,indexGeneration:0,freshness:"verified",estimatedTokens:estimateTokens(text),content:text}});
        continue;
      }

      if(m.toolName==="repo_map"){
        const sources=Array.isArray(d?.sources)?d.sources:[];
        if(!sources.length)continue;
        let stale=false;
        for(const source of sources){
          const current=await currentHash(String(source.path??""));
          if(!current||current!==source.hash){stale=true;break;}
        }
        if(stale){
          forcedOmissions.push({fragmentId:toolId,reason:"stale_repo_map"});
          m.content=[{type:"text",text:"[Macus context: stale repository map omitted; tool protocol result retained]"}];
          continue;
        }
        const text=(m.content??[]).filter((x:any)=>x.type==="text").map((x:any)=>x.text).join("\n");
        const digest=sha256(sources.map((x:any)=>String(x.path)+":"+String(x.hash)).sort().join("|"));
        candidates.push({messageIndex:i,category:"repo_map",fragment:{fragmentId:toolId,source:"[repo-map]",startLine:1,endLine:1,reason:"repo-map",tier:"COLD",score:1,contentHash:digest,indexGeneration:0,freshness:"verified",estimatedTokens:estimateTokens(text),content:text}});
        continue;
      }

      if(m.toolName!=="read_range"){
        if(["run_command","run_test","read_log"].includes(m.toolName))this.capToolMessage(m,this.config.context.budget.tool_output_tokens,"tool_output_budget");
        continue;
      }

      if(!d?.path||!d?.hash)continue;
      const current=await currentHash(d.path);
      const latest=this.latestSourceHashes.get(d.path);
      const freshness=current===d.hash&&(!latest||latest===d.hash)?"verified":"stale";
      if(freshness!=="verified")this.workingSet.markStale(d.path);
      else this.latestSourceHashes.set(d.path,d.hash);

      const text=(m.content??[]).filter((x:any)=>x.type==="text").map((x:any)=>x.text).join("\n");
      const estimatedTokens=estimateTokens(text);
      if(estimatedTokens>this.config.context.budget.single_file_read_tokens){forcedOmissions.push({fragmentId:toolId,reason:"single_file_budget"});continue;}
      if(freshness!=="verified"){forcedOmissions.push({fragmentId:toolId,reason:latest&&latest!==d.hash?"superseded_source":"external_source_change"});continue;}
      const rank=this.workingScore(d.path);
      candidates.push({messageIndex:i,category:"working",fragment:{
        fragmentId:toolId,source:d.path,startLine:d.startLine??1,endLine:d.endLine??d.startLine??1,
        reason:rank.reason,tier:rank.tier,score:rank.score,contentHash:d.hash,indexGeneration:0,
        freshness,estimatedTokens,content:text
      }});
    }

    const selectedByCategory=[
      selectFragments(candidates.filter(x=>x.category==="search").map(x=>x.fragment),this.config.context.budget.search_results_tokens),
      selectFragments(candidates.filter(x=>x.category==="repo_map").map(x=>x.fragment),this.config.context.budget.repo_map_tokens),
      selectFragments(candidates.filter(x=>x.category==="working").map(x=>x.fragment),this.config.context.budget.tool_output_tokens),
    ];
    const selected=selectedByCategory.flatMap(x=>x.included);
    const omitted=selectedByCategory.flatMap(x=>x.omitted);
    const selectedIds=new Set(selected.map(x=>x.fragmentId));
    const omissionReason=new Map([...omitted,...forcedOmissions].map(x=>[x.fragmentId,x.reason]));

    for(const candidate of candidates){
      if(selectedIds.has(candidate.fragment.fragmentId))continue;
      const reason=omissionReason.get(candidate.fragment.fragmentId)??"context_selection";
      messages[candidate.messageIndex].content=[{type:"text",text:`[Macus context: ${reason} omitted; tool protocol result retained]`}];
    }
    for(const omission of forcedOmissions){
      const index=messages.findIndex((m:any,idx:number)=>String(m?.toolCallId??("tool-"+idx))===omission.fragmentId);
      if(index>=0&&!selectedIds.has(omission.fragmentId))messages[index].content=[{type:"text",text:`[Macus context: ${omission.reason} omitted; tool protocol result retained]`}];
    }

    this.effectiveFragments=selected;
    this.effectiveOmissions=[...omitted,...forcedOmissions];
    this.store.recordMetric({sessionId:this.sessionId,name:"context.prepare_ms",value:performance.now()-started});
    return messages;
  }

  async beforeProviderRequest(args:{
    payload:any;
    ctx:any;
    harness?:AgentHarness;
    activeProfileName:string;
    activeModelAlias:string;
    instructionHashes:string[];
    manifestStore:ManifestStore;
  }):Promise<any>{
    const started=performance.now();
    try{
      if(args.harness){args.harness.onTurn();args.harness.assertRunnable();}
      const profile=this.config.model_profiles[args.activeProfileName];
      if(!profile)throw new Error("Unknown model profile "+args.activeProfileName);
      const categories=categorizeProviderPayload(args.payload);
      let available=categories.other_tool_output??0;
      const move=(target:"search_results"|"repo_map"|"working_source",amount:number)=>{
        const moved=Math.min(available,amount);available-=moved;categories[target]=(categories[target]??0)+moved;
      };
      move("search_results",this.effectiveFragments.filter(f=>f.reason==="text-search").reduce((n,f)=>n+f.estimatedTokens,0));
      move("repo_map",this.effectiveFragments.filter(f=>f.reason==="repo-map").reduce((n,f)=>n+f.estimatedTokens,0));
      move("working_source",this.effectiveFragments.filter(f=>f.reason!=="text-search"&&f.reason!=="repo-map").reduce((n,f)=>n+f.estimatedTokens,0));
      categories.other_tool_output=available;
      const manifest=validateRequestBudget({
        payload:args.payload,categories,profile,context:this.config.context,
        sessionId:this.sessionId,modelId:args.activeModelAlias,instructionHashes:args.instructionHashes
      });
      manifest.includedFragments=this.effectiveFragments.map(f=>({fragmentId:f.fragmentId,source:f.source,contentHash:f.contentHash,freshness:f.freshness,estimatedTokens:f.estimatedTokens}));
      manifest.omissions=[...this.effectiveOmissions];
      this.onManifest(manifest);
      await args.manifestStore.save(manifest);
      this.store.recordMetric({sessionId:this.sessionId,name:"provider.request_input_tokens",value:manifest.estimatedPromptTokens,unit:"tokens"});
      this.store.recordMetric({sessionId:this.sessionId,name:"context.selected_tokens",value:manifest.includedFragments.reduce((n,f)=>n+f.estimatedTokens,0),unit:"tokens"});
      this.store.recordMetric({sessionId:this.sessionId,name:"provider.prepare_ms",value:performance.now()-started});
      return args.payload;
    }catch(error){
      args.ctx.abort();
      throw error;
    }
  }
}
