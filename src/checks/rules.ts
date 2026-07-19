import fs from "node:fs";
import path from "node:path";
import type { Check, CheckResult } from "../types.js";

/** path 支援檔名層級的 * 萬用字元，例如 "tests/*.test.ts" */
function resolveGlob(workspaceDir: string, pattern: string): string[] {
  const posix = pattern.replace(/\\/g, "/");
  if (!posix.includes("*")) {
    const p = path.join(workspaceDir, posix);
    return fs.existsSync(p) ? [p] : [];
  }
  const dirPart = path.dirname(posix);
  const filePart = path.basename(posix);
  const dir = path.join(workspaceDir, dirPart === "." ? "" : dirPart);
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp("^" + filePart.split("*").map(escapeRe).join(".*") + "$");
  return fs
    .readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => path.join(dir, f));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function runRuleCheck(check: Check, output: string, workspaceDir: string): CheckResult {
  switch (check.type) {
    case "regex": {
      const re = new RegExp(check.pattern ?? "", check.flags ?? "i");
      const passed = re.test(output);
      return { check, passed, detail: passed ? `符合 /${check.pattern}/` : `不符合 /${check.pattern}/` };
    }
    case "contains": {
      const passed = output.toLowerCase().includes((check.value ?? "").toLowerCase());
      return { check, passed, detail: `${passed ? "包含" : "未包含"}「${check.value}」` };
    }
    case "not_contains": {
      const passed = !output.toLowerCase().includes((check.value ?? "").toLowerCase());
      return { check, passed, detail: `${passed ? "未包含（符合預期）" : "包含（不符合預期）"}「${check.value}」` };
    }
    case "file_exists": {
      const matches = resolveGlob(workspaceDir, check.path ?? "");
      const passed = matches.length > 0;
      return {
        check,
        passed,
        detail: passed ? `找到 ${matches.map((m) => path.relative(workspaceDir, m)).join(", ")}` : `找不到 ${check.path}`,
      };
    }
    case "file_contains": {
      const matches = resolveGlob(workspaceDir, check.path ?? "");
      const value = (check.value ?? "").toLowerCase();
      const hit = matches.find((m) => fs.readFileSync(m, "utf8").toLowerCase().includes(value));
      const passed = Boolean(hit);
      return {
        check,
        passed,
        detail: passed
          ? `${path.relative(workspaceDir, hit!)} 包含「${check.value}」`
          : `${check.path} 中找不到「${check.value}」`,
      };
    }
    default:
      return { check, passed: null, detail: `未知的 check type: ${check.type}` };
  }
}
