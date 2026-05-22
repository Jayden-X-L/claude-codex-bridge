#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const workspace = process.env.AGENT_BRIDGE_WORKSPACE || process.cwd();
const fileArg = process.argv[2];
const extraArgs = process.argv.slice(3);
const deliveryArgs = extraArgs.some(
  (arg) =>
    arg === "--delivery" ||
    arg.startsWith("--delivery=") ||
    arg === "--ax" ||
    arg === "--current" ||
    arg === "--new" ||
    arg === "--paste" ||
    arg === "--deeplink",
)
  ? []
  : ["--delivery", process.env.AGENT_BRIDGE_DELIVERY || "cli"];

if (!fileArg) {
  console.error("Usage: node .claude/skills/claude-codex-bridge/scripts/send-file-to-codex.mjs <reply-file>");
  process.exit(2);
}

const replyFile = resolve(workspace, fileArg);
const bridge =
  [resolve(workspace, "agent-bridge", "bridge.mjs"), resolve(homedir(), ".agent-bridge", "bridge.mjs")].find(
    existsSync,
  ) ?? null;

if (!existsSync(replyFile)) {
  console.error(`Cannot find reply file at ${replyFile}`);
  process.exit(1);
}

if (!bridge) {
  console.error("Cannot find bridge script in workspace or ~/.agent-bridge");
  process.exit(1);
}

const payload = readFileSync(replyFile, "utf8");
if (!payload.trim()) {
  console.error(`Reply file is empty: ${replyFile}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [bridge, "to-codex", "--mode", "feedback-to-codex", "--workspace", workspace, "--stdin", ...deliveryArgs, ...extraArgs],
  {
    input: payload,
    stdio: ["pipe", "inherit", "inherit"],
    encoding: "utf8",
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
