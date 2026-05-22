# Claude-Codex Bridge

中文介绍: [README.zh-CN.md](README.zh-CN.md)

Claude-Codex Bridge is an open-source bridge for bidirectional review workflows
between Claude Code and Codex. It helps developers use one model to audit,
verify, and challenge another model's work, reducing hallucinated completion,
missing evidence, and unverified claims.

It supports App-to-App, App-to-CLI, and CLI-to-CLI handoffs. The recommended
default is App-to-CLI: stay in the same Claude/Codex conversation, call the
other agent through its CLI for a second opinion, and receive the audit result
back in the current conversation.

Claude-Codex Bridge is a local, CLI-first workflow for running bidirectional
second-opinion reviews between Claude Code and Codex.

The default path does not operate desktop windows. It packages a handoff,
invokes the target CLI, streams raw logs to disk, and returns the audit result
to the current conversation.

## Highlights

- Claude execution -> Codex audit.
- Codex execution -> Claude audit.
- App-to-CLI by default, with optional App-to-App delivery modes.
- Same-conversation audit return when using the CLI path.
- Helps reduce model hallucination, missing verification, and unsupported
  "done" claims.
- Durable run evidence under `.agent-bridge/runs/<runId>/`.
- `doctor` command for CLI/auth preflight checks and installation guidance.
- No runtime npm dependencies.

## Quick Start

```bash
git clone https://github.com/Jayden-X-L/claude-codex-bridge.git
cd claude-codex-bridge
npm run check
node agent-bridge/bridge.mjs doctor
node agent-bridge/install-global.mjs
```

Restart Claude Code and Codex after installation so they discover the skill and
plugin.

## Prerequisites

- macOS.
- Node.js 18 or newer.
- Claude Code CLI, authenticated with `claude auth status`.
- Codex CLI, or Codex Desktop with bundled CLI at:

```text
/Applications/Codex.app/Contents/Resources/codex
```

Run:

```bash
node ~/.agent-bridge/bridge.mjs doctor
```

If something is missing, doctor prints the next command to run.

## Use

From Claude Code, ask:

```text
Use claude-codex-bridge to send this work to Codex for audit.
```

From Codex, ask:

```text
Use claude-codex-bridge to send this work to Claude for audit.
```

Manual smoke tests:

```bash
printf 'Claude result to audit' | node agent-bridge/bridge.mjs to-codex --stdin --delivery cli
printf 'Codex result to audit' | node agent-bridge/bridge.mjs to-claude --mode audit-codex --stdin --delivery cli
```

## Run Evidence

Each CLI run writes:

```text
.agent-bridge/runs/<runId>/
  handoff.md
  audit.md
  stdout.log
  stderr.log
  summary.json
  summary.md
  cli_done.json or bridge_error.json
```

Use `.agent-bridge/runs/latest.json` to inspect the latest run. If a run still
says `status: started`, it is in progress or was interrupted; wait for
`status: success` or `status: error`.

## Delivery Modes

The default mode is:

```bash
--delivery cli
```

Desktop App modes are still available for specialized workflows:

```bash
--delivery current
--delivery new
--delivery ax
```

These modes use macOS App/Accessibility automation and may require user
permissions. CLI mode is recommended for reliability.

## Documentation

- Runtime details: [agent-bridge/README.md](agent-bridge/README.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security: [SECURITY.md](SECURITY.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
