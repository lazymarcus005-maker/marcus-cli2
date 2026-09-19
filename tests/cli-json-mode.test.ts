import { describe,it,expect } from "vitest";
import http from "node:http";
import { mkdtemp,writeFile,readFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileHash } from "../src/utils.js";

function sse(res:http.ServerResponse,chunks:unknown[]){
  res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache"});
  for(const c of chunks)res.write("data: "+JSON.stringify(c)+"\n\n");
  res.write("data: [DONE]\n\n");res.end();
}

function run(root:string,args:string[],env:NodeJS.ProcessEnv):Promise<{code:number|null;stdout:string;stderr:string}>{
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.resolve("dist/cli.js"),...args],{cwd:root,env:{...process.env,...env},stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="";child.stdout.on("data",c=>stdout+=c);child.stderr.on("data",c=>stderr+=c);child.on("error",reject);child.on("exit",code=>resolve({code,stdout,stderr}));
  });
}

function configYaml(port:number):string{
  return `schema_version: 1
models:
  default: primary
  providers:
    mock:
      protocol: openai-compatible
      base_url: http://127.0.0.1:${port}/v1
      api_key_env: MACUS_TEST_KEY
      profile: standard
      model: mock
  aliases:
    primary: mock
model_profiles:
  standard:
    context_window: 65536
    max_output_tokens: 1024
    tokenizer: conservative-byte-estimate
context:
  reserved_output_tokens: 1024
  safety_margin_tokens: 512
`;
}

