import fs from "node:fs";
import path from "node:path";
import type { BenchResult } from "./types.js";

function pct(n: number | null): string {
  return n === null ? "n/a" : `${(n * 100).toFixed(1)}%`;
}

export function writeReport(result: BenchResult, runDir: string): { jsonPath: string; mdPath: string } {
  const jsonPath = path.join(runDir, "results.json");
  // logs 已另存 transcript.json，results.json 去掉以免過大
  const slim = {
    ...result,
    scenarios: result.scenarios.map(({ logs: _logs, ...rest }) => rest),
  };
  fs.writeFileSync(jsonPath, JSON.stringify(slim, null, 2), "utf8");

  const lines: string[] = [];
  lines.push(`# opencode Memory Benchmark 報告`);
  lines.push("");
  lines.push(`- Target: **${result.target}**`);
  if (result.model) lines.push(`- Agent model: ${result.model}`);
  lines.push(`- Judge model: ${result.judgeModel}`);
  lines.push(`- 執行時間: ${result.startedAt} → ${result.finishedAt}`);
  lines.push(`- **總分: ${pct(result.overall)}**`);
  lines.push("");

  const memoryTypeLabels: Record<string, string> = {
    episodic: "episodic（情節記憶：事件/歷史/對話經驗）",
    semantic: "semantic（語意記憶：知識/事實/世界觀）",
    procedural: "procedural（程序記憶：技能/操作步驟）",
  };
  lines.push(`## 記憶類型成績`);
  lines.push("");
  lines.push(`| 記憶類型 | 分數 |`);
  lines.push(`|---|---|`);
  for (const [mt, score] of Object.entries(result.byMemoryType)) {
    lines.push(`| ${memoryTypeLabels[mt] ?? mt} | ${pct(score)} |`);
  }
  lines.push("");

  lines.push(`## 能力分類成績`);
  lines.push("");
  lines.push(`| 類別 | 分數 |`);
  lines.push(`|---|---|`);
  for (const [cat, score] of Object.entries(result.byCategory)) {
    lines.push(`| ${cat} | ${pct(score)} |`);
  }
  lines.push("");

  lines.push(`## 領域成績`);
  lines.push("");
  lines.push(`| 領域 | 分數 |`);
  lines.push(`|---|---|`);
  for (const [dom, score] of Object.entries(result.byDomain)) {
    lines.push(`| ${dom} | ${pct(score)} |`);
  }
  lines.push("");

  lines.push(`## 各 Scenario`);
  lines.push("");
  lines.push(`| Scenario | 記憶類型 | 類別 | 領域 | 分數 |`);
  lines.push(`|---|---|---|---|---|`);
  for (const s of result.scenarios) {
    lines.push(
      `| ${s.name} (${s.id}) | ${s.memoryType} | ${s.category} | ${s.domain} | ${s.error ? `錯誤: ${s.error}` : pct(s.score)} |`,
    );
  }
  lines.push("");

  lines.push(`## 詳細結果`);
  for (const s of result.scenarios) {
    lines.push("");
    lines.push(`### ${s.name} (${s.id}) — ${pct(s.score)}`);
    if (s.error) {
      lines.push(`> 執行錯誤：${s.error}`);
      continue;
    }
    for (const p of s.probes) {
      lines.push("");
      lines.push(`#### probe: ${p.probeId} — ${pct(p.score)}`);
      lines.push(`- 問題：${p.prompt}`);
      for (const c of p.checks) {
        const mark = c.passed === null ? "⏭️" : c.passed ? "✅" : "❌";
        const label = c.check.type === "llm" ? `llm` : c.check.type;
        lines.push(`- ${mark} \`${label}\` (w=${c.check.weight ?? 1})：${c.detail.replaceAll("\n", " ")}`);
      }
      const excerpt = p.output.trim().slice(0, 600);
      lines.push("");
      lines.push(`<details><summary>Agent 輸出節錄</summary>`);
      lines.push("");
      lines.push("```");
      lines.push(excerpt || "(空白)");
      lines.push("```");
      lines.push("");
      lines.push(`</details>`);
    }
  }
  lines.push("");

  const mdPath = path.join(runDir, "report.md");
  fs.writeFileSync(mdPath, lines.join("\n"), "utf8");
  return { jsonPath, mdPath };
}
