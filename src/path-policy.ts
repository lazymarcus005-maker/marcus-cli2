import path from "node:path";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import ignore, { type Ignore } from "ignore";

const DENIED_DIRS = new Set([".git", ".macus", "node_modules", "dist", "build", "coverage", ".next", "bin", "obj"]);
const SAFE_ENV_TEMPLATES = new Set([".env.example", ".env.sample", ".env.template", ".env.defaults"]);

function slash(value: string): string {
  return value.split(path.sep).join("/");
}

function knownSecret(relPath: string): boolean {
  const rel = slash(relPath).replace(/^\.\//, "");
  const base = path.posix.basename(rel);
  if (SAFE_ENV_TEMPLATES.has(base)) return false;
  if (/^\.env(?:\..+)?$/i.test(base)) return true;
  if (/^(?:\.npmrc|\.pypirc|\.netrc|\.git-credentials)$/i.test(base)) return true;
  if (/^(?:id_rsa|id_ed25519|id_ecdsa)(?:\..*)?$/i.test(base)) return true;
  if (/\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(base)) return true;
  if (/^(?:credentials|secrets?)\.json$/i.test(base)) return true;
  if (/^service[-_.]?account.*\.json$/i.test(base)) return true;
  return [
    ".aws/credentials",
    ".docker/config.json",
    ".config/gcloud/application_default_credentials.json",
  ].some(x => rel === x || rel.endsWith("/" + x));
}

export class PathPolicy {
  readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  isDeniedRelative(relPath: string): boolean {
    const normalized = slash(relPath).replace(/^\.\//, "");
    if (!normalized || normalized === ".") return false;
    const parts = normalized.split("/");
    if (parts.some(part => DENIED_DIRS.has(part))) return true;
    return knownSecret(normalized);
  }

  assertAllowedRelative(relPath: string): void {
    if (this.isDeniedRelative(relPath)) throw new Error(`Path is denied by repository policy: ${relPath}`);
  }

  lexical(input: string): string {
    const resolved = path.resolve(this.root, input);
    const rel = path.relative(this.root, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Path escapes workspace: ${input}`);
    this.assertAllowedRelative(rel);
    return resolved;
  }

  async resolveReadable(input: string): Promise<{ absolute: string; relative: string }> {
    const lexical = this.lexical(input);
    const [canonicalRoot, canonical] = await Promise.all([realpath(this.root), realpath(lexical)]);
    const rel = path.relative(canonicalRoot, canonical);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Symlink escapes workspace: ${input}`);
    this.assertAllowedRelative(rel);
    return { absolute: canonical, relative: rel };
  }

  async resolveSearchTarget(input = "."): Promise<{ absolute: string; relative: string }> {
    return this.resolveReadable(input);
  }

  ripgrepExcludes(): string[] {
    return [
      "!.git/**", "!.macus/**", "!node_modules/**", "!dist/**", "!build/**", "!coverage/**", "!.next/**", "!bin/**", "!obj/**",
      "!.env", "!.env.local", "!.env.production", "!.env.development", "!.env.test", "!.env.staging", "!.env.*.local",
      "!*.pem", "!*.key", "!*.p12", "!*.pfx", "!*.jks", "!*.keystore",
      "!id_rsa*", "!id_ed25519*", "!id_ecdsa*", "!.npmrc", "!.pypirc", "!.netrc", "!.git-credentials",
      "!.aws/credentials", "!.docker/config.json", "!.config/gcloud/application_default_credentials.json",
      "!credentials.json", "!secrets.json", "!secret.json", "!service-account*.json", "!service_account*.json",
    ];
  }

  gitExcludePathspecs(): string[] {
    const patterns = [
      ".git/**", ".macus/**", "node_modules/**", "dist/**", "build/**", "coverage/**", ".next/**", "bin/**", "obj/**",
      "**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx", "**/*.jks", "**/*.keystore",
      "**/id_rsa*", "**/id_ed25519*", "**/id_ecdsa*", "**/.npmrc", "**/.pypirc", "**/.netrc", "**/.git-credentials",
      "**/.aws/credentials", "**/.docker/config.json", "**/.config/gcloud/application_default_credentials.json",
      "**/credentials.json", "**/secrets.json", "**/secret.json", "**/service-account*.json", "**/service_account*.json",
    ];
    return patterns.map(pattern => `:(exclude,glob)${pattern}`);
  }

  async ignoreMatcher(): Promise<Ignore> {
    const ig = ignore();
    for (const name of [".gitignore", ".macusignore"]) {
      try { ig.add(await readFile(path.join(this.root, name), "utf8")); } catch {}
    }
    ig.add([...DENIED_DIRS].map(x => x + "/"));
    return ig;
  }

  async sourceGeneration(target = "."): Promise<string> {
    const { absolute } = await this.resolveSearchTarget(target);
    const canonicalRoot = await realpath(this.root);
    const ig = await this.ignoreMatcher();
    const hash = createHash("sha256");
    const walk = async (dir: string): Promise<void> => {
      const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(canonicalRoot, full);
        const key = slash(rel);
        if (this.isDeniedRelative(rel)) continue;
        if (ig.ignores(entry.isDirectory() ? key + "/" : key)) continue;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          hash.update(key);
          for await (const chunk of createReadStream(full)) hash.update(chunk as Buffer);
        }
      }
    };
    const st = await lstat(absolute);
    if (st.isDirectory()) await walk(absolute);
    else {
      const rel = path.relative(canonicalRoot, absolute);
      hash.update(slash(rel));
      for await (const chunk of createReadStream(absolute)) hash.update(chunk as Buffer);
    }
    return hash.digest("hex");
  }
}
