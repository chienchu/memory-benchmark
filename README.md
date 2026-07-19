# opencode Memory Benchmark

測試「給 opencode 使用的 memory system」的 benchmark。核心做法：

1. 每個 **scenario** 在隔離的 workspace 中，先用數個獨立 session 驅動真實的 `opencode run` **植入記憶**（偏好、決策、糾錯……）
2. 再開**全新 session** 跑 **probe** 測驗，看記憶系統是否讓 agent 記得並實際運用這些資訊
3. 用**規則檢查**（regex / 檔案存在）+ **LLM judge**（Anthropic API）混合評分，輸出 JSON 與 Markdown 報告

## 前置需求

| 項目 | 說明 |
|---|---|
| Node.js 20+ | 已測試 v24 |
| opencode CLI | `npm i -g opencode-ai`，並先完成 `opencode auth login` |
| `ANTHROPIC_API_KEY` | LLM judge 用；加 `--no-llm` 可跳過 |

```sh
npm install
```

## 快速開始

```sh
# 煙霧測試：用 mock agent 驗證整條 pipeline（不需 opencode、不需 API key）
npm run smoke

# 跑 baseline（無記憶系統），量測底線分數
npm run bench -- --target targets/none --model anthropic/claude-sonnet-4-5

# 跑受測的記憶系統（範例：官方 memory MCP server）
npm run bench -- --target targets/mcp-memory --model anthropic/claude-sonnet-4-5
```

記憶系統的價值 = 受測 target 的分數 − `none` baseline 的分數。

其他常用選項：`--filter <substr>` 只跑部分 scenario、`--judge-model <m>` 換 judge 模型、`--agent-cmd "<cmd>"` 覆寫 agent 指令。完整說明見 `npm run bench -- --help`。

## 測驗矩陣：記憶類型 × 能力 × 領域

每個 scenario 都標了三個維度，報告會分別彙總：

**記憶類型（`memoryType`，認知科學分類）**

| 記憶類型 | 定義 | Scenario |
|---|---|---|
| episodic（情節記憶） | 特定時間/情境下發生的具體事件、歷史紀錄、對話經驗 | 04 糾錯經驗、06 跨 session 整合、07 對話歷史誠實性、09 production 事故回憶、10 debug 歷程接續、17 tape-out 事故、20 良率 excursion |
| semantic（語意記憶） | 一般性、客觀的知識、事實、規則與世界觀 | 01 套件管理工具、02 程式碼風格、03 資料庫決策、05 API URL 更新、08 跨專案偏好、11 訂單狀態機、12 內部術語、16 RTL 設計規範、19 製程 spec |
| procedural（程序記憶） | 特定動作的技能與操作步驟 | 13 發版 SOP、14 故障 runbook、15 新增 endpoint SOP、18 sign-off 流程、21 defect 超標處置 SOP |

**能力分類（`category`）**：recall（單純回憶）、application（在任務中實際運用）、preference、feedback（糾錯不重犯）、temporal（新資訊覆蓋舊資訊）、synthesis（跨 session 整合）、abstention（沒說過的事要誠實說不知道）。

**領域（`domain`）**：不只軟體開發——

| 領域群 | domain | 內容 |
|---|---|---|
| 軟體 | coding、architecture、backend、debugging、release、devops、ops | 程式規範、架構決策、debug、發版、維運 |
| IC 設計 | ic-design | RTL 設計規範（CDC/reset）、tape-out timing 事故、sign-off 流程 |
| IC 製造 | ic-manufacturing | 製程 spec（CD/OOS 判定）、良率 excursion、defect 超標處置 SOP |
| 其他 | business、org-knowledge、planning、meta | 業務規則、內部術語、工作規劃、對話歷史 |

非軟體領域的題目仍以 opencode 為載體：probe 除了問答，也會要求把 domain knowledge 落實到具體產出（照規範寫 Verilog module、把製程 spec 寫進 SPC 判定腳本），驗證記憶是否能被「用出來」而不只是「背出來」。

