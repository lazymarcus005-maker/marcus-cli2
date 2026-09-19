import { gitState, gitDiff, repositoryIdentity } from "./repository.js";
import { StateStore } from "./storage/state.js";
import { snapshotDigest } from "./testing/evidence.js";

export async function buildReview(root:string,store:StateStore,sessionId:string,includeGitContext=true){
  const started=performance.now();
  const [git,repoIdentity]=await Promise.all([gitState(root),repositoryIdentity(root)]);
  const diff=includeGitContext&&git.isGit?await gitDiff(root):undefined;
  const tasks=store.listTasks(sessionId);
  const evidence=store.listEvidence(sessionId);
  const currentSnapshot=evidence.length?await snapshotDigest(root):undefined;
  const tested=evidence.map(e=>{
    const detail=e.payload??{};
    const identityFresh=detail.repoIdentity===repoIdentity&&detail.head===git.head;
    return {
      id:e.id,
      status:e.status,
      snapshotDigest:e.snapshotDigest,
      fresh:currentSnapshot===e.snapshotDigest&&identityFresh,
      identityFresh,
      detail
    };
  });

  const agentPaths=[...new Set(store.completedWorkspaceEditPayloads(sessionId).flatMap(payload=>payload?.path?[String(payload.path)]:[]))];

  const risks:string[]=[];
  const latest=tested[0];
  if(!latest) risks.push("No structured test evidence recorded for this session.");
  else if(latest.status!=="passed"||!latest.fresh) risks.push("Latest test evidence is failed, unknown, incomplete, stale, or belongs to a different repository/HEAD snapshot.");

  const evidenceById=new Map(tested.map(e=>[e.id,e]));
  for(const task of tasks.filter(t=>t.status==="completed")){
    if(!task.evidenceIds.length){
      risks.push(`Completed task ${task.id} has no linked test/build evidence.`);
      continue;
    }
    const linked=task.evidenceIds.map(id=>evidenceById.get(id)).filter(Boolean) as typeof tested;
    if(!linked.some(e=>e.status==="passed"&&e.fresh)){
      risks.push(`Completed task ${task.id} has no fresh passing linked evidence.`);
    }
  }
  if(tasks.some(t=>t.status!=="completed"&&t.status!=="skipped")) risks.push("Not all durable tasks are completed or skipped.");

  const result={
    Changed:{repository:git,diff:diff??null,attribution:{agentPaths,otherDirtyPaths:"See repository status; unmatched changes are pre-existing or external/unknown."}},
    Tested:tested,
    TaskEvidence:tasks.map(t=>({id:t.id,status:t.status,evidenceIds:t.evidenceIds})),
    RemainingRisk:[...new Set(risks)],
    UnresolvedIssue:tasks.filter(t=>t.status==="blocked").map(t=>({id:t.id,title:t.title}))
  };
  store.recordMetric({sessionId,name:"review.duration_ms",value:performance.now()-started});
  return result;
}
