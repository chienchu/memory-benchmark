import Anthropic from "@anthropic-ai/sdk";
import type { Check, CheckResult } from "../types.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const JUDGE_SYSTEM = `你是一個嚴謹的評分者，負責評估一個「具備記憶系統的 AI coding agent」在新 session 中的回答。
你會拿到：測驗問題（probe）、agent 的完整輸出、以及評分準則（rubric）。
只依 rubric 判定 pass 或 fail：
- rubric 要求 agent「記得」某資訊時，agent 的輸出必須明確反映該資訊（在回答或實際行為中），僅籠統帶過不算 pass。
- rubric 要求 agent「不應捏造」時，agent 誠實表示不知道/沒有紀錄即為 pass；編造具體答案即為 fail。
- agent 輸出可能包含工具執行紀錄與雜訊，請聚焦在最終行為與回答內容。`;

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "fail"] },
    reasoning: { type: "string" },
  },
  required: ["verdict", "reasoning"],
  additionalProperties: false,
} as const;

export async function runLlmCheck(
  check: Check,
  probePrompt: string,
  output: string,
  opts: { model: string; maxTokens: number },
): Promise<CheckResult> {
  const userPrompt = [
    "## 測驗問題（在全新 session 中對 agent 提出）",
    probePrompt,
    "",
    "## Agent 的完整輸出",
    "```",
    output.slice(0, 30_000) || "(空白輸出)",
    "```",
    "",
    "## 評分準則",
    check.rubric ?? "(未提供 rubric)",
  ].join("\n");

  try {
    const res = await getClient().messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
      output_config: { format: { type: "json_schema", schema: VERDICT_SCHEMA } },
    });
    const text = res.content.find((b) => b.type === "text")?.text ?? "";
    const parsed = JSON.parse(text) as { verdict: "pass" | "fail"; reasoning: string };
    return { check, passed: parsed.verdict === "pass", detail: parsed.reasoning };
  } catch (err) {
    return { check, passed: null, detail: `judge 呼叫失敗：${(err as Error).message}` };
  }
}
