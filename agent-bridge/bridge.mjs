#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const CODEX_BIN_CANDIDATES = [
  process.env.AGENT_BRIDGE_CODEX_BIN,
  "codex",
  "/Applications/Codex.app/Contents/Resources/codex",
].filter(Boolean);
const DIRECTIONS = new Set(["to-codex", "to-claude"]);
const MODES = new Set(["audit-claude", "audit-codex", "feedback-to-claude", "feedback-to-codex"]);
const SUBMIT_KEYS = new Set(["enter", "cmd-enter", "none"]);
const DELIVERY_ALIASES = new Map([
  ["cli", "cli"],
  ["command", "cli"],
  ["terminal", "cli"],
  ["ax", "ax"],
  ["accessibility", "ax"],
  ["ui", "ax"],
  ["current", "current"],
  ["paste", "current"],
  ["new", "new"],
  ["deeplink", "new"],
]);

function usage() {
  console.log(`Usage:
  node bridge.mjs doctor
  node bridge.mjs to-codex [--mode audit-claude|feedback-to-codex] [--workspace PATH] [--stdin] [--dry-run]
  node bridge.mjs to-claude [--mode audit-codex|feedback-to-claude] [--workspace PATH] [--stdin] [--dry-run]

Reads transferred text from the macOS clipboard by default, stores it in
.agent-bridge/inbox, then sends Codex or Claude Code by deep link, by
CLI, by Accessibility-assisted UI automation, or by a legacy paste path.

Options:
  --mode MODE       Transfer mode. Defaults to audit-claude for to-codex and
                    feedback-to-claude for to-claude.
  --delivery TYPE   cli invokes the target CLI and prints the audit result back
                    to the current caller without touching desktop apps.
                    ax uses macOS Accessibility plus geometry fallback to
                    paste into the current target conversation and click Send.
                    current reuses the current target app conversation with
                    legacy paste/return keystrokes.
                    new opens a new/pre-filled thread.
                    Defaults to AGENT_BRIDGE_DELIVERY or cli.
                    Backward-compatible aliases: command/terminal=cli,
                    accessibility/ui=ax, paste=current, deeplink=new.
  --ax              Shortcut for --delivery ax.
  --current         Shortcut for --delivery current.
  --new             Shortcut for --delivery new.
  --paste           Legacy shortcut for --delivery current.
  --deeplink        Legacy shortcut for --delivery new.
  --no-submit       With --delivery ax/current, paste without submitting.
  --submit-key KEY  enter, cmd-enter, or none. Used by current mode. Defaults
                    to cmd-enter for Codex and enter for Claude.
  --focus-timeout MS
                    How long to try bringing the target app to front before
                    pasting. Defaults to 8000.
  --workspace PATH  Project/workspace folder to open in the destination app.
  --stdin           Read transferred text from stdin instead of pbpaste.
  --dry-run         Print the generated URL or paste payload instead of sending.
`);
}

function defaultModeFor(direction) {
  return direction === "to-codex" ? "audit-claude" : "feedback-to-claude";
}

function normalizeDelivery(value) {
  const delivery = DELIVERY_ALIASES.get(value);
  if (!delivery) {
    throw new Error(`Unknown delivery: ${value}. Use cli, ax, current, or new.`);
  }
  return delivery;
}

function defaultSubmitKeyFor(direction) {
  return direction === "to-codex" ? "cmd-enter" : "enter";
}

function assertModeMatchesDirection({ direction, mode }) {
  const valid =
    (direction === "to-codex" && (mode === "audit-claude" || mode === "feedback-to-codex")) ||
    (direction === "to-claude" && (mode === "audit-codex" || mode === "feedback-to-claude"));
  if (!valid) throw new Error(`Mode ${mode} is not valid for ${direction}`);
}