describe("CLI JSON mode",()=>{
  it("returns one JSON envelope without interactive/help text",async()=>{
    const server=http.createServer(async(req,res)=>{
      for await(const _ of req){}
      sse(res,[
        {id:"c1",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:"hello-json"},finish_reason:null}]},
        {id:"c1",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"stop"}]},
      ]);
    });
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as any).port;
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-json-cli-"));const config=path.join(root,"global.yaml");
    await writeFile(config,configYaml(port));
    const result=await run(root,["--config",config,"--json","say hello"],{MACUS_TEST_KEY:"secret"});
    expect(result.code).toBe(0);
    const parsed=JSON.parse(result.stdout);
    expect(parsed.status).toBe("completed");expect(parsed.result).toContain("hello-json");expect(parsed.sessionId).toMatch(/^session_/);
    expect(result.stdout).not.toContain("macus>");
    expect(result.stdout).not.toContain("Commands:");
    await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
  },15000);

  it("uses exit code 3 when a completed run leaves failed verification evidence",async()=>{
    let calls=0;
    const server=http.createServer(async(req,res)=>{
      for await(const _ of req){};calls++;
      if(calls===1){
        sse(res,[
          {id:"c1",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id:"t1",type:"function",function:{name:"run_test",arguments:JSON.stringify({command:"npm test"})}}]},finish_reason:null}]},
          {id:"c1",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"tool_calls"}]},
        ]);
      }else{
        sse(res,[{id:"c2",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:"done"},finish_reason:"stop"}]}]);
      }
    });
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as any).port;
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-json-verify-"));const config=path.join(root,"global.yaml");
    await writeFile(path.join(root,"package.json"),JSON.stringify({scripts:{test:"node -e \"console.log('Tests 1 passed 1 failed'); process.exit(1)\""}},null,2));
    await writeFile(config,configYaml(port));
    const result=await run(root,["--config",config,"--authorize","shell","--json","run tests"],{MACUS_TEST_KEY:"secret"});
    expect(result.code).toBe(3);
    const parsed=JSON.parse(result.stdout);
    expect(parsed.status).toBe("completed");expect(parsed.evidence[0].status).toBe("failed");
    await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
  },15000);

  it("uses verification exit status for a human-readable prompt run",async()=>{
    let calls=0;
    const server=http.createServer(async(req,res)=>{
      for await(const _ of req){};calls++;
      if(calls===1){
        sse(res,[
          {id:"c1",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id:"t1",type:"function",function:{name:"run_test",arguments:JSON.stringify({command:"npm test"})}}]},finish_reason:null}]},
          {id:"c1",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"tool_calls"}]},
        ]);
      }else{
        sse(res,[{id:"c2",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:"done"},finish_reason:"stop"}]}]);
      }
    });
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as any).port;
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-human-verify-"));
    const config=path.join(root,"global.yaml");await writeFile(config,configYaml(port));
    const result=await run(root,["--config",config,"--authorize","shell","run tests"],{MACUS_TEST_KEY:"secret"});
    expect(result.code).toBe(3);
    expect(result.stdout).toContain("done");
    await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
  },15000);

  it("uses exit code 3 when a completed run edits workspace files without fresh passing evidence",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-json-unverified-edit-"));
    const source=path.join(root,"app.mjs");
    await writeFile(source,"export const value = 1;\n");
    const expectedHash=(await fileHash(source))!;
    let calls=0;
    const server=http.createServer(async(_req,res)=>{
      for await(const _ of _req){};calls++;
      if(calls===1){
        sse(res,[
          {id:"c1",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id:"write_1",type:"function",function:{name:"write_file",arguments:JSON.stringify({path:"app.mjs",content:"export const value = 2;\n",expectedHash})}}]},finish_reason:null}]},
          {id:"c1",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"tool_calls"}]},
        ]);
      }else{
        sse(res,[{id:"c2",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:"done"},finish_reason:"stop"}]}]);
      }
    });
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as any).port;
    const config=path.join(root,"global.yaml");await writeFile(config,configYaml(port));
    const result=await run(root,["--config",config,"--authorize","edits","--json","change the value"],{MACUS_TEST_KEY:"secret"});
    expect(result.code).toBe(3);
    const parsed=JSON.parse(result.stdout);
    expect(parsed.status).toBe("completed");
    expect(parsed.evidence).toEqual([]);
    expect(await readFile(source,"utf8")).toContain("value = 2");
    await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
  },15000);

  it("records fresh evidence when a trusted test runs through run_command",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-json-trusted-command-"));
    await writeFile(path.join(root,"package.json"),JSON.stringify({scripts:{test:"node -e \"console.log('Tests 1 passed')\""}},null,2));
    let calls=0;
    const server=http.createServer(async(req,res)=>{
      for await(const _ of req){};calls++;
      if(calls===1){
        sse(res,[
          {id:"c1",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id:"shell_1",type:"function",function:{name:"run_command",arguments:JSON.stringify({command:"npm test"})}}]},finish_reason:null}]},
          {id:"c1",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{},finish_reason:"tool_calls"}]},
        ]);
      }else{
        sse(res,[{id:"c2",object:"chat.completion.chunk",created:1,model:"mock",choices:[{index:0,delta:{role:"assistant",content:"tests passed"},finish_reason:"stop"}]}]);
      }
    });
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as any).port;
    const config=path.join(root,"global.yaml");await writeFile(config,configYaml(port));
    const result=await run(root,["--config",config,"--authorize","shell","--json","run the tests"],{MACUS_TEST_KEY:"secret"});
    expect(result.code).toBe(0);
    const parsed=JSON.parse(result.stdout);
    expect(parsed.evidence[0].status).toBe("passed");
    expect(parsed.evidence[0].detail.trustedCommand).toBe(true);
    await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
  },15000);

  it("returns structured JSON for startup/resume errors",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-json-error-"));
    const result=await run(root,["--resume","session_missing","--json"],{});
    expect(result.code).not.toBe(0);
    const parsed=JSON.parse(result.stdout);
    expect(parsed.status).toBe("failed");expect(parsed.error).toMatch(/Unknown session/);
    await rm(root,{recursive:true,force:true});
  });

  it("prints human dashboard for interactive /status without creating a session",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"macus-dashboard-"));
    const result=await new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
      const child=spawn(process.execPath,[path.resolve("dist/cli.js")],{cwd:root,stdio:["pipe","pipe","pipe"]});
      let stdout="",stderr="";child.stdout.on("data",c=>stdout+=c);child.stderr.on("data",c=>stderr+=c);child.on("error",reject);child.on("exit",code=>resolve({code,stdout,stderr}));
      child.stdin.end("/status\n/exit\n");
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Session   (none)");
    expect(result.stdout).toContain("Lock      read-only");
    await rm(root,{recursive:true,force:true});
  });
});
