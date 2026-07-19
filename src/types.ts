export type CheckType =
  | "regex"
  | "contains"
  | "not_contains"
  | "file_exists"
  | "file_contains"
  | "llm";

export interface Check {
  type: CheckType;
  /** 加權，預設 1 */
  weight?: number;
  /** regex 用 */
  pattern?: string;
  flags?: string;
  /** contains / not_contains / file_contains 用 */
  value?: string;
  /** file_* 用，相對於 probe workspace 的路徑（可用 glob 樣式 * 於檔名） */
  path?: string;
  /** llm 用：評分準則 */
  rubric?: string;
}

export interface Probe {
  id: string;
  prompt: string;
  /** true 時在乾淨的新 workspace 執行（測跨專案記憶）；預設沿用 scenario workspace */
  freshWorkspace?: boolean;
  checks: Check[];
}

export interface SessionSpec {
  prompts: string[];
}

/**
 * 記憶類型（認知科學分類）：
 * - episodic：特定時間/情境下發生的具體事件、歷史紀錄、對話經驗
 * - semantic：一般性、客觀的知識、事實、規則與世界觀
 * - procedural：特定動作的技能與操作步驟
 */
export type MemoryType = "episodic" | "semantic" | "procedural";

export interface Scenario {
  id: string;
  name: string;
  /** 能力分類（recall / application / feedback / temporal / synthesis / abstention ...） */
  category: string;
  memoryType: MemoryType;
  /** 領域（coding / devops / business / release ...） */
  domain: string;
  description?: string;
  workspace?: { files?: Record<string, string> };
  /** 植入記憶用的 sessions，依序執行；每個 session 是獨立的 opencode session */
  sessions: SessionSpec[];
  /** 測驗：每個 probe 在全新 session 執行 */
  probes: Probe[];
}

export interface Target {
  name: string;
  description?: string;
  /** 會合併進 workspace 的 opencode.json；支援 {{MEMORY_DIR}} / {{WORKSPACE_DIR}} 佔位符 */
  opencode?: Record<string, unknown>;
  /** 執行 opencode 時附加的環境變數；支援佔位符 */
  env?: Record<string, string>;
  /** 附加到 workspace AGENTS.md 的指引（告訴 agent 如何使用記憶系統） */
  agentsMd?: string;
}

export interface AgentRunLog {
  session: number;
  turn: number;
  kind: "ingest" | "probe";
  prompt: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

export interface CheckResult {
  check: Check;
  /** null = 略過（例如 --no-llm） */
  passed: boolean | null;
  detail: string;
}

export interface ProbeResult {
  probeId: string;
  prompt: string;
  output: string;
  checks: CheckResult[];
  /** 0..1，全部 check 都被略過時為 null */
  score: number | null;
}

export interface ScenarioResult {
  id: string;
  name: string;
  category: string;
  memoryType: MemoryType;
  domain: string;
  probes: ProbeResult[];
  score: number | null;
  error?: string;
  logs: AgentRunLog[];
}

export interface BenchResult {
  target: string;
  model?: string;
  judgeModel: string;
  startedAt: string;
  finishedAt: string;
  scenarios: ScenarioResult[];
  overall: number | null;
  byMemoryType: Record<string, number | null>;
  byCategory: Record<string, number | null>;
  byDomain: Record<string, number | null>;
}

export interface BenchConfig {
  /** 執行 agent 的指令，例如 ["opencode"] 或 ["node", "mock.mjs"] */
  command: string[];
  /** 傳給 opencode --model 的模型（省略則用 opencode 自己的預設） */
  model?: string;
  timeoutMs: number;
  judgeModel: string;
  judgeMaxTokens: number;
}
