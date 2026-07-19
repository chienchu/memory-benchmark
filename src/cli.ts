import fs from "node:fs";
import path from "node:path";
import { loadScenarios, loadTarget } from "./scenario.js";
import { runScenario } from "./runner.js";
import { writeReport } from "./report.js";
import type { BenchConfig, BenchResult, ScenarioResult } from "./types.js";

interface CliArgs {
  target: string;
  scenariosDir: string;
  outDir: string;
  filter?: string;
  model?: string;
  judgeModel?: string;
  agentCmd?: string;
  noLlm: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    target: "targets/none",
    scenariosDir: "scenarios",
    outDir: "results",
    noLlm: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} 需要一個值`);
      return v;
    };
    switch (a) {
      case "--target": args.target = next(); break;
      case "--scenarios": args.scenariosDir = next(); break;
      case "--out": args.outDir = next(); break;
      case "--filter": args.filter = next(); break;
      case "--model": args.model = next(); break;
      case "--judge-model": args.judgeModel = next(); break;
      case "--agent-cmd": args.agentCmd = next(); break;
      case "--no-llm": args.noLlm = true; break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`未知參數：${a}（--help 查看用法）`);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`用法: npm run bench -- [options]

選項:
  --target <dir>       受測 memory system 目錄（預設 targets/none）
  --scenarios <dir>    scenario 目錄（預設 scenarios）
  --out <dir>          輸出目錄（預設 results）
  --filter <substr>    只跑 id 包含此字串的 scenario
  --model <p/m>        傳給 opencode --model 的模型，例如 anthropic/claude-sonnet-4-5
  --judge-model <m>    LLM judge 使用的 Anthropic 模型（預設 claude-opus-4-8）
  --agent-cmd "<cmd>"  覆寫 agent 指令（預設 opencode；煙霧測試用 "node test/mock-agent.mjs"）
  --no-llm             跳過 LLM judge 檢查（不需 ANTHROPIC_API_KEY）

範例:
  npm run bench -- --target targets/mcp-memory --model anthropic/claude-sonnet-4-5
  npm run smoke   # 用 mock agent 驗證整條 pipeline`);
}

function buildConfig(args: CliArgs): BenchConfig {
  let command = ["opencode"];
  if (args.agentCmd) {
    command = args.agentCmd.split(/\s+/).map((tok) => (fs.existsSync(tok) ? path.resolve(tok) : tok));
  }
  return {
    command,
    model: args.model,
    timeoutMs: 300_000,
    judgeModel: args.judgeModel ?? "claude-opus-4-8",
    judgeMaxTokens: 1024,
  };
}

function mean(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = buildConfig(args);
  const target = loadTarget(args.target);
  const scenarios = loadScenarios(args.scenariosDir, args.filter);
  if (scenarios.length === 0) {
    console.error("沒有符合條件的 scenario");
    process.exit(1);
  }

  const useLlmJudge = !args.noLlm;
  if (useLlmJudge && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("[warn] 未偵測到 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN，LLM judge 可能會失敗。可用 --no-llm 跳過。");
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.resolve(args.outDir, `${stamp}-${target.name}`);
  fs.mkdirSync(runDir, { recursive: true });

  console.log(`Target: ${target.name}${target.description ? ` — ${target.description}` : ""}`);
  console.log(`Agent 指令: ${config.command.join(" ")}${config.model ? ` (--model ${config.model})` : ""}`);
  console.log(`Scenarios: ${scenarios.map((s) => s.id).join(", ")}`);
  console.log(`輸出: ${runDir}\n`);

  const startedAt = new Date().toISOString();
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    console.log(`▶ ${scenario.id} (${scenario.category})`);
    try {
      const r = await runScenario(scenario, {
        config,
        target,
        runDir,
        useLlmJudge,
        log: (m) => console.log(m),
      });
      console.log(`  分數: ${r.score === null ? "n/a" : (r.score * 100).toFixed(1) + "%"}\n`);
      results.push(r);
    } catch (err) {
      const message = (err as Error).message;
      console.error(`  scenario 執行失敗：${message}\n`);
      results.push({
        id: scenario.id,
        name: scenario.name,
        category: scenario.category,
        memoryType: scenario.memoryType,
        domain: scenario.domain,
        probes: [],
        score: null,
        error: message,
        logs: [],
      });
    }
  }
  const finishedAt = new Date().toISOString();

  const groupBy = (key: (r: ScenarioResult) => string): Record<string, number | null> => {
    const out: Record<string, number | null> = {};
    for (const k of [...new Set(results.map(key))]) {
      out[k] = mean(results.filter((r) => key(r) === k).map((r) => r.score));
    }
    return out;
  };

  const bench: BenchResult = {
    target: target.name,
    model: config.model,
    judgeModel: config.judgeModel,
    startedAt,
    finishedAt,
    scenarios: results,
    overall: mean(results.map((r) => r.score)),
    byMemoryType: groupBy((r) => r.memoryType),
    byCategory: groupBy((r) => r.category),
    byDomain: groupBy((r) => r.domain),
  };

  const { jsonPath, mdPath } = writeReport(bench, runDir);
  console.log(`總分: ${bench.overall === null ? "n/a" : (bench.overall * 100).toFixed(1) + "%"}`);
  console.log(`報告: ${mdPath}`);
  console.log(`原始資料: ${jsonPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
