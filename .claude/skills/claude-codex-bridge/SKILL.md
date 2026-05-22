---
name: claude-codex-bridge
description: Bridge Claude Code and Codex for bidirectional execution review. Use when Claude should send its result to Codex/GPT-5.5 for audit, audit Codex/GPT-5.5 handoffs, return feedback to Codex, or run an automated Claude-Codex review loop.
---

# Claude Codex Bridge

Use this skill for bidirectional Claude-Codex review loops.

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

## Send Claude To Codex For Audit

When the user wants Codex/GPT-5.5 to audit Claude's latest work, create a concise handoff with:

- Original user goal.
- What was changed, including important file paths.
- Commands run and verification results.
- Anything uncertain, skipped, or risky.
- A direct request for Codex to audit correctness, completeness, safety, and missing verification, then automatically return the `Suggested Reply To Claude`.

Do not hide failed commands or partial work. Codex needs the sharp edges.

## Send To Codex

Send the handoff through the local bridge:

```bash
node "$HOME/.claude/skills/claude-codex-bridge/scripts/send-to-codex.mjs"
```

Pass the full handoff on stdin. The bridge writes a Markdown transfer file under
`.agent-bridge/inbox/`, writes durable run evidence under
`.agent-bridge/runs/<runId>/`, runs Codex CLI in read-only mode, and returns the
audit as command output in this same Claude conversation.

If the bridge script is missing, tell the user to install the global bridge runtime or run this from a workspace that contains `agent-bridge/bridge.mjs`.

## Audit Codex From Claude

When a bridge prompt asks Claude to audit Codex/GPT-5.5 execution, read the provided transfer file first. If no file path is provided, use the newest `.agent-bridge/inbox/*audit-codex-to-claude.md`.

Output:

```markdown
Findings
- [P0/P1/P2/P3] Concrete issue with file/command evidence when available.

Missing Verification
- Tests, commands, screenshots, or checks Codex should still run.

Suggested Reply To Codex
<a concise message the user can send back to Codex>
```

Prioritize behavioral bugs, incomplete work, risky commands, missing validation, and places where Codex claimed success without evidence. If no issues are found, say so clearly and still mention residual risk.

Default CLI path: read the newest handoff, produce the audit, and leave the
result in `.agent-bridge/runs/<runId>/audit.md` plus
`.agent-bridge/outbox/latest-claude-audit.md`. The command output is already the
return path to this conversation.

Only when using App delivery modes, write `Suggested Reply To Codex` to:

```text
.agent-bridge/outbox/latest-reply-to-codex.md
```

Then run:

```bash
node "$HOME/.claude/skills/claude-codex-bridge/scripts/send-file-to-codex.mjs" .agent-bridge/outbox/latest-reply-to-codex.md
```

If the command exits successfully, say the bridge sent paste/submit automation
to Codex. If it fails, include the error and do not claim Codex received the
feedback. If the user says "only audit", "do not forward", or equivalent, stop
after showing the audit.
