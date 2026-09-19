import { describe,it,expect } from "vitest";
import { parseJUnitXml, parseTrxXml } from "../src/testing/evidence.js";

describe("structured test parsers",()=>{
  it("parses JUnit counters",()=>{
    const x='<testsuite tests="5" failures="1" errors="0" skipped="1"></testsuite>';
    expect(parseJUnitXml(x)).toEqual({total:5,passed:3,failed:1,skipped:1});
  });
  it("aggregates multiple JUnit suites and preserves failures",()=>{
    const x='<testsuites><testsuite name="a" tests="1" failures="0" errors="0" skipped="0"></testsuite><testsuite name="b" tests="2" failures="1" errors="0" skipped="0"></testsuite></testsuites>';
    expect(parseJUnitXml(x)).toEqual({total:3,passed:2,failed:1,skipped:0});
  });
  it("uses aggregate testsuites counters when present",()=>{
    const x='<testsuites tests="4" failures="1" errors="1" skipped="1"><testsuite name="a" tests="2" failures="0"></testsuite><testsuite name="b" tests="2" failures="1" errors="1" skipped="1"></testsuite></testsuites>';
    expect(parseJUnitXml(x)).toEqual({total:4,passed:1,failed:2,skipped:1});
  });
  it("parses TRX counters",()=>{
    const x='<Counters total="6" executed="6" passed="5" failed="1" error="0" notExecuted="0" inconclusive="0" />';
    expect(parseTrxXml(x)).toEqual({total:6,passed:5,failed:1,skipped:0});
  });  it("rejects inconsistent JUnit aggregate and child counters",()=>{
    const x='<testsuites tests="2" failures="0" errors="0" skipped="0"><testsuite name="a" tests="2" failures="1" errors="0" skipped="0"></testsuite></testsuites>';
    expect(parseJUnitXml(x)).toBeNull();
  });
  it("rejects inconsistent TRX counters",()=>{
    const x='<Counters total="2" executed="2" passed="2" failed="1" error="0" notExecuted="0" inconclusive="0" />';
    expect(parseTrxXml(x)).toBeNull();
  });

});
