#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);

function copyDir(src, dest, options = {}) {
  if (!existsSync(src)) throw new Error(`Missing source: ${src}`);
  if (existsSync(dest)) {
    const backup = options.backupDir ? join(options.backupDir, `${basename(dest)}.backup-${stamp}`) : `${dest}.backup-${stamp}`;
    if (options.backupDir) mkdirSync(options.backupDir, { recursive: true });
    renameSync(dest, backup);
    console.log(`Backed up ${dest} -> ${backup}`);
  }
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const from = join(src, entry);
    const to = join(dest, entry);
    if (statSync(from).isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}

function updateMarketplace(path) {
  mkdirSync(dirname(path), { recursive: true });
  const entry = {
    name: "claude-codex-bridge",
    source: { source: "local", path: "./plugins/claude-codex-bridge" },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Productivity",
  };
  const payload = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : {
        name: "local-agent-bridge",
        interface: { displayName: "Local Agent Bridge" },
        plugins: [],
      };

  payload.plugins = Array.isArray(payload.plugins) ? payload.plugins : [];
  const index = payload.plugins.findIndex((plugin) => plugin?.name === entry.name);
  if (index >= 0) payload.plugins[index] = entry;
  else payload.plugins.push(entry);

  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function moveClaudeSkillBackups(home) {
  const skillsDir = join(home, ".claude", "skills");
  if (!existsSync(skillsDir)) return;
  const backupDir = join(home, ".claude", "skill-backups");
  mkdirSync(backupDir, { recursive: true });

  for (const entry of readdirSync(skillsDir)) {
    if (!entry.startsWith("claude-codex-bridge.backup-")) continue;
    const from = join(skillsDir, entry);
    let to = join(backupDir, entry);
    if (existsSync(to)) to = join(backupDir, `${entry}.moved-${stamp}`);
    renameSync(from, to);
    console.log(`Moved Claude skill backup ${from} -> ${to}`);
  }
}

const home = homedir();
moveClaudeSkillBackups(home);
copyDir(
  join(root, ".claude", "skills", "claude-codex-bridge"),
  join(home, ".claude", "skills", "claude-codex-bridge"),
  { backupDir: join(home, ".claude", "skill-backups") },
);
copyDir(join(root, "plugins", "claude-codex-bridge"), join(home, "plugins", "claude-codex-bridge"));
copyDir(join(root, "agent-bridge"), join(home, ".agent-bridge"));
updateMarketplace(join(home, ".agents", "plugins", "marketplace.json"));

console.log("");
console.log("Installed:");
console.log(`- Claude skill: ${join(home, ".claude", "skills", "claude-codex-bridge")}`);
console.log(`- Codex plugin: ${join(home, "plugins", "claude-codex-bridge")}`);
console.log(`- Bridge runtime: ${join(home, ".agent-bridge")}`);
console.log(`- Codex marketplace: ${join(home, ".agents", "plugins", "marketplace.json")}`);
console.log("");
console.log("Restart Claude Code and Codex so they discover the new skill/plugin.");
