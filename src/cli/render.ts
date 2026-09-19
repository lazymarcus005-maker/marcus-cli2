function bool(v:boolean):string{return v?"yes":"no";}

export function renderStatus(value:any):string{
  const repo=value.repository??{};
  const lines=[
    "Macus Code",
    "",
    `Session   ${value.sessionId??"(none)"}`,
    `Model     ${value.model??"(not configured)"}`,
    `Branch    ${repo.branch??"(not git)"}`,
    `HEAD      ${repo.head??"(none)"}`,
    `Run       ${value.run??"idle"}`,
    `Context   ${value.context?`${value.context.estimatedPromptTokens??0} / ${value.context.contextWindow??0} tokens`:"(no request yet)"}`,
    `Lock      ${value.mutationLock?"mutation":"read-only"}`,
    `Auth      edits=${bool(Boolean(value.authorization?.edits))} shell=${bool(Boolean(value.authorization?.shell))}`,
    `Tasks     ${value.tasks?`${value.tasks.done}/${value.tasks.total} done${value.tasks.active?` · active ${value.tasks.active}`:""}`:"0/0 done"}`,
    `Evidence  ${value.evidence?.status?`${value.evidence.status}${value.evidence.fresh===false?" (stale)":""}`:"none"}`,
    `Unknown   ${value.unknownExecutions??0} executions`,
  ];
  if(value.jev)lines.push(`Jev       ${value.jev.enabled?`${value.jev.mode} / ${value.jev.model}`:"off"}`);
  return lines.join("\n");
}

export function renderTasks(tasks:any[]):string{
  if(!tasks.length)return "Tasks\n  (none)";
  const icon=(s:string)=>s==="completed"?"✓":s==="in_progress"?"●":s==="blocked"?"!":s==="skipped"?"-":"○";
  return ["Tasks",...tasks.map(t=>`  ${icon(t.status)} ${t.id}  ${t.title} [${t.status}]`)].join("\n");
}

export function renderReview(review:any):string{
  const tested=Array.isArray(review?.Tested)?review.Tested:[];
  const tasks=Array.isArray(review?.TaskEvidence)?review.TaskEvidence:[];
  const risks=Array.isArray(review?.RemainingRisk)?review.RemainingRisk:[];
  const unresolved=Array.isArray(review?.UnresolvedIssue)?review.UnresolvedIssue:[];
  const lines=[
    "Review",
    "",
    `Changed   ${review?.Changed?.repository?.isGit?"git worktree":"non-git workspace"}`,
    `Evidence  ${tested.filter((x:any)=>x.status==="passed"&&x.fresh).length} fresh passing / ${tested.length} total`,
    `Tasks     ${tasks.filter((x:any)=>x.status==="completed"||x.status==="skipped").length}/${tasks.length} done`,
    "",
    "Risks",
    ...(risks.length?risks.map((x:any)=>`  - ${x}`):["  none"]),
  ];
  if(unresolved.length)lines.push("","Blocked",...unresolved.map((x:any)=>`  - ${x.id}: ${x.title}`));
  return lines.join("\n");
}

export function renderContext(manifest:any):string{
  if(!manifest)return "Context\n  No dispatched request manifest yet.";
  const lines=[
    "Context",
    `  Model      ${manifest.modelId}`,
    `  Prompt     ${manifest.estimatedPromptTokens} tokens`,
    `  Window     ${manifest.contextWindow}`,
    `  Included   ${manifest.includedFragments?.length??0} fragments`,
    `  Omitted    ${manifest.omissions?.length??0} fragments`,
  ];
  return lines.join("\n");
}

export function renderMetrics(metrics:Record<string,{count:number;avg:number;min:number;max:number}>):string{
  const entries=Object.entries(metrics);
  if(!entries.length)return "Metrics\n  (no samples)";
  return ["Metrics",...entries.map(([name,m])=>`  ${name.padEnd(28)} n=${m.count} avg=${m.avg.toFixed(2)} min=${m.min.toFixed(2)} max=${m.max.toFixed(2)}`)].join("\n");
}

export function renderTrustStatus(status:any):string{
  const changed=Boolean(status?.changed);
  const commands=Array.isArray(status?.commands)?status.commands:[];
  const lines=[
    "Trusted verification",
    `Baseline   ${changed?"changed":"unchanged"}`,
    `Commands   ${commands.length}`,
    ...commands.map((x:string)=>`  ${changed?"?":"✓"} ${x}`),
  ];
  if(status?.changedSources?.length)lines.push("","Changed sources",...status.changedSources.map((x:any)=>`  - ${x.path}`));
  if(status?.addedCommands?.length)lines.push("","Added commands",...status.addedCommands.map((x:string)=>`  + ${x}`));
  if(status?.removedCommands?.length)lines.push("","Removed commands",...status.removedCommands.map((x:string)=>`  - ${x}`));
  return lines.join("\n");
}

export function renderTrustDiff(diff:any):string{
  const lines=["Trust diff"];
  for(const x of diff?.changedSources??[])lines.push(`  source ${x.path}: changed`);
  for(const x of diff?.addedCommands??[])lines.push(`  + ${x}`);
  for(const x of diff?.removedCommands??[])lines.push(`  - ${x}`);
  if(lines.length===1)lines.push("  no changes");
  return lines.join("\n");
}
