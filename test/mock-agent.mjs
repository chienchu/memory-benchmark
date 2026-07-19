#!/usr/bin/env node
// 假的 opencode CLI，介面相容：mock-agent.mjs run [--model m] [--continue] <prompt>
// 把每個 prompt 追加到 MOCK_MEMORY_PATH，回覆時附上所有記憶內容。
// 只用來驗證 benchmark pipeline（workspace、session 流程、規則檢查、報告），不代表真實 agent 行為。
import fs from "node:fs";

const argv = process.argv.slice(2);
const parts = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "run" || a === "--continue") continue;
  if (a === "--model") { i++; continue; }
  parts.push(a);
}
const prompt = parts.join(" ");

const memPath = process.env.MOCK_MEMORY_PATH;
let memory = "";
if (memPath) {
  if (fs.existsSync(memPath)) memory = fs.readFileSync(memPath, "utf8");
  fs.appendFileSync(memPath, prompt + "\n", "utf8");
}

console.log("收到你的訊息。");
if (memory.trim()) {
  console.log("我記得之前你說過：");
  console.log(memory.trim());
} else {
  console.log("（目前沒有先前的記憶）");
}
