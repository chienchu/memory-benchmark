import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { Scenario, Target } from "./types.js";

export function loadScenarios(dir: string, filter?: string): Scenario[] {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();
  const scenarios: Scenario[] = [];
  for (const f of files) {
    const raw = parse(fs.readFileSync(path.join(dir, f), "utf8")) as Scenario;
    validateScenario(raw, f);
    if (filter && !raw.id.includes(filter)) continue;
    scenarios.push(raw);
  }
  return scenarios;
}

function validateScenario(s: Scenario, file: string): void {
  const fail = (msg: string) => {
    throw new Error(`scenario ${file} 格式錯誤：${msg}`);
  };
  if (!s.id) fail("缺少 id");
  if (!s.category) fail("缺少 category");
  if (!["episodic", "semantic", "procedural"].includes(s.memoryType))
    fail(`memoryType 必須是 episodic | semantic | procedural（目前：${s.memoryType}）`);
  if (!s.domain) fail("缺少 domain");
  if (!Array.isArray(s.sessions)) fail("sessions 必須是陣列");
  if (!Array.isArray(s.probes) || s.probes.length === 0) fail("至少需要一個 probe");
  for (const p of s.probes) {
    if (!p.id || !p.prompt) fail(`probe 缺少 id 或 prompt`);
    if (!Array.isArray(p.checks) || p.checks.length === 0) fail(`probe ${p.id} 至少需要一個 check`);
    for (const c of p.checks) {
      if (c.type === "llm" && !c.rubric) fail(`probe ${p.id} 的 llm check 缺少 rubric`);
      if (c.type === "regex" && !c.pattern) fail(`probe ${p.id} 的 regex check 缺少 pattern`);
      if ((c.type === "contains" || c.type === "not_contains") && !c.value)
        fail(`probe ${p.id} 的 ${c.type} check 缺少 value`);
      if ((c.type === "file_exists" || c.type === "file_contains") && !c.path)
        fail(`probe ${p.id} 的 ${c.type} check 缺少 path`);
    }
  }
}

export function loadTarget(dir: string): Target {
  const file = path.join(dir, "target.json");
  if (!fs.existsSync(file)) throw new Error(`找不到 target 定義：${file}`);
  const target = JSON.parse(fs.readFileSync(file, "utf8")) as Target;
  if (!target.name) target.name = path.basename(dir);
  return target;
}
