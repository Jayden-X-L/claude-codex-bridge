# Claude-Codex Bridge

This is a local macOS bridge for forwarding execution handoffs and audit
feedback between Claude Code Desktop and Codex.

## What it does

- Claude execution -> Codex audit -> Claude repair feedback.
- Codex execution -> Claude audit -> Codex repair feedback.
- Long payloads are stored in `.agent-bridge/inbox`; final replies are stored
  in `.agent-bridge/outbox`; each CLI run also gets a durable evidence folder
  under `.agent-bridge/runs/<runId>/`.

The bridge supports four delivery modes:

- `cli`: invoke the target CLI and return the audit result to the current
  caller. This is now the recommended default because it avoids desktop focus,
  new App conversations, and manual send buttons.
- `ax`: activate the target app, click the current conversation input area with
  macOS UI automation, paste, then click Send with a key fallback.
- `current`: legacy current-conversation mode that pastes and submits with
  keystrokes.
- `new`: open a new/pre-filled destination thread through the app's URL scheme.

The skill/plugin wrapper scripts and raw `bridge.mjs` calls now default to
`cli`. Use `--delivery current`, `--delivery ax`, or `--delivery new` only when
you explicitly want to operate the desktop App UI.

Rollback note: before this CLI-first change, helper scripts defaulted to
`current` and raw `bridge.mjs` calls defaulted to `new`. Existing App-based
automations can keep the old behavior by passing `--delivery current` or
`--delivery new`, or by setting `AGENT_BRIDGE_DELIVERY=current`.

Backward-compatible aliases still work:

- `command` / `terminal` = `cli`
- `accessibility` / `ui` = `ax`
- `paste` = `current`
- `deeplink` = `new`

CLI defaults can be tuned with environment variables:

- Codex: `AGENT_BRIDGE_CODEX_MODEL` (default `gpt-5.5`),
  `AGENT_BRIDGE_CODEX_EFFORT` (default `medium`), and
  `AGENT_BRIDGE_CODEX_SANDBOX` (default `read-only`).
- Claude: `AGENT_BRIDGE_CLAUDE_MODEL` (default `opus`),
  `AGENT_BRIDGE_CLAUDE_EFFORT` (default `medium`),
  `AGENT_BRIDGE_CLAUDE_PERMISSION_MODE` (default `plan`), and optional
  `AGENT_BRIDGE_CLAUDE_MAX_BUDGET_USD`.
- CLI output is streamed to files instead of buffered in memory, so verbose
  `codex exec` runs should not trigger Node `spawnSync ENOBUFS` failures.

CLI preconditions:

- Codex CLI must be runnable and logged in. The bridge first tries
  `AGENT_BRIDGE_CODEX_BIN`, then `codex` from PATH, then the Codex desktop app's
  bundled binary at `/Applications/Codex.app/Contents/Resources/codex`.
- `claude --version` and `claude auth status` must work. If `claude auth status`
  fails, run Claude Code login first; the bridge treats that as an expected
  preflight failure, not as a desktop App delivery problem.
- Smoke tests may intentionally override the production defaults, for example
  `AGENT_BRIDGE_CODEX_MODEL=gpt-5.4-mini AGENT_BRIDGE_CODEX_EFFORT=low` or
  `AGENT_BRIDGE_CLAUDE_MODEL=sonnet AGENT_BRIDGE_CLAUDE_EFFORT=low`, to keep
  validation fast and inexpensive. Omit those overrides to use the defaults.

In `ax` mode, the bridge submits by clicking the visible Send button. In
`current` mode, the bridge submits with `Command+Return` when the target is
Codex and plain `Return` when the target is Claude. Override current mode with
`--submit-key enter`, `--submit-key cmd-enter`, or `--no-submit`.

Before pasting, `ax` and `current` modes try to bring the target app to the front
and verifies it is still the frontmost app. If another app steals focus, the
bridge exits with an error and writes `bridge_error` to the log instead of
claiming the handoff was delivered.

`ax` mode writes `ax_start` and `ax_done` events with the window geometry used
for the click plan. It is the experimental path toward one-click handoff because
it uses the visible input/send controls instead of only sending Return.

Delivery diagnostics are written to `.agent-bridge/logs/bridge.log`. CLI events
include a `runId` that matches `.agent-bridge/runs/<runId>/`.

Each CLI run writes:

