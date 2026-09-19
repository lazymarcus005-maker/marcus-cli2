import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import TS from "tree-sitter-typescript";
import CSharp from "tree-sitter-c-sharp";
import type { MacusConfig } from "../types.js";
import { sha256 } from "../utils.js";
import { PathPolicy } from "../path-policy.js";

export interface SymbolRecord {
  id: string; path: string; language: string; kind: string; name: string;
  qualifiedName: string; signature: string; startLine: number; endLine: number;
  sourceHash: string; coverage: "full" | "partial";
}

const interesting = new Set([
  "class_declaration","function_declaration","method_definition","interface_declaration","type_alias_declaration",
  "lexical_declaration","variable_declaration","enum_declaration","struct_declaration","record_declaration",
  "namespace_declaration","method_declaration","constructor_declaration","property_declaration"
]);

function languageFor(file: string): { name: string; grammar: any } | null {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".ts") return { name: "typescript", grammar: (TS as any).typescript };
  if (ext === ".tsx") return { name: "tsx", grammar: (TS as any).tsx };
  if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") return { name: "javascript", grammar: JavaScript as any };
  if (ext === ".cs") return { name: "csharp", grammar: CSharp as any };
  return null;
}

function nodeName(node: any, source: string): string {
  const named = ["name","identifier","type","declarator"].map(k => node.childForFieldName?.(k)).find(Boolean);
  if (named) return source.slice(named.startIndex, named.endIndex);
  const child = node.namedChildren?.find((n:any) => n.type === "identifier" || n.type.endsWith("_identifier"));
  return child ? source.slice(child.startIndex, child.endIndex) : "<anonymous>";
}

export async function parseSymbols(root: string, config: MacusConfig, inputPath: string): Promise<{ symbols: SymbolRecord[]; parseStatus: string; sourceHash: string }> {
  const policy=new PathPolicy(root);
  const {absolute:full,relative}=await policy.resolveReadable(inputPath);
  const info = await stat(full);
  const source = await readFile(full, "utf8");
  const hash = sha256(source);
  if (info.size > config.retrieval.max_parse_file_bytes) return { symbols: [], parseStatus: "oversized", sourceHash: hash };
  const spec = languageFor(full);
  if (!spec) return { symbols: [], parseStatus: "unsupported", sourceHash: hash };
  const parser = new Parser();
  parser.setLanguage(spec.grammar);
  const tree = parser.parse(source);
  const symbols: SymbolRecord[] = [];
  const visit = (node:any, parents:string[]) => {
    let next = parents;
    if (interesting.has(node.type)) {
      const name = nodeName(node, source);
      const qualifiedName = [...parents, name].filter(Boolean).join(".");
      const newline=source.indexOf("\n",node.startIndex);
      const firstLine = source.slice(node.startIndex, Math.min(node.endIndex, newline === -1 ? node.endIndex : newline)).trim();
      const symbolId = sha256([spec.name, relative, qualifiedName, node.type, node.startPosition.row, firstLine].join("|")).slice(0, 24);
      symbols.push({ id:symbolId, path:relative, language:spec.name, kind:node.type, name, qualifiedName, signature:firstLine, startLine:node.startPosition.row+1, endLine:node.endPosition.row+1, sourceHash:hash, coverage:tree.rootNode.hasError?"partial":"full" });
      next = [...parents, name];
    }
    for (const child of node.namedChildren ?? []) visit(child, next);
  };
  visit(tree.rootNode, []);
  return { symbols, parseStatus: tree.rootNode.hasError ? "partial" : "parsed", sourceHash: hash };
}

export async function readRange(root:string,inputPath:string,startLine:number,endLine:number,expectedHash?:string):Promise<{path:string;content:string;hash:string;startLine:number;endLine:number}>{
  const policy=new PathPolicy(root);
  const {absolute:full,relative}=await policy.resolveReadable(inputPath);
  const source=await readFile(full,"utf8");
  const hash=sha256(source);
  if(expectedHash&&hash!==expectedHash)throw new Error("Stale source hash");
  const lines=source.split(/\r?\n/);
  const start=Math.max(1,Math.floor(startLine)),end=Math.min(lines.length,Math.max(start,Math.floor(endLine)));
  return {path:relative,content:lines.slice(start-1,end).map((l,i)=>`${start+i}: ${l}`).join("\n"),hash,startLine:start,endLine:end};
}
