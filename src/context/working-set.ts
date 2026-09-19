import type { SourceFragment } from "../types.js";

export type WorkingStatus = "ACTIVE" | "RELATED" | "DISCOVERED" | "STALE";
export interface WorkingEntry {
  path: string; sourceHash: string; symbols: string[]; lastAccess: number;
  reason: string; status: WorkingStatus; tier: "HOT"|"WARM"|"COLD";
}

export class WorkingSet {
  private entries = new Map<string, WorkingEntry>();
  constructor(private readonly maxItems = 200) {}
  upsert(entry: WorkingEntry): void {
    this.entries.set(entry.path, entry);
    if (this.entries.size > this.maxItems) {
      const oldest = [...this.entries.values()].sort((a,b)=>a.lastAccess-b.lastAccess)[0];
      if (oldest) this.entries.delete(oldest.path);
    }
  }
  get(path:string): WorkingEntry|undefined { return this.entries.get(path); }
  markStale(path:string): void { const e=this.entries.get(path); if(e) e.status="STALE"; }
  list(): WorkingEntry[] { return [...this.entries.values()].sort((a,b)=>b.lastAccess-a.lastAccess); }
}

export function selectFragments(candidates: SourceFragment[], maxTokens: number): { included: SourceFragment[]; omitted: Array<{fragmentId:string;reason:string}> } {
  const fresh = candidates.filter(c => c.freshness === "verified");
  const tier = { HOT:3, WARM:2, COLD:1 };
  fresh.sort((a,b) => (tier[b.tier]-tier[a.tier]) || (b.score-a.score) || a.source.localeCompare(b.source) || a.startLine-b.startLine || a.fragmentId.localeCompare(b.fragmentId));
  const exact = new Set<string>();
  const selectedRanges = new Map<string,Array<{start:number;end:number}>>();
  const included:SourceFragment[] = [];
  const omitted:Array<{fragmentId:string;reason:string}> = [];
  let used=0;

  for(const c of fresh){
    const key = `${c.source}:${c.startLine}:${c.endLine}:${c.contentHash}`;
    if(exact.has(key)){ omitted.push({fragmentId:c.fragmentId,reason:"duplicate"}); continue; }
    exact.add(key);

    const rangeKey=`${c.source}:${c.contentHash}`;
    const ranges=selectedRanges.get(rangeKey)??[];
    if(ranges.some(r=>c.startLine<=r.end&&c.endLine>=r.start)){
      omitted.push({fragmentId:c.fragmentId,reason:"overlap"});
      continue;
    }
    if(used+c.estimatedTokens>maxTokens){ omitted.push({fragmentId:c.fragmentId,reason:"budget"}); continue; }

    included.push(c);
    used+=c.estimatedTokens;
    ranges.push({start:c.startLine,end:c.endLine});
    selectedRanges.set(rangeKey,ranges);
  }
  for(const c of candidates.filter(c=>c.freshness!=="verified")) omitted.push({fragmentId:c.fragmentId,reason:"stale_or_unknown"});
  return {included,omitted};
}
