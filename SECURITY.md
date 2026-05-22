# Security Policy

Claude-Codex Bridge is local automation. It may invoke Claude Code CLI, Codex
CLI, macOS URL schemes, and optional macOS Accessibility automation.

## Supported Versions

Security fixes target the latest `main` branch until release tags are
introduced.

## Reporting a Vulnerability

Please open a private security advisory on GitHub, or contact the maintainers
through the repository's published security contact once configured.

Do not include private handoff content, logs, credentials, or unpublished user
data in public issues.

## Local Data

Bridge runs are written under:

```text
.agent-bridge/
```

These files may contain prompts, audit results, command logs, local paths, and
other sensitive project information. `.agent-bridge/` is ignored by git and
should not be committed.

## Permissions

The recommended `cli` delivery mode does not operate desktop windows. The
`current`, `new`, and `ax` modes may activate apps, paste text, open URL
schemes, or use macOS Accessibility automation. Use those modes only when you
intend to operate desktop apps.

