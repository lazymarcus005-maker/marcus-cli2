import path from "node:path";
import { readFile } from "node:fs/promises";
import { exists, sha256 } from "./utils.js";

export interface InstructionSource {
  path: string;
  hash: string;
  scope: string;
  precedence: number;
  content: string;
}

const names = ["CLAUDE.md", "AGENTS.md", "MACUS.md"] as const;

export async function resolveInstructions(root: string, targetPath = root): Promise<InstructionSource[]> {
  const target = path.resolve(targetPath);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Instruction target escapes workspace");
  const dirs = [root];
  const parts = rel.split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    dirs.push(current);
  }
  const out: InstructionSource[] = [];
  for (let depth = 0; depth < dirs.length; depth++) {
    for (let i = 0; i < names.length; i++) {
      const file = path.join(dirs[depth], names[i]);
      if (!(await exists(file))) continue;
      const content = await readFile(file, "utf8");
      out.push({ path: file, hash: sha256(content), scope: dirs[depth], precedence: depth * 10 + i, content });
    }
  }
  return out.sort((a, b) => a.precedence - b.precedence);
}

export function renderInstructions(sources: InstructionSource[]): string {
  return sources.map(s => `### ${s.path}\n${s.content.trim()}`).join("\n\n");
}
