import { describe,it,expect } from "vitest";
import http from "node:http";
import { DEFAULT_CONFIG } from "../src/config.js";
import { JevHttpDecisionProvider } from "../src/decision/providers/jev-http.js";
import { questionsFor } from "../src/decision/questions.js";

describe("Jev Decisions transport",()=>{
  it("posts state + typed questions to the dedicated decisions endpoint shape",async()=>{
    let captured:any;
    const server=http.createServer(async(req,res)=>{
      let body="";for await(const c of req)body+=c;captured={url:req.url,auth:req.headers.authorization,body:JSON.parse(body)};
      res.writeHead(200,{"content-type":"application/json"});
      res.end(JSON.stringify({
        id:"dec_1",model:"typesafe/jev-1.13-20260917",provider:"TypeSafe",
        answers:{
          failure_type:{type:"choice",choice:"code_bug",probabilities:{code_bug:.9,test_bug:.02,dependency:.02,environment:.01,configuration:.02,flaky:.01,unknown:.02},confidence:.9},
          retry_same_strategy:{type:"noul",noul:.1},
          needs_source_change:{type:"noul",noul:.9},
          likely_external_issue:{type:"noul",noul:.1},
        },
        usage:{input_tokens:123,output_tokens:20,cost:.00001}
      }));
    });
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as any).port;
    process.env.MACUS_TEST_JEV_KEY="abc";
    const cfg=structuredClone(DEFAULT_CONFIG.internal_models.jev);
    cfg.enabled=true;cfg.api_key_env="MACUS_TEST_JEV_KEY";cfg.base_url=`http://127.0.0.1:${port}/api/alpha/decisions`;
    const provider=new JevHttpDecisionProvider(cfg);
    const response=await provider.decide({stage:"test"},questionsFor("failure_triage"));
    expect(captured.url).toBe("/api/alpha/decisions");
    expect(captured.auth).toBe("Bearer abc");
    expect(captured.body.model).toBe("typesafe/jev-1.13");
    expect(captured.body.state).toEqual({stage:"test"});
    expect(captured.body.questions.failure_type.type).toBe("choice");
    expect(response.model).toBe("typesafe/jev-1.13-20260917");
    delete process.env.MACUS_TEST_JEV_KEY;await new Promise<void>(r=>server.close(()=>r()));
  });
});