- `handoff.md`: exact transferred request.
- `audit.md`: final target-agent answer.
- `stdout.log` and `stderr.log`: streamed raw process logs.
- `summary.json` and `summary.md`: status, timing, command, and file paths.
- `cli_done.json` or `bridge_error.json`: terminal marker for automation.

Use `.agent-bridge/runs/latest.json` to find the latest run. When auditing a run
that is still in progress, expect `status: started`; wait for `status: success`
or `status: error`, or for `cli_done.json` / `bridge_error.json`, before judging
whether the bridge completed.

Deep links:

- Codex: `codex://new?path=...&prompt=...`
- Claude Code: `claude://code/new?folder=...&q=...`

For long outputs, the full content is stored in a local Markdown file and the
destination prompt points the agent to that file.

## Manual Test

Run local diagnostics first:

```bash
node ~/.agent-bridge/bridge.mjs doctor
```

`doctor` checks Node.js, bridge runtime, Codex CLI candidates, Claude CLI, and
Claude auth. If something is missing, it prints the install/login command to
run next.

```bash
printf 'sample Claude result' | node agent-bridge/bridge.mjs to-codex --stdin --dry-run
printf 'sample Codex audit' | node agent-bridge/bridge.mjs to-claude --stdin --dry-run
printf 'sample Codex result' | node agent-bridge/bridge.mjs to-claude --mode audit-codex --stdin --dry-run
printf 'sample Claude audit' | node agent-bridge/bridge.mjs to-codex --mode feedback-to-codex --stdin --dry-run
```

Add `--delivery current`, `--delivery ax`, or `--delivery new` to test the App
automation paths. Remove `--dry-run` to actually send to the chosen target.

## One-Click Setup

Use either `send-to-codex.command` or `send-to-claude.command` from macOS
Shortcuts, Automator, Raycast, Alfred, or Keyboard Maestro.

Recommended hotkeys:

- Claude -> Codex: `Cmd+Option+Control+C`
- Codex -> Claude: `Cmd+Option+Control+V`

On first use, macOS may ask for Accessibility and Automation permission because
the wrapper sends `Cmd+C` to the frontmost app.

## Skill And Plugin Setup

This workspace also includes:

- Claude project skill: `.claude/skills/claude-codex-bridge/SKILL.md`
- Codex plugin: `plugins/claude-codex-bridge/`

From Claude Code, invoke:

```text
/claude-codex-bridge
```

The default flow is now CLI-based:

1. Claude packages the result and runs Codex CLI.
2. Codex audits the handoff in read-only mode.
3. The bridge writes `.agent-bridge/runs/<runId>/audit.md` and also updates
   `.agent-bridge/outbox/latest-codex-audit.md`.
4. Claude receives the audit text as command output in the same conversation.

Reverse flow from Codex:

1. Ask Codex to use `claude-codex-bridge` to send its execution result to
   Claude for audit.
2. Claude audits the handoff through Claude CLI in plan mode.
3. The bridge writes `.agent-bridge/runs/<runId>/audit.md` and also updates
   `.agent-bridge/outbox/latest-claude-audit.md`.
4. Codex receives the audit text as command output in the same conversation.

Manual Codex prompt, if needed:

```text
Audit the latest Claude handoff
```

Quick CLI smoke tests:

```bash
printf 'Claude result to audit' | node plugins/claude-codex-bridge/scripts/send-to-codex.mjs --delivery cli
printf 'Codex result to audit' | node plugins/claude-codex-bridge/scripts/send-to-claude-for-audit.mjs --delivery cli
```

If you want a bounded Claude CLI test, set
`AGENT_BRIDGE_CLAUDE_MAX_BUDGET_USD`. Very low values can fail before the audit
finishes; that is a budget failure, not a bridge focus failure.

To install the Claude skill and Codex plugin globally for this Mac, run:

```bash
node agent-bridge/install-global.mjs
```

Then restart Claude Code and Codex.

## App Conversation Modes

Keep the desired Claude or Codex conversation open before running the bridge.
Because `ax` and `current` modes use macOS UI automation, the first run may ask
for Accessibility or Automation permission. If the target app is not in the
expected conversation, use `--delivery new` to intentionally start a new thread.

If a handoff fails with a focus error, bring the target conversation window to
the front or close any always-on-top app that is taking focus, then retry. The
log confirms that paste/submit automation ran; the model response itself still
depends on the destination app accepting the submitted text.
