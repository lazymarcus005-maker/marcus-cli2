import { mkdtemp,mkdir,writeFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceSnapshotStore } from "./testing/snapshot-store.js";

function arg(name:string,fallback:number):number{
  const index=process.argv.indexOf(name);
  if(index<0)return fallback;
  const value=Number(process.argv[index+1]);
  if(!Number.isFinite(value)||value<=0)throw new Error(`${name} requires a positive number`);
  return Math.floor(value);
}

async function timed(store:WorkspaceSnapshotStore){
  const started=performance.now();
  const digest=await store.digest();
  return {digest,wallClockMs:performance.now()-started,...store.lastStats};
}

async function main(){
  const fileCount=arg("--files",2000);
  const bytesPerFile=arg("--bytes",10*1024);
  const root=await mkdtemp(path.join(os.tmpdir(),"macus-snapshot-bench-"));
  const payload="x".repeat(Math.max(1,bytesPerFile-32));
  try{
    for(let i=0;i<fileCount;i++){
      const dir=path.join(root,"src",String(Math.floor(i/250)));
      if(i%250===0)await mkdir(dir,{recursive:true});
      await writeFile(path.join(dir,`file-${i}.ts`),`// ${i}\n${payload}\n`);
    }
    const store=new WorkspaceSnapshotStore(root);
    const cold=await timed(store);
    const warm=await timed(store);
    const target=path.join(root,"src","0","file-0.ts");
    await writeFile(target,`// changed\n${payload}\n`);
    const oneFileChange=await timed(store);
    process.stdout.write(JSON.stringify({
      fileCount,bytesPerFile,approxBytes:fileCount*bytesPerFile,
      cold,warm,oneFileChange,
      warmReadReduction:cold.bytesRead?1-(warm.bytesRead/cold.bytesRead):1,
      changedReadReduction:cold.bytesRead?1-(oneFileChange.bytesRead/cold.bytesRead):1,
    },null,2)+"\n");
  }finally{
    await rm(root,{recursive:true,force:true});
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
