import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Scenario, Target } from "./types.js";

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** 將 target 設定中的佔位符換成實際路徑（JSON 安全的 forward-slash 形式） */
export function substitute<T>(value: T, vars: { memoryDir: string; workspaceDir: string }): T {
  const json = JSON.stringify(value);
  const replaced = json
    .replaceAll("{{MEMORY_DIR}}", toPosix(vars.memoryDir))
    .replaceAll("{{WORKSPACE_DIR}}", toPosix(vars.workspaceDir));
  return JSON.parse(replaced) as T;
}

/** 建立（或重建）一個 scenario workspace：種子檔案 + opencode.json + AGENTS.md */
export function prepareWorkspace(
  dir: string,
  scenario: Scenario,
  target: Target,
  memoryDir: string,
): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });

  for (const [rel, content] of Object.entries(scenario.workspace?.files ?? {})) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }

  const opencodeConfig = {
    $schema: "https://opencode.ai/config.json",
    ...substitute(target.opencode ?? {}, { memoryDir, workspaceDir: dir }),
  };
  fs.writeFileSync(path.join(dir, "opencode.json"), JSON.stringify(opencodeConfig, null, 2), "utf8");

  if (target.agentsMd) {
    const agentsPath = path.join(dir, "AGENTS.md");
    const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, "utf8") + "\n\n" : "";
    fs.writeFileSync(agentsPath, existing + target.agentsMd.trim() + "\n", "utf8");
  }

  // 讓 workspace 是一個 git repo，貼近真實 opencode 專案情境
  const gitDir = path.join(dir, ".git");
  if (!fs.existsSync(gitDir)) {
    try {
      execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
    } catch {
      // git 不存在也不影響 benchmark 本體
    }
  }
}
