---
name: claude-codex-bridge
description: Bridge Codex and Claude for bidirectional execution review. Use when Codex should audit Claude handoffs, send Codex/GPT-5.5 execution results to Claude for audit, forward audit feedback, inspect .agent-bridge/inbox files, or run an automated Claude-Codex review loop.
---

# Claude Codex Bridge

Use this workflow for bidirectional Claude-Codex review loops.

- Claude execution -> Codex audit -> Claude repair feedback.
- Codex execution -> Claude audit -> Codex repair feedback.

Default to automatic return after audit unless the user explicitly asks for audit-only mode.

Bridge delivery defaults to `cli` mode through the helper scripts. In `cli`
mode, the target CLI performs the audit and prints the result back into this
same conversation; do not use desktop App automation.

CLI runs are tracked under `.agent-bridge/runs/<runId>/`. Use
`.agent-bridge/runs/latest.json` to inspect the latest run. A completed run has
`status: success` and `cli_done.json`; a failed run has `status: error` and
`bridge_error.json`. If a run still says `status: started`, it is in progress
or was interrupted; do not treat that as a successful audit.

CLI preconditions: Codex CLI must be runnable for Codex audits. The bridge tries
`AGENT_BRIDGE_CODEX_BIN`, then `codex` from PATH, then
`/Applications/Codex.app/Contents/Resources/codex`. `claude --version` plus
`claude auth status` must work for Claude audits. If the Claude auth preflight
fails, tell the user to run Claude Code login/status rather than treating it as
an App handoff failure.

If a CLI is missing or auth fails, run:

```bash
node "$HOME/.agent-bridge/bridge.mjs" doctor
```

Use the doctor's suggested fix. Common fixes are:

```bash
npm install -g @openai/codex
npm install -g @anthropic-ai/claude-code
claude auth login
claude auth status
```

If Codex Desktop is installed, the bridge can use
`/Applications/Codex.app/Contents/Resources/codex` without an npm Codex install.

Use `--delivery current`, `--delivery ax`, or `--delivery new` only when the
user explicitly asks to operate the desktop App UI. In `ax` or `current` mode,
treat bridge success as macOS paste/submit automation completion. If the bridge
reports a focus error or non-zero exit, do not tell the user the feedback was
delivered; report the error and ask them to bring the target app conversation to
the front before retrying.

## Audit Claude From Codex

When the user asks Codex to audit Claude, find the handoff content in this order:

1. Use any file path the user gives.
2. Otherwise use the newest `.agent-bridge/inbox/*audit-claude-to-codex.md` file in the current workspace.
3. If no file exists, ask the user to run the Claude handoff bridge first.

Read the entire handoff file before judging the result.

Output:

```markdown
Findings
- [P0/P1/P2/P3] Concrete issue with file/command evidence when available.

Missing Verification
- Tests, commands, screenshots, or checks Claude should still run.

Suggested Reply To Claude
<a concise message the user can send back to Claude>
```

Default CLI path: read the newest handoff, produce the audit, and leave the
result in `.agent-bridge/runs/<runId>/audit.md` plus
`.agent-bridge/outbox/latest-codex-audit.md`. The command output is already the
return path to this conversation.

Only when using App delivery modes, write `Suggested Reply To Claude` to
`.agent-bridge/outbox/latest-reply-to-claude.md`, then run:

```bash
node "$HOME/plugins/claude-codex-bridge/scripts/send-file-to-claude.mjs" .agent-bridge/outbox/latest-reply-to-claude.md
```

If the command exits successfully in an App delivery mode, say the bridge sent
paste/submit automation to Claude. If it fails, include the error and do not
claim Claude received the feedback.

## Send Codex To Claude For Audit

When the user asks Claude to audit Codex/GPT-5.5 execution, create a handoff with:

- Original user goal.
- What Codex changed, including file paths.
- Commands run and verification results.
- Anything uncertain, skipped, or risky.
- A direct request for Claude to audit correctness, completeness, safety, and missing verification, then return `Suggested Reply To Codex`.

Send the handoff through the default CLI path:

```bash
node "$HOME/plugins/claude-codex-bridge/scripts/send-to-claude-for-audit.mjs"
```

Pass the full handoff on stdin. Claude CLI is expected to audit and return the
feedback as command output in this same Codex conversation.

## Shared Audit Rules

For either direction, prioritize behavioral bugs, incomplete work, risky commands, missing validation, and places where the executing agent claimed success without evidence. If no issues are found, say so clearly and still mention residual risk.

Use this audit shape:

```markdown
Findings
- [P0/P1/P2/P3] Concrete issue with file/command evidence when available.

Missing Verification
- Tests, commands, screenshots, or checks Claude should still run.

Suggested Reply To <Agent>
<a concise message the user can send back to the executing agent>
```

If the user says "only audit", "do not forward", or equivalent, stop after showing the audit.
