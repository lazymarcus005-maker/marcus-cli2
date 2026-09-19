import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export async function fileHash(filePath: string): Promise<string | null> {
  try {
    return sha256(await readFile(filePath));
  } catch {
    return null;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export function normalizePath(root: string, input: string): string {
  const resolved = path.resolve(root, input);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${input}`);
  }
  return resolved;
}

export function stripAnsiAndControls(input: string): string {
  return input
    .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function nowIso(): string {
  return new Date().toISOString();
}
