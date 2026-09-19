import { renderContext, renderMetrics, renderReview, renderStatus, renderTasks, renderTrustDiff, renderTrustStatus } from "./render.js";
import type { CliCommandContext, CliCommandRegistry } from "./registry.js";

export interface CliApplicationActions {
  readonly activeModelAlias: string;
  readonly modelAliases: string[];
  authorize(scope: string): string;
  statusObject(): Promise<unknown>;
  settings(): Promise<unknown>;
  context(filesOnly: boolean): Promise<unknown>;
  tasks(): unknown[];
  decisions(limit: number): unknown;
  metrics(): unknown;
  diff(): Promise<unknown>;
  review(): Promise<unknown>;
  switchModel(alias: string): Promise<void>;
  compact(): Promise<void>;
  checkpointList(): Promise<unknown[]>;
  createCheckpoint(): Promise<string>;
  restoreCheckpoint(checkpointId: string): Promise<unknown>;
  clear(): Promise<string>;
  resume(sessionId: string): Promise<unknown>;
  trustStatus(): unknown;
  refreshTrust(): unknown;
}

function add(
  registry: CliCommandRegistry,
  name: string,
  usage: string,
  description: string,
  execute: (ctx: CliCommandContext) => Promise<void>,
): void {
  registry.register({ name, usage, description, execute });
}

export function registerDefaultCommands(registry: CliCommandRegistry, app: CliApplicationActions): void {
  add(registry, "/help", "/help", "Show help", async ctx => ctx.printText(registry.help()));
  add(registry, "/exit", "/exit", "Exit", async () => {});

  add(registry, "/authorize", "/authorize edits|shell|all", "Authorize effectful operations", async ctx => {
    ctx.printText(app.authorize(ctx.args[0] ?? ""));
  });

  add(registry, "/status", "/status [--json]", "Show session/model/repository status", async ctx => {
    const value = await app.statusObject();
    if (ctx.json) ctx.printJson(value); else ctx.printText(renderStatus(value));
  });

  add(registry, "/model", "/model [alias]", "Show or switch trusted model alias", async ctx => {
    const next = ctx.args[0];
    if (!next) { ctx.printText(app.activeModelAlias); return; }
    await app.switchModel(next);
    ctx.printText("Model: " + next);
  });

  add(registry, "/models", "/models", "List trusted model aliases", async ctx => {
    ctx.printText(app.modelAliases.join("\n") || "(none configured)");
  });

  add(registry, "/settings", "/settings", "Show resolved settings with secrets redacted", async ctx => {
    ctx.printJson(await app.settings());
  });

  add(registry, "/context", "/context [files] [--json]", "Show request context", async ctx => {
    const value = await app.context(ctx.args[0] === "files");
    if (ctx.args[0] === "files" || ctx.json) ctx.printJson(value);
    else ctx.printText(renderContext(value));
  });

  add(registry, "/tasks", "/tasks [--json]", "Show durable tasks", async ctx => {
    const tasks = app.tasks();
    if (ctx.json) ctx.printJson(tasks); else ctx.printText(renderTasks(tasks));
  });

  add(registry, "/decisions", "/decisions [n]", "Show Jev shadow decisions", async ctx => {
    ctx.printJson(app.decisions(Number(ctx.args[0] ?? 20)));
  });

  add(registry, "/metrics", "/metrics [--json]", "Show local runtime metrics", async ctx => {
    const metrics = app.metrics() as Record<string, {count:number;avg:number;min:number;max:number}>;
    if (ctx.json) ctx.printJson(metrics); else ctx.printText(renderMetrics(metrics));
  });

  add(registry, "/diff", "/diff", "Show bounded Git status/review evidence", async ctx => {
    ctx.printJson(await app.diff());
  });

  add(registry, "/review", "/review [--json]", "Show Changed/Tested/Risk/Unresolved review", async ctx => {
    const review = await app.review();
    if (ctx.json) ctx.printJson(review); else ctx.printText(renderReview(review));
  });

  add(registry, "/compact", "/compact", "Run Pi manual compaction", async ctx => {
    await app.compact();
    ctx.printText("Compaction completed.");
  });

  add(registry, "/checkpoint", "/checkpoint [create|list|select <id>]", "Manage state checkpoints", async ctx => {
    const action = ctx.args[0] ?? "create";
    if (action === "list") { ctx.printJson(await app.checkpointList()); return; }
    if (action === "select") {
      const checkpointId = ctx.args[1];
      if (!checkpointId) throw new Error("Usage: /checkpoint select <id>");
      ctx.printJson(await app.restoreCheckpoint(checkpointId));
      return;
    }
    if (action !== "create") throw new Error("Usage: /checkpoint [create|list|select <id>]");
    ctx.printText(await app.createCheckpoint());
  });

  add(registry, "/clear", "/clear", "Start a new durable session", async ctx => {
    ctx.printText("New session: " + await app.clear());
  });

  add(registry, "/resume", "/resume <id>", "Resume a durable session", async ctx => {
    const sessionId = ctx.args[0];
    if (!sessionId) throw new Error("Usage: /resume <sessionId>");
    ctx.printJson({ sessionId, ...await app.resume(sessionId) as object });
  });

  add(registry, "/trust", "/trust status|diff|refresh", "Inspect or explicitly refresh trusted test baseline", async ctx => {
    const action = ctx.args[0] ?? "status";
    const status = app.trustStatus() as Record<string, unknown>;
    if (action === "status") { if (ctx.json) ctx.printJson(status); else ctx.printText(renderTrustStatus(status)); return; }
    if (action === "diff") {
      if (ctx.json) ctx.printJson({ changedSources: status.changedSources, addedCommands: status.addedCommands, removedCommands: status.removedCommands, unchangedCommands: status.unchangedCommands });
      else ctx.printText(renderTrustDiff(status));
      return;
    }
    if (action !== "refresh") throw new Error("Usage: /trust status|diff|refresh");
    if (ctx.json) throw new Error("/trust refresh requires an explicit interactive user confirmation");
    if (!(await ctx.confirm("Refresh trusted command baseline for this session?"))) { ctx.printText("Trust refresh cancelled."); return; }
    const result = app.refreshTrust() as {commands:string[]};
    ctx.printText(`Trust baseline refreshed. ${result.commands.length} trusted commands.`);
  });
}
