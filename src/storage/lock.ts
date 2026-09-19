import path from "node:path";
import { open } from "node:fs/promises";
import lockfile from "proper-lockfile";
import { ensureDir } from "../utils.js";

export async function acquireMutationLock(root: string): Promise<() => Promise<void>> {
  const dir = path.join(root, ".macus", "state");
  await ensureDir(dir);
  const target = path.join(dir, "mutation.lock-target");
  const handle = await open(target, "a");
  await handle.close();
  const release = await lockfile.lock(target, { realpath: false, retries: 0 });
  return async () => { await release(); };
}