設計重點：
- 語意與程序類多數有「application」probe——不只問「你記得嗎」，而是看記憶是否改變實際行為（寫出的程式、執行的步驟、改動的檔案）
- 程序記憶的 probe 同時驗證「步驟順序」與「禁忌事項」（如發版不准直接 push main、故障不准重啟 DB）
- 08（cross-project）的 probe 在全新 workspace 執行，只有「全域型」記憶系統能得分；專案綁定型記憶在這題拿低分是預期行為

## 新增受測的 memory system（target）

在 `targets/<name>/target.json` 定義如何把記憶系統掛進 opencode：

```jsonc
{
  "name": "my-memory",
  "description": "說明",
  // 合併進每個 workspace 的 opencode.json（MCP server、plugin 等都掛這裡）
  "opencode": {
    "mcp": {
      "memory": {
        "type": "local",
        "command": ["npx", "-y", "my-memory-server"],
        "environment": { "STORE_PATH": "{{MEMORY_DIR}}/store.json" }
      }
    }
  },
  // 執行 opencode 時附加的環境變數
  "env": { "MY_MEMORY_DIR": "{{MEMORY_DIR}}" },
  // 附加到 workspace AGENTS.md 的使用指引（教 agent 何時讀寫記憶）
  "agentsMd": "## 記憶系統使用規範\n..."
}
```

佔位符：`{{MEMORY_DIR}}`（該 scenario 的專屬記憶儲存目錄，跨 session 保留、跨 scenario 隔離）、`{{WORKSPACE_DIR}}`。

> 注意：如果記憶系統會寫到全域位置（例如 `~/.local/share`），請透過 `env` 把儲存路徑導向 `{{MEMORY_DIR}}`，否則 scenario 之間會互相污染。

## 新增 scenario

在 `scenarios/*.yaml` 新增檔案，結構：

```yaml
id: my-scenario          # 唯一 id
name: 顯示名稱
category: preference     # 自由分類，報告會依此彙總
workspace:
  files:                 # workspace 種子檔案
    package.json: "..."
sessions:                # 植入記憶；每個 session 是獨立的 opencode session
  - prompts:
      - "第一句（新 session）"
      - "第二句（同 session，--continue）"
probes:                  # 測驗；每個 probe 開全新 session
  - id: my-probe
    prompt: "測驗問題"
    freshWorkspace: false   # true = 在乾淨的新 workspace 測（跨專案記憶）
    checks:
      - type: llm             # llm | regex | contains | not_contains | file_exists | file_contains
        weight: 2
        rubric: "pass/fail 判準，寫給 judge 看"
      - type: regex
        pattern: "pnpm add"
```

評分：probe 分數 = 通過的 check 加權比例；scenario 分數 = probes 平均；總分 = scenarios 平均。被略過的 check（`--no-llm`）不列入分母。

## 輸出

每次執行會在 `results/<時間戳>-<target>/` 產生：

- `report.md` — 人類可讀報告（總分、分類、各 probe 的 check 明細與輸出節錄）
- `results.json` — 結構化結果
- `scenarios/<id>/transcript.json` — 每輪 agent 的完整輸入輸出（除錯用）
- `scenarios/<id>/workspace/`、`memory/` — 執行現場，可事後檢視記憶系統實際寫了什麼

## 專案結構

```
src/
  cli.ts          # 進入點與參數解析
  runner.ts       # scenario 執行流程（ingest sessions → probes → 評分）
  opencode.ts     # opencode run 的非互動包裝（mock agent 也實作同介面）
  workspace.ts    # 隔離 workspace 建置、target 設定注入、佔位符替換
  scenario.ts     # YAML 載入與驗證
  checks/rules.ts # 規則檢查
  checks/judge.ts # LLM judge（Anthropic SDK，預設 claude-opus-4-8）
  report.ts       # 報告輸出
scenarios/        # 測驗題庫
targets/          # 受測記憶系統定義（none = baseline）
test/             # mock agent 與煙霧測試 target
```

## 已知限制

- opencode CLI 旗標（`run`、`--continue`、`--model`）若未來改版，只需調整 `src/opencode.ts`
- LLM judge 有成本與少量波動；重要比較建議同一 target 跑多次取平均
- scenario 依序執行（未平行化），完整一輪視模型速度約需數分鐘到數十分鐘