function parseArgs(argv) {
  const args = {
    direction: argv[2],
    mode: null,
    delivery: process.env.AGENT_BRIDGE_DELIVERY || "cli",
    submit: true,
    submitKey: process.env.AGENT_BRIDGE_SUBMIT_KEY || null,
    focusTimeoutMs: Number(process.env.AGENT_BRIDGE_FOCUS_TIMEOUT_MS || 8000),
    workspace: process.cwd(),
    stdin: false,
    dryRun: false,
  };
  if (!DIRECTIONS.has(args.direction)) {
    usage();
    process.exit(args.direction ? 2 : 0);
  }

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--stdin") {
      args.stdin = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--ax") {
      args.delivery = "ax";
    } else if (arg === "--current" || arg === "--paste") {
      args.delivery = "current";
    } else if (arg === "--new" || arg === "--deeplink") {
      args.delivery = "new";
    } else if (arg === "--no-submit") {
      args.submit = false;
      args.submitKey = "none";
    } else if (arg === "--submit-key") {
      const value = argv[i + 1];
      if (!value) throw new Error("--submit-key requires a value");
      args.submitKey = value;
      i += 1;
    } else if (arg.startsWith("--submit-key=")) {
      args.submitKey = arg.slice("--submit-key=".length);
    } else if (arg === "--focus-timeout") {
      const value = argv[i + 1];
      if (!value) throw new Error("--focus-timeout requires a value");
      args.focusTimeoutMs = Number(value);
      i += 1;
    } else if (arg.startsWith("--focus-timeout=")) {
      args.focusTimeoutMs = Number(arg.slice("--focus-timeout=".length));
    } else if (arg === "--delivery") {
      const value = argv[i + 1];
      if (!value) throw new Error("--delivery requires a value");
      args.delivery = value;
      i += 1;
    } else if (arg.startsWith("--delivery=")) {
      args.delivery = arg.slice("--delivery=".length);
    } else if (arg === "--mode") {
      const value = argv[i + 1];
      if (!value) throw new Error("--mode requires a value");
      args.mode = value;
      i += 1;
    } else if (arg.startsWith("--mode=")) {
      args.mode = arg.slice("--mode=".length);
    } else if (arg === "--workspace") {
      const value = argv[i + 1];
      if (!value) throw new Error("--workspace requires a path");
      args.workspace = value;
      i += 1;
    } else if (arg.startsWith("--workspace=")) {
      args.workspace = arg.slice("--workspace=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.mode ??= defaultModeFor(args.direction);
  if (!MODES.has(args.mode)) throw new Error(`Unknown mode: ${args.mode}`);
  args.delivery = normalizeDelivery(args.delivery);
  args.submitKey ??= defaultSubmitKeyFor(args.direction);
  if (!SUBMIT_KEYS.has(args.submitKey)) throw new Error(`Unknown submit key: ${args.submitKey}`);
  if (!Number.isFinite(args.focusTimeoutMs) || args.focusTimeoutMs < 0) {
    throw new Error("--focus-timeout must be a non-negative number of milliseconds");
  }
  if (args.submitKey === "none") args.submit = false;
  assertModeMatchesDirection(args);
  args.workspace = resolve(args.workspace);
  return args;
}

function readStdin() {
  return readFileSync(0, "utf8");
}

function readClipboard() {
  return execFileSync("pbpaste", [], { encoding: "utf8" });
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    "-",
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join("");
}

function modeLabel(mode) {
  switch (mode) {
    case "audit-claude":
      return "Claude execution -> Codex audit";
    case "audit-codex":
      return "Codex execution -> Claude audit";
    case "feedback-to-claude":
      return "Codex audit feedback -> Claude";
    case "feedback-to-codex":
      return "Claude audit feedback -> Codex";
    default:
      return mode;
  }
}

function runIdFor({ direction, mode }) {
  return `${timestamp()}-${mode}-${direction}`;
}

function createRun({ direction, mode, workspace }) {
  const runId = runIdFor({ direction, mode });
  const runDir = resolve(workspace, ".agent-bridge", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  return { runId, runDir };
}

function writeTransferFile({ direction, mode, workspace, payload, run }) {
  const inbox = resolve(workspace, ".agent-bridge", "inbox");
  mkdirSync(inbox, { recursive: true });
  const name = `${run.runId}.md`;
  const path = resolve(inbox, name);
  const body = [
    "# Agent Bridge Transfer",
    "",
    `Run ID: ${run.runId}`,
    `Direction: ${modeLabel(mode)}`,
    `Created: ${new Date().toISOString()}`,
    `Workspace: ${workspace}`,
    `Run Directory: ${run.runDir}`,
    "",
    "## Transferred Text",
    "",
    payload.trimEnd(),
    "",
  ].join("\n");
  writeFileSync(path, body, "utf8");
  writeFileSync(resolve(run.runDir, "handoff.md"), body, "utf8");
  return path;
}

function writeBridgeLog(workspace, event) {
  const logDir = resolve(workspace, ".agent-bridge", "logs");
  mkdirSync(logDir, { recursive: true });
  appendFileSync(
    resolve(logDir, "bridge.log"),
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
    "utf8",
  );
}

function writeRunJson(workspace, run, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(resolve(run.runDir, "summary.json"), body, "utf8");
  const runsDir = resolve(workspace, ".agent-bridge", "runs");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(resolve(runsDir, "latest.json"), body, "utf8");
}

function writeRunSummaryMd(run, summary) {
  const lines = [
    "# Agent Bridge Run",
    "",
    `Run ID: ${summary.runId}`,
    `Status: ${summary.status}`,
    `Direction: ${summary.direction}`,
    `Mode: ${summary.mode}`,
    `Delivery: ${summary.delivery}`,
    `Started: ${summary.startedAt}`,
    `Finished: ${summary.finishedAt || ""}`,
    `Duration Seconds: ${summary.durationSeconds ?? ""}`,
    `Workspace: ${summary.workspace}`,
    `Handoff: ${summary.handoffPath || ""}`,
    `Audit: ${summary.auditPath || ""}`,
    `Stdout Log: ${summary.stdoutPath || ""}`,
    `Stderr Log: ${summary.stderrPath || ""}`,
    summary.error ? `Error: ${summary.error}` : "",
    "",
  ].filter((line) => line !== "");
  writeFileSync(resolve(run.runDir, "summary.md"), `${lines.join("\n")}\n`, "utf8");
}

function writeRunMarker(run, name, payload) {
  writeFileSync(resolve(run.runDir, name), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function promptForCodexAuditClaude(filePath) {
  return [
    "请使用 claude-codex-bridge 作为 CodeX / GPT-5.5 审计员，审计 Claude Code 的执行结果。",
    "",
    `转发内容已保存到本地文件：${filePath}`,
    "",
    "请读取该文件，并重点检查：",
    "1. Claude 是否真正完成了用户目标。",
    "2. 代码、文件修改、命令执行是否有风险或遗漏。",
    "3. 是否缺少测试、验证、边界情况或回滚说明。",
    "4. 给出一段可以直接转发回 Claude 的修复反馈。",
    "",
    "输出请包含：Findings、Missing Verification、Suggested Reply To Claude。",
    "",
    "自动化要求：",
    "1. 完成审计后，把 Suggested Reply To Claude 的内容写入 `.agent-bridge/outbox/latest-reply-to-claude.md`。",
    "2. 然后运行：`node \"$HOME/plugins/claude-codex-bridge/scripts/send-file-to-claude.mjs\" .agent-bridge/outbox/latest-reply-to-claude.md`。",
    "3. 如果命令成功，只说明 bridge 已向 Claude 当前窗口发出粘贴/提交自动化；不要声称 Claude 已经处理完成。",
    "4. 如果命令失败或出现 focus/权限错误，必须把错误告诉用户，不要声称已送达。",
    "5. 除非用户明确要求只审计不转发，否则不要等待用户再确认。",
  ].join("\n");
}

function promptForClaudeRepair(filePath) {
  return [
    "下面是 CodeX / GPT-5.5 对你上一轮执行情况的审计反馈。",
    "",
    `审计内容已保存到本地文件：${filePath}`,
    "",
    "请读取该文件，逐条回应审计意见，并优先修复 P0/P1/P2 问题。",
    "完成后请说明你修改了什么、如何验证，以及还有哪些残余风险。",
  ].join("\n");
}

function cliAuditGuard() {
  return [
    "CLI 审计约束：",
    "1. 不要修改、创建或删除任何文件。",
    "2. 不要打开或操作任何 GUI App、浏览器、邮件、聊天软件或桌面窗口。",
    "3. 如需检查仓库，只做只读读取和只读命令。",
    "4. 不要调用 bridge 回传脚本；你的 stdout 就是返回给当前对话的结果。",
  ].join("\n");
}

function promptForCodexAuditClaudeCli(filePath) {
  return [
    "请使用 claude-codex-bridge 作为 CodeX / GPT-5.5 审计员，审计 Claude Code 的执行结果。",
    "",
    `转发内容已保存到本地文件：${filePath}`,
    "",
    "请先读取该文件，再重点检查：",
    "1. Claude 是否真正完成了用户目标。",
    "2. 代码、文件修改、命令执行是否有风险或遗漏。",
    "3. 是否缺少测试、验证、边界情况或回滚说明。",
    "4. 给出一段可以直接复制给 Claude 的修复反馈。",
    "",
    cliAuditGuard(),
    "",
    "输出请包含：Findings、Missing Verification、Suggested Reply To Claude。",
  ].join("\n");
}

function promptForClaudeAuditCodexCli(filePath) {
  return [
    "请使用 claude-codex-bridge 作为 Claude / Opus 审计员，审计 Codex / GPT-5.5 的执行结果。",
    "",
    `转发内容已保存到本地文件：${filePath}`,
    "",
    "请先读取该文件，再重点检查：",
    "1. Codex 是否真正完成了用户目标。",
    "2. 代码、文件修改、命令执行是否有风险或遗漏。",
    "3. 是否缺少测试、验证、边界情况或回滚说明。",
    "4. 给出一段可以直接复制给 Codex 的修复反馈。",
    "",
    cliAuditGuard(),
    "",
    "输出请包含：Findings、Missing Verification、Suggested Reply To Codex。",
  ].join("\n");
}

function promptForClaudeRepairCli(filePath) {
  return [
    "下面是 CodeX / GPT-5.5 对 Claude 上一轮执行情况的审计反馈。",
    "",
    `审计内容已保存到本地文件：${filePath}`,
    "",
    "请读取该文件，逐条回应审计意见，并给出 Claude 应该执行的修复计划或回复。",
    "",
    cliAuditGuard(),
    "",
    "输出请包含：Acknowledgement、Repair Plan、Reply To Codex。",
  ].join("\n");
}

function promptForCodexRepairCli(filePath) {
  return [
    "下面是 Claude / Opus 对 Codex 上一轮执行情况的审计反馈。",
    "",
    `审计内容已保存到本地文件：${filePath}`,
    "",
    "请读取该文件，逐条回应审计意见，并给出 Codex 应该执行的修复计划或回复。",
    "",
    cliAuditGuard(),
    "",
    "输出请包含：Acknowledgement、Repair Plan、Reply To Claude。",
  ].join("\n");
}

function promptForClaudeAuditCodex(filePath) {
  return [
    "请使用 claude-codex-bridge 作为 Claude / Opus 审计员，审计 Codex / GPT-5.5 的执行结果。",
    "",
    `转发内容已保存到本地文件：${filePath}`,
    "",
    "请读取该文件，并重点检查：",
    "1. Codex 是否真正完成了用户目标。",
    "2. 代码、文件修改、命令执行是否有风险或遗漏。",
    "3. 是否缺少测试、验证、边界情况或回滚说明。",
    "4. 给出一段可以直接转发回 Codex 的修复反馈。",
    "",
    "输出请包含：Findings、Missing Verification、Suggested Reply To Codex。",
    "",
    "自动化要求：",
    "1. 完成审计后，把 Suggested Reply To Codex 的内容写入 `.agent-bridge/outbox/latest-reply-to-codex.md`。",
    "2. 然后运行：`node \"$HOME/.claude/skills/claude-codex-bridge/scripts/send-file-to-codex.mjs\" .agent-bridge/outbox/latest-reply-to-codex.md`。",
    "3. 如果命令成功，只说明 bridge 已向 Codex 当前窗口发出粘贴/提交自动化；不要声称 Codex 已经处理完成。",
    "4. 如果命令失败或出现 focus/权限错误，必须把错误告诉用户，不要声称已送达。",
    "5. 除非用户明确要求只审计不转发，否则不要等待用户再确认。",
  ].join("\n");
}

function promptForCodexRepair(filePath) {
  return [
    "下面是 Claude / Opus 对你上一轮执行情况的审计反馈。",
    "",
    `审计内容已保存到本地文件：${filePath}`,
    "",
    "请读取该文件，逐条回应审计意见，并优先修复 P0/P1/P2 问题。",
    "完成后请说明你修改了什么、如何验证，以及还有哪些残余风险。",
  ].join("\n");
}

function promptFor({ mode, filePath, delivery }) {
  if (delivery === "cli") {
    switch (mode) {
      case "audit-claude":
        return promptForCodexAuditClaudeCli(filePath);
      case "audit-codex":
        return promptForClaudeAuditCodexCli(filePath);
      case "feedback-to-claude":
        return promptForClaudeRepairCli(filePath);
      case "feedback-to-codex":
        return promptForCodexRepairCli(filePath);
      default:
        throw new Error(`Unsupported mode: ${mode}`);
    }
  }

  switch (mode) {
    case "audit-claude":
      return promptForCodexAuditClaude(filePath);
    case "audit-codex":
      return promptForClaudeAuditCodex(filePath);
    case "feedback-to-claude":
      return promptForClaudeRepair(filePath);
    case "feedback-to-codex":
      return promptForCodexRepair(filePath);
    default:
      throw new Error(`Unsupported mode: ${mode}`);
  }
}

function buildUrl({ direction, mode, workspace, prompt }) {
  if (direction === "to-codex") {
    const url = new URL("codex://new");
    url.searchParams.set("path", workspace);
    url.searchParams.set("prompt", prompt);
    url.searchParams.set("originUrl", `agent-bridge://${mode}`);
    return url.toString();
  }

  const url = new URL("claude://code/new");
  url.searchParams.set("folder", workspace);
  url.searchParams.set("q", prompt);
  return url.toString();
}

function appNameFor(direction) {
  return direction === "to-codex" ? "Codex" : "Claude";
}

function copyToClipboard(text) {
  const result = spawnSync("pbcopy", [], { input: text, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pbcopy exited with status ${result.status}`);
}

function runOsa(lines, options = {}) {
  const result = spawnSync("osascript", lines.flatMap((line) => ["-e", line]), {
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr || `osascript exited with status ${result.status}`);
  }
  return result.stdout?.trim() ?? "";
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function frontmostAppName() {
  return runOsa(['tell application "System Events" to get name of first application process whose frontmost is true']);
}

function focusTargetApp(appName, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastFrontmost = "";
  do {
    runOsa([
      `tell application "${appName}" to activate`,
      "delay 0.1",
      `try`,
      `tell application "${appName}" to reopen`,
      `end try`,
      'tell application "System Events"',
      `if exists process "${appName}" then`,
      `set frontmost of process "${appName}" to true`,
      `try`,
      `perform action "AXRaise" of window 1 of process "${appName}"`,
      `end try`,
      `end if`,
      "end tell",
    ]);
    lastFrontmost = frontmostAppName();
    if (lastFrontmost === appName) return;
    sleepMs(250);
  } while (Date.now() < deadline);

  throw new Error(`Could not focus ${appName}; frontmost app is ${lastFrontmost || "unknown"}`);
}

function pasteDelayFor(prompt) {
  return Math.min(3, Math.max(0.8, prompt.length / 4000));
}

function submitScriptLine(submitKey) {
  if (submitKey === "cmd-enter") return "key code 36 using {command down}";
  if (submitKey === "enter") return "key code 36";
  return null;
}

function geometryFor(appName) {
  const output = runOsa([
    `tell application "System Events" to tell process "${appName}"`,
    "set windowPosition to position of window 1",
    "set windowSize to size of window 1",
    "return (item 1 of windowPosition as text) & \",\" & (item 2 of windowPosition as text) & \",\" & (item 1 of windowSize as text) & \",\" & (item 2 of windowSize as text)",
    "end tell",
  ]);
  const [x, y, width, height] = output.split(",").map((part) => Number(part.trim()));
  if ([x, y, width, height].some((value) => !Number.isFinite(value))) {
    throw new Error(`Could not read ${appName} window geometry`);
  }
  return { x, y, width, height };
}

function axCoordinatePlan({ appName, direction }) {
  const { x, y, width, height } = geometryFor(appName);
  const inputX = Math.round(x + width * 0.62);
  const inputY = Math.round(y + height - Math.max(54, Math.min(92, height * 0.085)));
  const sendX = Math.round(x + width - Math.max(44, Math.min(78, width * 0.055)));
  const sendY = inputY;
  return {
    backend: "geometry",
    direction,
    appName,
    inputX,
    inputY,
    sendX,
    sendY,
    window: { x, y, width, height },
  };
}

function clickPointScript({ x, y }) {
  return [
    'tell application "System Events"',
    `click at {${x}, ${y}}`,
    "end tell",
  ];
}

function pasteIntoAccessibleConversation({ direction, prompt, submit, submitKey, focusTimeoutMs }) {
  const appName = appNameFor(direction);
  focusTargetApp(appName, focusTimeoutMs);
  const plan = axCoordinatePlan({ appName, direction });
  copyToClipboard(prompt);

  runOsa([
    ...clickPointScript({ x: plan.inputX, y: plan.inputY }),
    "delay 0.15",
    'tell application "System Events"',
    "set frontApp to name of first application process whose frontmost is true",
    `if frontApp is not "${appName}" then error "Target focus lost before AX paste; frontmost app is " & frontApp`,
    'keystroke "a" using {command down}',
    "delay 0.05",
    'keystroke "v" using {command down}',
    `delay ${pasteDelayFor(prompt).toFixed(2)}`,
    "end tell",
  ]);

  if (submit) {
    runOsa([
      'tell application "System Events"',
      "set frontApp to name of first application process whose frontmost is true",
      `if frontApp is not "${appName}" then error "Target focus lost before AX submit; frontmost app is " & frontApp`,
      "end tell",
      ...clickPointScript({ x: plan.sendX, y: plan.sendY }),
      "delay 0.35",
    ]);
  }

  console.log(`AX paste automation sent to ${appName} current conversation`);
  if (submit) console.log(`AX submit click sent to ${appName}`);
  else console.log("Did not submit after AX paste");
  return plan;
}

function pasteIntoCurrentConversation({ direction, prompt, submit, submitKey, focusTimeoutMs }) {
  const appName = appNameFor(direction);
  focusTargetApp(appName, focusTimeoutMs);
  copyToClipboard(prompt);
  const submitLine = submit ? submitScriptLine(submitKey) : null;
  const submitLines = submitLine
    ? [
        "set frontApp to name of first application process whose frontmost is true",
        `if frontApp is not "${appName}" then error "Target focus lost before submit; frontmost app is " & frontApp`,
        submitLine,
      ]
    : [];

  runOsa(
    [
      "delay 0.1",
      'tell application "System Events"',
      `set frontmost of process "${appName}" to true`,
      "set frontApp to name of first application process whose frontmost is true",
      `if frontApp is not "${appName}" then error "Target focus lost before paste; frontmost app is " & frontApp`,
      'keystroke "v" using {command down}',
      `delay ${pasteDelayFor(prompt).toFixed(2)}`,
      ...submitLines,
      "end tell",
    ],
    { stdio: "inherit" },
  );
  console.log(`Paste keystroke sent to ${appName} current conversation`);
  if (submitLine) console.log(`Submit keystroke sent with ${submitKey}`);
  else console.log("Did not submit after paste");
}

function openUrl(url) {
  const result = spawnSync("open", [url], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`open exited with status ${result.status}`);
}

function outboxPath(workspace, name) {
  const outbox = resolve(workspace, ".agent-bridge", "outbox");
  mkdirSync(outbox, { recursive: true });
  return resolve(outbox, name);
}

function cliOutputPath({ direction, mode, workspace }) {
  if (direction === "to-codex" && mode === "audit-claude") return outboxPath(workspace, "latest-codex-audit.md");
  if (direction === "to-claude" && mode === "audit-codex") return outboxPath(workspace, "latest-claude-audit.md");
  if (direction === "to-codex" && mode === "feedback-to-codex") return outboxPath(workspace, "latest-codex-feedback-response.md");
  if (direction === "to-claude" && mode === "feedback-to-claude") return outboxPath(workspace, "latest-claude-feedback-response.md");
  return outboxPath(workspace, `latest-${direction}-${mode}.md`);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function commandForLog(args, prompt) {
  return args.map((arg) => (arg === prompt ? "<prompt>" : arg));
}

function commandWorks(bin, args) {
  const result = spawnSync(bin, args, { encoding: "utf8", timeout: 15000 });
  return !result.error && result.status === 0;
}

function inspectCommand(bin, args) {
  const result = spawnSync(bin, args, { encoding: "utf8", timeout: 15000 });
  return {
    bin,
    args,
    ok: !result.error && result.status === 0,
    status: result.status,
    error: result.error?.message || "",
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function formatCommandFailure(result) {
  return firstNonEmpty(result.error, result.stderr, result.stdout, `exit status ${result.status}`);
}

function codexInstallHint() {
  return [
    "Install or expose Codex CLI:",
    "  Option A: install Codex Desktop so this exists:",
    "    /Applications/Codex.app/Contents/Resources/codex",
    "  Option B: install the CLI package if you use npm distribution:",
    "    npm install -g @openai/codex",
    "  Option C: point the bridge at an existing binary:",
    "    export AGENT_BRIDGE_CODEX_BIN=/absolute/path/to/codex",
    "  Then verify:",
    "    codex --version",
  ].join("\n");
}

function claudeInstallHint() {
  return [
    "Install and authenticate Claude Code CLI:",
    "  npm install -g @anthropic-ai/claude-code",
    "  claude auth login",
    "  claude auth status",
    "If Claude is installed outside PATH, set:",
    "  export AGENT_BRIDGE_CLAUDE_BIN=/absolute/path/to/claude",
  ].join("\n");
}

function resolveCodexBin() {
  for (const candidate of CODEX_BIN_CANDIDATES) {
    if (candidate.includes("/") && !existsSync(candidate)) continue;
    if (commandWorks(candidate, ["--version"])) return candidate;
  }
  throw new Error(
    [
      "Codex CLI preflight failed. Cannot find a runnable `codex` command.",
      codexInstallHint(),
      "Run `node ~/.agent-bridge/bridge.mjs doctor` for a full local diagnosis.",
    ].join(" "),
  );
}

function preflightCommand(bin, args, label) {
  const result = spawnSync(bin, args, { encoding: "utf8", timeout: 15000 });
  if (result.error) {
    const hint = label.startsWith("Claude") ? `\n${claudeInstallHint()}` : "";
    throw new Error(`${label} preflight failed: ${result.error.message}${hint}`);
  }
  if (result.status !== 0) {
    const details = firstNonEmpty(result.stderr, result.stdout, `${label} exited with status ${result.status}`);
    const hint = label.startsWith("Claude") ? `\n${claudeInstallHint()}` : "";
    throw new Error(`${label} preflight failed. Please check CLI installation/authentication. ${details}${hint}`);
  }
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function doctorCheck(label, result, hint = "") {
  const status = result.ok ? "OK" : "MISSING";
  console.log(`${status} ${label}`);
  console.log(`  command: ${[result.bin, ...result.args].join(" ")}`);
  if (result.ok) {
    const version = firstNonEmpty(result.stdout, result.stderr).split("\n")[0] || "ok";
    console.log(`  result: ${version}`);
  } else {
    console.log(`  error: ${formatCommandFailure(result)}`);
    if (hint) {
      console.log("  fix:");
      for (const line of hint.split("\n")) console.log(`    ${line}`);
    }
  }
  console.log("");
  return result.ok;
}

function runDoctor() {
  console.log("Claude-Codex Bridge Doctor");
  console.log("===========================");
  console.log("");

  const checks = [];
  checks.push(doctorCheck("Node.js", inspectCommand(process.execPath, ["--version"])));
  checks.push(
    doctorCheck(
      "Bridge runtime",
      {
        bin: resolve(process.argv[1] || "bridge.mjs"),
        args: [],
        ok: existsSync(resolve(process.argv[1] || "bridge.mjs")),
        status: existsSync(resolve(process.argv[1] || "bridge.mjs")) ? 0 : 1,
        error: existsSync(resolve(process.argv[1] || "bridge.mjs")) ? "" : "bridge.mjs not found",
        stdout: "",
        stderr: "",
      },
      "Install the bridge runtime:\n  node agent-bridge/install-global.mjs",
    ),
  );

  let codexOk = false;
  console.log("Codex CLI candidates");
  console.log("--------------------");
  for (const candidate of CODEX_BIN_CANDIDATES) {
    if (candidate.includes("/") && !existsSync(candidate)) {
      const result = {
        bin: candidate,
        args: ["--version"],
        ok: false,
        status: 1,
        error: "file does not exist",
        stdout: "",
        stderr: "",
      };
      doctorCheck(`Codex candidate (${candidate})`, result);
      continue;
    }
    const ok = doctorCheck(`Codex candidate (${candidate})`, inspectCommand(candidate, ["--version"]));
    codexOk ||= ok;
  }
  if (!codexOk) {
    console.log(codexInstallHint());
    console.log("");
  }
  checks.push(codexOk);

  const claudeBin = process.env.AGENT_BRIDGE_CLAUDE_BIN || "claude";
  const claudeVersionOk = doctorCheck("Claude CLI", inspectCommand(claudeBin, ["--version"]), claudeInstallHint());
  const claudeAuthOk = doctorCheck("Claude auth", inspectCommand(claudeBin, ["auth", "status"]), claudeInstallHint());
  checks.push(claudeVersionOk, claudeAuthOk);

  const ok = checks.every(Boolean);
  console.log(ok ? "Doctor result: OK" : "Doctor result: ACTION NEEDED");
  process.exit(ok ? 0 : 1);
}

function commandHelpSupports(bin, flag) {
  try {
    return preflightCommand(bin, ["--help"], `${bin} --help`).includes(flag);
  } catch {
    return true;
  }
}

function appendChunk(path, chunk) {
  appendFileSync(path, chunk);
}

function readFileIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function runProcessStreaming({ bin, args, cwd, stdoutPath, stderrPath }) {
  writeFileSync(stdoutPath, "", "utf8");
  writeFileSync(stderrPath, "", "utf8");

  return new Promise((resolveProcess) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => appendChunk(stdoutPath, chunk));
    child.stderr.on("data", (chunk) => appendChunk(stderrPath, chunk));
    child.on("error", (error) => {
      appendFileSync(stderrPath, `${error.message}\n`, "utf8");
      resolveProcess({ status: 1, error });
    });
    child.on("close", (status, signal) => {
      resolveProcess({ status: status ?? 1, signal });
    });
  });
}

function latestOutputPath({ direction, mode, workspace }) {
  return cliOutputPath({ direction, mode, workspace });
}

async function runCodexCli({ prompt, workspace, run }) {
  const bin = resolveCodexBin();
  const model = process.env.AGENT_BRIDGE_CODEX_MODEL || "gpt-5.5";
  const effort = process.env.AGENT_BRIDGE_CODEX_EFFORT || "medium";
  const sandbox = process.env.AGENT_BRIDGE_CODEX_SANDBOX || "read-only";
  const outputPath = resolve(run.runDir, "audit.md");
  const stdoutPath = resolve(run.runDir, "stdout.log");
  const stderrPath = resolve(run.runDir, "stderr.log");
  writeFileSync(outputPath, "", "utf8");
  preflightCommand(bin, ["--version"], "Codex CLI");
  const args = [
    "exec",
    "--model",
    model,
    "--sandbox",
    sandbox,
    "--skip-git-repo-check",
    "-C",
    workspace,
    "-c",
    `model_reasoning_effort=${tomlString(effort)}`,
    "--output-last-message",
    outputPath,
    prompt,
  ];

  const result = await runProcessStreaming({ bin, args, cwd: workspace, stdoutPath, stderrPath });
  const finalOutput = readFileIfExists(outputPath);
  return {
    agent: "Codex CLI",
    bin,
    args: commandForLog(args, prompt),
    status: result.status ?? 1,
    error: result.error,
    signal: result.signal,
    stdout: readFileIfExists(stdoutPath),
    stderr: readFileIfExists(stderrPath),
    stdoutPath,
    stderrPath,
    finalOutput: firstNonEmpty(finalOutput, readFileIfExists(stdoutPath)),
  };
}

async function runClaudeCli({ prompt, workspace, run }) {
  const bin = process.env.AGENT_BRIDGE_CLAUDE_BIN || "claude";
  const model = process.env.AGENT_BRIDGE_CLAUDE_MODEL || "opus";
  const effort = process.env.AGENT_BRIDGE_CLAUDE_EFFORT || "medium";
  const permissionMode = process.env.AGENT_BRIDGE_CLAUDE_PERMISSION_MODE || "plan";
  const budget = process.env.AGENT_BRIDGE_CLAUDE_MAX_BUDGET_USD || "";
  const outputPath = resolve(run.runDir, "audit.md");
  const stdoutPath = resolve(run.runDir, "stdout.log");
  const stderrPath = resolve(run.runDir, "stderr.log");
  writeFileSync(outputPath, "", "utf8");
  preflightCommand(bin, ["--version"], "Claude CLI");
  preflightCommand(bin, ["auth", "status"], "Claude CLI auth");
  const args = ["-p", "--model", model];
  if (effort && commandHelpSupports(bin, "--effort")) args.push("--effort", effort);
  args.push("--permission-mode", permissionMode);
  if (budget) args.push("--max-budget-usd", budget);
  args.push(prompt);

  const result = await runProcessStreaming({ bin, args, cwd: workspace, stdoutPath, stderrPath });
  const finalOutput = firstNonEmpty(readFileIfExists(stdoutPath));
  if (finalOutput) writeFileSync(outputPath, `${finalOutput.trimEnd()}\n`, "utf8");
  return {
    agent: "Claude CLI",
    bin,
    args: commandForLog(args, prompt),
    status: result.status ?? 1,
    error: result.error,
    signal: result.signal,
    stdout: readFileIfExists(stdoutPath),
    stderr: readFileIfExists(stderrPath),
    stdoutPath,
    stderrPath,
    finalOutput,
  };
}

async function runCliDelivery({ direction, mode, workspace, prompt, run }) {
  const latestPath = latestOutputPath({ direction, mode, workspace });
  const result =
    direction === "to-codex"
      ? await runCodexCli({ prompt, workspace, run })
      : await runClaudeCli({ prompt, workspace, run });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = firstNonEmpty(result.stderr, result.stdout, `${result.agent} exited with status ${result.status}`);
    throw new Error(details);
  }

  if (!result.finalOutput.trim()) {
    throw new Error(`${result.agent} completed but produced no final output`);
  }

  writeFileSync(result.outputPath || resolve(run.runDir, "audit.md"), `${result.finalOutput.trimEnd()}\n`, "utf8");
  copyFileSync(resolve(run.runDir, "audit.md"), latestPath);
  console.log(`${result.agent} response saved: ${resolve(run.runDir, "audit.md")}`);
  console.log(`Latest response updated: ${latestPath}`);
  console.log("");
  console.log(result.finalOutput.trimEnd());
  return { outputPath: resolve(run.runDir, "audit.md"), latestPath, ...result };
}

let activeArgs = null;
let activeFilePath = null;
let activeRun = null;
let activeStartedAt = null;

try {
  if (process.argv[2] === "doctor") {
    runDoctor();
  }
  const args = parseArgs(process.argv);
  activeArgs = args;
  activeStartedAt = new Date().toISOString();
  const payload = args.stdin ? readStdin() : readClipboard();
  if (!payload.trim()) throw new Error("No transferred text found. Copy or select content first.");

  const run = createRun(args);
  activeRun = run;
  const filePath = writeTransferFile({ ...args, payload, run });
  activeFilePath = filePath;
  const prompt = promptFor({ mode: args.mode, filePath, delivery: args.delivery });

  console.log(`Run ID: ${run.runId}`);
  console.log(`Run directory: ${run.runDir}`);
  console.log(`Wrote ${basename(filePath)} (${modeLabel(args.mode)})`);
  console.log(filePath);
  writeRunJson(args.workspace, run, {
    runId: run.runId,
    status: "started",
    direction: args.direction,
    mode: args.mode,
    delivery: args.delivery,
    workspace: args.workspace,
    startedAt: activeStartedAt,
    handoffPath: filePath,
    runDir: run.runDir,
  });
  writeRunSummaryMd(run, {
    runId: run.runId,
    status: "started",
    direction: args.direction,
    mode: args.mode,
    delivery: args.delivery,
    workspace: args.workspace,
    startedAt: activeStartedAt,
    handoffPath: filePath,
  });
  writeBridgeLog(args.workspace, {
    event: "transfer_file_written",
    runId: run.runId,
    direction: args.direction,
    mode: args.mode,
    delivery: args.delivery,
    submitKey: args.submitKey,
    filePath,
  });

  if (args.dryRun) {
    const finishedAt = new Date().toISOString();
    const durationSeconds = Number(((new Date(finishedAt) - new Date(activeStartedAt)) / 1000).toFixed(3));
    const summary = {
      runId: run.runId,
      status: "dry-run",
      direction: args.direction,
      mode: args.mode,
      delivery: args.delivery,
      workspace: args.workspace,
      startedAt: activeStartedAt,
      finishedAt,
      durationSeconds,
      handoffPath: filePath,
      runDir: run.runDir,
    };
    writeRunJson(args.workspace, run, summary);
    writeRunSummaryMd(run, summary);
    if (args.delivery === "new") {
      console.log(buildUrl({ ...args, prompt }));
    } else if (args.delivery === "cli") {
      console.log(`Would run ${appNameFor(args.direction)} CLI audit path`);
      console.log(prompt);
    } else if (args.delivery === "ax") {
      console.log(`Would use AX automation into ${appNameFor(args.direction)} current conversation`);
      console.log(args.submit ? "Would submit after AX paste by clicking Send" : "Would not submit after AX paste");
      console.log(prompt);
    } else {
      console.log(`Would paste into ${appNameFor(args.direction)} current conversation`);
      console.log(args.submit ? `Would submit after paste with ${args.submitKey}` : "Would not submit after paste");
      console.log(prompt);
    }
  } else if (args.delivery === "cli") {
    writeBridgeLog(args.workspace, {
      event: "cli_start",
      runId: run.runId,
      direction: args.direction,
      mode: args.mode,
      app: appNameFor(args.direction),
    });
    const result = await runCliDelivery({ ...args, prompt, run });
    const finishedAt = new Date().toISOString();
    const durationSeconds = Number(((new Date(finishedAt) - new Date(activeStartedAt)) / 1000).toFixed(3));
    const summary = {
      runId: run.runId,
      status: "success",
      direction: args.direction,
      mode: args.mode,
      delivery: args.delivery,
      workspace: args.workspace,
      startedAt: activeStartedAt,
      finishedAt,
      durationSeconds,
      handoffPath: filePath,
      auditPath: result.outputPath,
      latestPath: result.latestPath,
      stdoutPath: result.stdoutPath,
      stderrPath: result.stderrPath,
      runDir: run.runDir,
      command: [result.bin, ...result.args],
    };
    writeRunJson(args.workspace, run, summary);
    writeRunSummaryMd(run, summary);
    writeRunMarker(run, "cli_done.json", {
      runId: run.runId,
      event: "cli_done",
      at: finishedAt,
      auditPath: result.outputPath,
      latestPath: result.latestPath,
      stdoutPath: result.stdoutPath,
      stderrPath: result.stderrPath,
    });
    writeBridgeLog(args.workspace, {
      event: "cli_done",
      runId: run.runId,
      direction: args.direction,
      mode: args.mode,
      app: appNameFor(args.direction),
      outputPath: result.outputPath,
      command: [result.bin, ...result.args],
    });
  } else if (args.delivery === "new") {
    writeBridgeLog(args.workspace, { event: "open_url_start", runId: run.runId, direction: args.direction, mode: args.mode });
    openUrl(buildUrl({ ...args, prompt }));
    writeBridgeLog(args.workspace, { event: "open_url_done", runId: run.runId, direction: args.direction, mode: args.mode });
  } else if (args.delivery === "ax") {
    writeBridgeLog(args.workspace, {
      event: "ax_start",
      runId: run.runId,
      direction: args.direction,
      mode: args.mode,
      app: appNameFor(args.direction),
      submit: args.submit,
      submitKey: args.submitKey,
    });
    const plan = pasteIntoAccessibleConversation({ ...args, prompt });
    writeBridgeLog(args.workspace, {
      event: "ax_done",
      runId: run.runId,
      direction: args.direction,
      mode: args.mode,
      app: appNameFor(args.direction),
      submit: args.submit,
      submitKey: args.submitKey,
      backend: plan.backend,
      inputX: plan.inputX,
      inputY: plan.inputY,
      sendX: plan.sendX,
      sendY: plan.sendY,
      window: plan.window,
    });
  } else {
    writeBridgeLog(args.workspace, {
      event: "paste_start",
      runId: run.runId,
      direction: args.direction,
      mode: args.mode,
      app: appNameFor(args.direction),
      submit: args.submit,
      submitKey: args.submitKey,
    });
    pasteIntoCurrentConversation({ ...args, prompt });
    writeBridgeLog(args.workspace, {
      event: "paste_done",
      runId: run.runId,
      direction: args.direction,
      mode: args.mode,
      app: appNameFor(args.direction),
      submit: args.submit,
      submitKey: args.submitKey,
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (activeArgs) {
    try {
      writeBridgeLog(activeArgs.workspace, {
        event: "bridge_error",
        runId: activeRun?.runId,
        direction: activeArgs.direction,
        mode: activeArgs.mode,
        delivery: activeArgs.delivery,
        app:
          activeArgs.delivery === "current" || activeArgs.delivery === "ax" || activeArgs.delivery === "cli"
            ? appNameFor(activeArgs.direction)
            : undefined,
        filePath: activeFilePath || undefined,
        message,
      });
      if (activeRun) {
        const finishedAt = new Date().toISOString();
        const durationSeconds = activeStartedAt
          ? Number(((new Date(finishedAt) - new Date(activeStartedAt)) / 1000).toFixed(3))
          : null;
        const summary = {
          runId: activeRun.runId,
          status: "error",
          direction: activeArgs.direction,
          mode: activeArgs.mode,
          delivery: activeArgs.delivery,
          workspace: activeArgs.workspace,
          startedAt: activeStartedAt,
          finishedAt,
          durationSeconds,
          handoffPath: activeFilePath || undefined,
          runDir: activeRun.runDir,
          error: message,
        };
        writeRunJson(activeArgs.workspace, activeRun, summary);
        writeRunSummaryMd(activeRun, summary);
        writeRunMarker(activeRun, "bridge_error.json", {
          runId: activeRun.runId,
          event: "bridge_error",
          at: finishedAt,
          message,
        });
      }
    } catch {
      // Avoid hiding the original bridge failure if logging also fails.
    }
  }
  console.error(message);
  process.exit(1);
}
