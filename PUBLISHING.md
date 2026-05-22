# Publishing Checklist

Use this checklist before publishing a release.

## Repository Setup

1. Confirm repository URLs point to the intended GitHub owner:

```bash
rg 'github.com/.*/claude-codex-bridge' README.md CONTRIBUTING.md package.json plugins/claude-codex-bridge/.codex-plugin/plugin.json
```

2. Create the GitHub repository if needed.
3. Initialize git locally if needed:

```bash
git init
git add .
git status --short
```

4. Confirm `.agent-bridge/` runtime data is not staged.

## Validation

```bash
npm run check
node agent-bridge/bridge.mjs doctor
```

Optional smoke test:

```bash
printf 'Claude result to audit' | node agent-bridge/bridge.mjs to-codex --stdin --delivery cli
```

## Release Notes

For the first public release, tag:

```bash
git tag v0.1.0
```

Publish with a short note:

```text
Initial CLI-first Claude/Codex bridge with durable run evidence, doctor checks,
Codex.app CLI fallback, and optional desktop App delivery modes.
```
