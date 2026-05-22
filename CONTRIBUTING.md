# Contributing

Thanks for helping improve Claude-Codex Bridge.

## Development Setup

```bash
git clone https://github.com/Jayden-X-L/claude-codex-bridge.git
cd claude-codex-bridge
npm run check
node agent-bridge/bridge.mjs doctor
```

This project intentionally avoids runtime npm dependencies. Prefer Node.js
standard library APIs unless a dependency removes substantial complexity.

## Before Opening a PR

Run:

```bash
npm run check
node agent-bridge/bridge.mjs doctor
```

For CLI behavior changes, include a smoke test summary and the relevant
`.agent-bridge/runs/<runId>/summary.json` fields. Do not commit `.agent-bridge`
runtime data.

## Design Principles

- Keep the CLI path reliable and non-GUI by default.
- Preserve desktop App delivery modes as explicit fallbacks.
- Keep all run evidence local and inspectable.
- Fail loudly when CLI/auth prerequisites are missing.
- Never claim a bridge handoff succeeded unless `summary.status` is `success`
  and `cli_done.json` exists.

## Commit Hygiene

- Do not commit local inbox/outbox/runs/log files.
- Avoid machine-specific absolute paths in source.
- Keep user-specific credentials and auth state out of the repo.
