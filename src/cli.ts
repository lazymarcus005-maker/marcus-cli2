#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin as input, stdout as output, stderr as errorOutput } from "node:process";
import { loadConfig } from "./config.js";
import { CliApplication } from "./cli/application.js";
import { CliCommandRegistry } from "./cli/registry.js";

interface ParsedArgs {
  help: boolean;
  json: boolean;
  configPath?: string;
  resumeId?: string;
  authorize?: string;
  prompt: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const rest: string[] = [];
  const parsed: ParsedArgs = { help: false, json: false, prompt: "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { parsed.help = true; continue; }
    if (arg === "--json") { parsed.json = true; continue; }
    if (arg === "--config") { if (!argv[i + 1]) throw new Error("--config requires a path"); parsed.configPath = argv[++i]; continue; }
    if (arg === "--resume") { if (!argv[i + 1]) throw new Error("--resume requires a session ID"); parsed.resumeId = argv[++i]; continue; }
    if (arg === "--authorize") { if (!argv[i + 1]) throw new Error("--authorize requires edits|shell|all"); parsed.authorize = argv[++i]; continue; }
    rest.push(arg);
  }
  parsed.prompt = rest.join(" ").trim();
  return parsed;
}

function errorExitCode(error: unknown): number {
  const text = error instanceof Error ? error.message : String(error);
  if (/authorization|require.*authorize|requires explicit user authorization|shell execution requires/i.test(text)) return 2;
  if (/recovery|correlation|checkpoint.*mismatch|unknown_external_effect/i.test(text)) return 4;
  if (/context|model.*limit|run limit|duration exceeded/i.test(text)) return 5;
  return 1;
}

function printHelp(): void {
  const registry = new CliCommandRegistry();
  for (const [name, usage, description] of [
    ["/help", "/help", "Show help"],
    ["/status", "/status [--json]", "Show session/model/repository status"],
    ["/model", "/model [alias]", "Show or switch trusted model alias"],
    ["/models", "/models", "List trusted model aliases"],
    ["/settings", "/settings", "Show resolved settings with secrets redacted"],
    ["/resume", "/resume <id>", "Resume a durable session"],
    ["/clear", "/clear", "Start a new durable session"],
    ["/compact", "/compact", "Run Pi manual compaction"],
    ["/context", "/context [files] [--json]", "Show request context"],
    ["/tasks", "/tasks [--json]", "Show durable tasks"],
    ["/decisions", "/decisions [n]", "Show Jev shadow decisions"],
    ["/metrics", "/metrics [--json]", "Show local runtime metrics"],
    ["/trust", "/trust status|diff|refresh", "Inspect or explicitly refresh trusted test baseline"],
    ["/diff", "/diff", "Show bounded Git status/review evidence"],
    ["/checkpoint", "/checkpoint [create|list|select <id>]", "Manage state checkpoints"],
    ["/authorize", "/authorize edits|shell|all", "Authorize effectful operations"],
    ["/review", "/review [--json]", "Show Changed/Tested/Risk/Unresolved review"],
    ["/exit", "/exit", "Exit"],
  ] as string[][]) registry.register({ name, usage, description, execute: async () => {} });
  output.write(registry.help() + "\n");
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) { printHelp(); return; }

  const root = process.cwd();
  const startupStarted = performance.now();
  const { config } = await loadConfig(root, parsed.configPath);
  const app = await CliApplication.open(root, config);
  let rl: readline.Interface | undefined;
  try {
    await app.initialize(parsed.resumeId, parsed.authorize);
    app.recordStartupMetric(startupStarted);

    const runPrompt = async (text: string) => {
      const result = await app.runPrompt(text, parsed.json ? undefined : chunk => output.write(chunk));
      if (result.error && !parsed.json) errorOutput.write("macus: " + (result.error instanceof Error ? result.error.message : String(result.error)) + "\n");
      if (result.ok && !parsed.json && !text.endsWith("\n")) output.write("\n");
      return result;
    };

    if (parsed.prompt) {
      const result = await runPrompt(parsed.prompt);
      if (parsed.json) {
        output.write(JSON.stringify(await app.buildJsonEnvelope(result), null, 2) + "\n");
      }
      process.exitCode = result.ok ? await app.verificationExitCode(result.runId) : errorExitCode(result.error);
      return;
    }

    if (parsed.json) {
      output.write(JSON.stringify(await app.statusObject(), null, 2) + "\n");
      return;
    }

    rl = readline.createInterface({ input, output });
    output.write(app.helpText + "\n");
    while (true) {
      let line: string;
      try { line = (await rl.question("macus> ")).trim(); }
      catch (error: any) {
        if (error?.code === "ERR_USE_AFTER_CLOSE" || error?.code === "ABORT_ERR") break;
        throw error;
      }
      if (!line) continue;
      if (!line.startsWith("/")) { await runPrompt(line); continue; }
      const [commandName, ...rawArgs] = line.split(/\s+/);
      if (commandName === "/exit") break;
      const json = rawArgs.includes("--json");
      const args = rawArgs.filter(arg => arg !== "--json");
      const emit = (value: unknown, forceJson = false) => {
        if (forceJson || json) output.write(JSON.stringify(value, null, 2) + "\n");
        else output.write(String(value) + "\n");
      };
      try {
        await app.executeCommand(commandName, args, json, {
          print: value => emit(value),
          printJson: value => emit(value, true),
          printText: value => emit(value),
          confirm: async question => {
            const answer = (await rl!.question(question + " [y/N] ")).trim().toLowerCase();
            return answer === "y" || answer === "yes";
          },
        });
      } catch (error) {
        errorOutput.write("macus: " + (error instanceof Error ? error.message : String(error)) + "\n");
      }
    }
  } finally {
    rl?.close();
    await app.dispose();
  }
}

const startupJson = process.argv.includes("--json");
main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  if (startupJson) {
    output.write(JSON.stringify({ sessionId: null, runId: null, status: "failed", result: "", tasks: [], evidence: [], remainingRisk: [], error: message }, null, 2) + "\n");
    errorOutput.write("macus: " + message + "\n");
  } else errorOutput.write("macus: " + (error instanceof Error ? error.stack ?? error.message : String(error)) + "\n");
  process.exitCode = errorExitCode(error);
});
