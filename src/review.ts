import { gitState, gitDiff } from "./repository.js";
import { StateStore } from "./storage/state.js";
import { assessVerification } from "./verification/assessment.js";

export async function buildReview(root:string,store:StateStore,sessionId:string,includeGitContext=true){
  const started=performance.now();
  const git=await gitState(root);
  const diff=includeGitContext&&git.isGit?await gitDiff(root):undefined;
  const assessment=await assessVerification(root,store,sessionId);

  const agentPaths=[...new Set(store.completedWorkspaceEditPayloads(sessionId).flatMap(payload=>payload?.path?[String(payload.path)]:[]))];

  const result={
    Changed:{repository:git,diff:diff??null,attribution:{agentPaths,otherDirtyPaths:"See repository status; unmatched changes are pre-existing or external/unknown."}},
    Tested:assessment.tested,
    TaskEvidence:assessment.taskEvidence.map(({verified:_,...task})=>task),
    RemainingRisk:assessment.remainingRisk,
    UnresolvedIssue:assessment.unresolvedIssue,
  };
  store.recordMetric({sessionId,name:"review.duration_ms",value:performance.now()-started});
  return result;
}
