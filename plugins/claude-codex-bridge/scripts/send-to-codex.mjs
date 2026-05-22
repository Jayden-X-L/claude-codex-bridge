#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const workspace = process.env.AGENT_BRIDGE_WORKSPACE || process.cwd();
const extraArgs = process.argv.slice(2);
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
const bridge =
  [resolve(workspace, "agent-bridge", "bridge.mjs"), resolve(homedir(), ".agent-bridge", "bridge.mjs")].find(
    existsSync,
  ) ?? null;

if (!bridge) {
  console.error("Cannot find bridge script in workspace or ~/.agent-bridge");
  process.exit(1);
}

const result = spawnSync(process.execPath, [bridge, "to-codex", "--workspace", workspace, "--stdin", ...deliveryArgs, ...extraArgs], {
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
