import spawn from "cross-spawn";

export interface AgentInvocationOptions {
  command: string[];
  model?: string;
  cwd: string;
  env: Record<string, string | undefined>;
  timeoutMs: number;
  /** true 時延續同一 workspace 最近的 session（opencode run --continue） */
  continueSession: boolean;
}

export interface AgentRunOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

const ANSI_RE = /[][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/**
 * 以非互動模式執行一輪 agent 對話：`<command> run [--model m] [--continue] <prompt>`
 * 對應 opencode CLI 的 `opencode run`；mock agent 亦實作同樣的介面。
 */
export function runAgentTurn(opts: AgentInvocationOptions, prompt: string): AgentRunOutput {
  const [bin, ...rest] = opts.command;
  const args = [
    ...rest,
    "run",
    ...(opts.model ? ["--model", opts.model] : []),
    ...(opts.continueSession ? ["--continue"] : []),
    prompt,
  ];
  const started = Date.now();
  const res = spawn.sync(bin, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: "utf8",
    timeout: opts.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    stdout: stripAnsi(res.stdout ?? ""),
    stderr: stripAnsi(res.stderr ?? ""),
    exitCode: res.status,
    durationMs: Date.now() - started,
  };
}
