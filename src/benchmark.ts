import { mkdtemp,writeFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DEFAULT_CONFIG } from "./config.js";
import { searchCode } from "./retrieval/search.js";
import { SymbolIndex } from "./retrieval/index.js";
import { readRange } from "./retrieval/symbols.js";

function percentile(xs:number[],p:number):number {
  const sorted=xs.slice().sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))] ?? 0;
}

function fixtureContent(i:number,bytesPerFile:number,revision=0):string {
  const code=`export class C${i} { method${i}(){ return ${i+revision} } }\n`;
  const pad=Math.max(0,bytesPerFile-code.length-5);
  return code+"/*"+"x".repeat(pad)+"*/\n";
}

async function main(){
  const root=await mkdtemp(path.join(os.tmpdir(),"macus-bench-"));
  const files=Number(process.env.MACUS_BENCH_FILES??"1000");
  const bytesPerFile=Number(process.env.MACUS_BENCH_BYTES_PER_FILE??"1024");
  const queryRuns=Number(process.env.MACUS_BENCH_QUERY_RUNS??"100");
  const refreshRuns=Number(process.env.MACUS_BENCH_REFRESH_RUNS??"100");
  const idleSeconds=Number(process.env.MACUS_BENCH_IDLE_SECONDS??"0");

  for(let i=0;i<files;i++) await writeFile(path.join(root,`f${i}.ts`),fixtureContent(i,bytesPerFile));

  const cfg=structuredClone(DEFAULT_CONFIG);
  cfg.retrieval.max_parse_file_bytes=Math.max(cfg.retrieval.max_parse_file_bytes,bytesPerFile*2);
  const index=await SymbolIndex.open(root,cfg);
  const discovery=await index.discover(files);
  const discovered=discovery.files;

  let peakRss=process.memoryUsage().rss;
  const t0=performance.now();
  for(let i=0;i<discovered.length;i++){
    await index.refresh(discovered[i]);
    if(i%50===0) peakRss=Math.max(peakRss,process.memoryUsage().rss);
  }
  const indexMs=performance.now()-t0;
  peakRss=Math.max(peakRss,process.memoryUsage().rss);

  const searchTimes:number[]=[];
  for(let i=0;i<queryRuns;i++){
    const s=performance.now();
    await searchCode(root,cfg,{query:"method"+(i%files),maxResults:100});
    searchTimes.push(performance.now()-s);
  }

  const verifiedReadTimes:number[]=[];
  for(let i=0;i<queryRuns;i++){
    const symbol=index.search("C"+(i%files),1)[0];
    if(!symbol) continue;
    const s=performance.now();
    await readRange(root,symbol.path,symbol.startLine,Math.min(symbol.endLine,symbol.startLine+8),symbol.sourceHash);
    verifiedReadTimes.push(performance.now()-s);
  }

  const refreshTimes:number[]=[];
  for(let i=0;i<refreshRuns;i++){
    await writeFile(path.join(root,"f0.ts"),fixtureContent(0,bytesPerFile,i+1));
    const s=performance.now();
    await index.refresh("f0.ts");
    refreshTimes.push(performance.now()-s);
    peakRss=Math.max(peakRss,process.memoryUsage().rss);
  }

  let idleCpuPercentOfOneCore:number|undefined;
  if(idleSeconds>0){
    const start=process.cpuUsage();
    await new Promise(r=>setTimeout(r,idleSeconds*1000));
    const used=process.cpuUsage(start);
    const cpuMs=(used.user+used.system)/1000;
    idleCpuPercentOfOneCore=(cpuMs/(idleSeconds*1000))*100;
  }

  const result={
    hardware:{platform:process.platform,arch:process.arch,node:process.version},
    fixture:{files,bytesPerFile,approxBytes:files*bytesPerFile},
    coldIndex:{ms:indexMs,filesPerSecond:files/(indexMs/1000)},
    warmSearch:{p95Ms:percentile(searchTimes,.95),runs:searchTimes.length},
    verifiedCachedSymbolRead:{p95Ms:percentile(verifiedReadTimes,.95),runs:verifiedReadTimes.length},
    singleFileRefresh:{p95Ms:percentile(refreshTimes,.95),runs:refreshTimes.length,fileBytes:bytesPerFile},
    memory:{peakRssBytes:peakRss,finalRssBytes:process.memoryUsage().rss},
    idleCpu:idleSeconds>0?{seconds:idleSeconds,percentOfOneCore:idleCpuPercentOfOneCore}:{status:"not_measured",hint:"Set MACUS_BENCH_IDLE_SECONDS=60 for the release measurement."},
    note:"Local retrieval/index harness; real-model Pi-vs-Macus quality is measured separately by the paired harness."
  };
  console.log(JSON.stringify(result,null,2));
  index.close();
  await rm(root,{recursive:true,force:true});
}

main().catch(e=>{console.error(e);process.exitCode=1;});
