import fs from "node:fs";
import path from "node:path";
import type {
  AgentRunLog,
  BenchConfig,
  Check,
  CheckResult,
  ProbeResult,
  Scenario,
  ScenarioResult,
  Target,
} from "./types.js";
import { prepareWorkspace, substitute } from "./workspace.js";
import { runAgentTurn } from "./opencode.js";
import { runRuleCheck } from "./checks/rules.js";
import { runLlmCheck } from "./checks/judge.js";

export interface RunOptions {
  config: BenchConfig;
  target: Target;
  runDir: string;
  useLlmJudge: boolean;
  log: (msg: string) => void;
}

function scoreOf(checks: CheckResult[]): number | null {
  const scored = checks.filter((c) => c.passed !== null);
  if (scored.length === 0) return null;
  const total = scored.reduce((s, c) => s + (c.check.weight ?? 1), 0);
  const earned = scored.reduce((s, c) => s + (c.passed ? (c.check.weight ?? 1) : 0), 0);
  return total === 0 ? null : earned / total;
}

async function evaluateChecks(
  checks: Check[],
  probePrompt: string,
  output: string,
  workspaceDir: string,
  opts: RunOptions,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    if (check.type === "llm") {
      if (!opts.useLlmJudge) {
        results.push({ check, passed: null, detail: "已停用 LLM judge（--no-llm）" });
      } else {
        results.push(
          await runLlmCheck(check, probePrompt, output, {
            model: opts.config.judgeModel,
            maxTokens: opts.config.judgeMaxTokens,
          }),
        );
      }
    } else {
      results.push(runRuleCheck(check, output, workspaceDir));
    }
  }
  return results;
}

export async function runScenario(scenario: Scenario, opts: RunOptions): Promise<ScenarioResult> {
  const base = path.join(opts.runDir, "scenarios", scenario.id);
  const memoryDir = path.join(base, "memory");
  const workspaceDir = path.join(base, "workspace");
  const logs: AgentRunLog[] = [];

  prepareWorkspace(workspaceDir, scenario, opts.target, memoryDir);
  const env = substitute(opts.target.env ?? {}, { memoryDir, workspaceDir });

  const invoke = (cwd: string, prompt: string, continueSession: boolean) =>
    runAgentTurn(
      {
        command: opts.config.command,
        model: opts.config.model,
        cwd,
        env,
        timeoutMs: opts.config.timeoutMs,
        continueSession,
      },
      prompt,
    );

  // 1. 植入記憶：依序執行每個 session；session 內第 2 輪起用 --continue
  for (let s = 0; s < scenario.sessions.length; s++) {
    const session = scenario.sessions[s];
    for (let t = 0; t < session.prompts.length; t++) {
      const prompt = session.prompts[t];
      opts.log(`  [ingest] session ${s + 1}/${scenario.sessions.length} turn ${t + 1}: ${prompt.slice(0, 50)}...`);
      const out = invoke(workspaceDir, prompt, t > 0);
      logs.push({ session: s, turn: t, kind: "ingest", prompt, ...out });
      if (out.exitCode !== 0) {
        opts.log(`  [warn] agent exit code ${out.exitCode}: ${out.stderr.slice(0, 200)}`);
      }
    }
  }

  // 2. Probes：每個 probe 開全新 session
  const probeResults: ProbeResult[] = [];
  for (const probe of scenario.probes) {
    let probeWorkspace = workspaceDir;
    if (probe.freshWorkspace) {
      probeWorkspace = path.join(base, `workspace-probe-${probe.id}`);
      prepareWorkspace(probeWorkspace, scenario, opts.target, memoryDir);
    }
    opts.log(`  [probe] ${probe.id}: ${probe.prompt.slice(0, 50)}...`);
    const out = invoke(probeWorkspace, probe.prompt, false);
    logs.push({ session: -1, turn: 0, kind: "probe", prompt: probe.prompt, ...out });

    const output = out.stdout + (out.stderr ? `\n[stderr]\n${out.stderr}` : "");
    const checks = await evaluateChecks(probe.checks, probe.prompt, out.stdout, probeWorkspace, opts);
    probeResults.push({
      probeId: probe.id,
      prompt: probe.prompt,
      output,
      checks,
      score: scoreOf(checks),
    });
  }

  const scored = probeResults.filter((p) => p.score !== null);
  const score = scored.length === 0 ? null : scored.reduce((s, p) => s + (p.score ?? 0), 0) / scored.length;

  // 保存 transcript 供除錯
  fs.writeFileSync(path.join(base, "transcript.json"), JSON.stringify(logs, null, 2), "utf8");

  return {
    id: scenario.id,
    name: scenario.name,
    category: scenario.category,
    memoryType: scenario.memoryType,
    domain: scenario.domain,
    probes: probeResults,
    score,
    logs,
  };
}
