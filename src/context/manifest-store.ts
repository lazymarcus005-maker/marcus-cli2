import path from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import type { RequestManifest } from "../types.js";
import { ensureDir, exists } from "../utils.js";

export class ManifestStore {
  readonly file:string;
  constructor(root:string,sessionId:string){this.file=path.join(root,".macus","state",sessionId+"-last-request.json");}
  async save(m:RequestManifest){await ensureDir(path.dirname(this.file));await writeFile(this.file,JSON.stringify(m,null,2),"utf8");}
  async load():Promise<RequestManifest|undefined>{if(!(await exists(this.file)))return undefined;return JSON.parse(await readFile(this.file,"utf8"));}
}
