# Claude-Codex Bridge

Claude-Codex Bridge 是一个开源的 Claude 与 Codex 双向互通审计、检验工具。

它的目标很简单：让一个模型完成任务后，自动交给另一个模型做第二意见审查，帮助减少模型幻觉、查漏补据、发现没有验证就声称完成的问题。

它支持：

- Claude 执行，Codex 审计。
- Codex 执行，Claude 审计。
- App to CLI：默认模式，在同一个对话窗口里调用另一个 agent 的 CLI，审计结果直接回到当前对话。
- App to App：保留桌面 App 粘贴/新建对话等模式，适合特殊场景。
- CLI to CLI：纯命令行审计链路，适合自动化和工程验证。

## 为什么需要这个工具

Claude Code 和 Codex 都很强，但单个模型执行复杂任务时，常见风险包括：

- 声称完成，但没有实际验证。
- 修改了文件，但漏掉边界情况。
- 只修了表面问题，没有查根因。
- 忽略失败命令或未说明残余风险。
- 在长任务里产生幻觉式总结。

Claude-Codex Bridge 的作用是把“第二模型审计”变成一个可重复的流程，而不是靠用户手动复制粘贴。

## 默认工作流

默认推荐 **App to CLI**。

例如你在 Claude Code 里工作：

```text
Claude 当前对话
  -> 打包本轮执行结果
  -> 调用 Codex CLI
  -> Codex 做审计
  -> 审计结果回到 Claude 当前对话
```

反过来也一样：

```text
Codex 当前对话
  -> 打包本轮执行结果
  -> 调用 Claude CLI
  -> Claude 做审计
  -> 审计结果回到 Codex 当前对话
```

这样用户不需要在两个 App 之间反复复制粘贴，也不需要新开很多对话。

## 支持的投递模式

默认模式：

```bash
--delivery cli
```

含义：当前 App 对话调用另一个 agent 的 CLI，审计结果返回当前对话。

保留模式：

```bash
--delivery current
--delivery new
--delivery ax
```

这些是桌面 App 自动化模式，用于把内容投递到 Claude/Codex App 当前窗口或新窗口。它们依赖 macOS App/Accessibility 权限，稳定性不如 CLI 路径，因此不是默认推荐。

## 每轮审计都有证据

每次 CLI 审计都会生成一个 `runId`，并保存完整证据：

```text
.agent-bridge/runs/<runId>/
  handoff.md
  audit.md
  stdout.log
  stderr.log
  summary.json
  summary.md
  cli_done.json 或 bridge_error.json
```

你可以用：

```bash
cat .agent-bridge/runs/latest.json
```

查看最近一轮是否成功。

判断标准：

- `status: success` 且存在 `cli_done.json`：审计完成。
- `status: error` 且存在 `bridge_error.json`：审计失败，但错误已记录。
- `status: started`：仍在运行，或进程被中断。

## 安装

```bash
git clone https://github.com/Jayden-X-L/claude-codex-bridge.git
cd claude-codex-bridge
npm run check
node agent-bridge/bridge.mjs doctor
node agent-bridge/install-global.mjs
```

安装完成后，重启 Claude Code 和 Codex，让它们重新发现 skill/plugin。

## 前置条件

需要：

- macOS
- Node.js 18+
- Claude Code CLI
- Codex CLI，或者安装了 Codex Desktop App

如果不知道本机是否满足条件，运行：

```bash
node ~/.agent-bridge/bridge.mjs doctor
```

`doctor` 会检查：

- Node.js
- bridge runtime
- Codex CLI
- Codex Desktop 内置 CLI
- Claude CLI
- Claude auth

如果缺东西，它会给出安装或登录命令。

常见修复：

```bash
npm install -g @openai/codex
npm install -g @anthropic-ai/claude-code
claude auth login
claude auth status
```

如果你安装了 Codex Desktop，bridge 也可以直接使用：

```text
/Applications/Codex.app/Contents/Resources/codex
```

## 在 Claude 里使用

在 Claude Code 里说：

```text
使用 claude-codex-bridge，把本轮执行结果发给 Codex 审计。
```

或者：

```text
Use claude-codex-bridge to send this work to Codex for audit.
```

## 在 Codex 里使用

在 Codex 里说：

```text
使用 claude-codex-bridge，把本轮执行结果发给 Claude 审计。
```

或者：

```text
Use claude-codex-bridge to send this work to Claude for audit.
```

## 手动测试

Claude -> Codex 审计：

```bash
printf 'Claude result to audit' | node agent-bridge/bridge.mjs to-codex --stdin --delivery cli
```

Codex -> Claude 审计：

```bash
printf 'Codex result to audit' | node agent-bridge/bridge.mjs to-claude --mode audit-codex --stdin --delivery cli
```

## 适合谁

这个工具适合：

- 经常用 Claude Code / Codex 做复杂工程任务的人。
- 希望让另一个模型审计执行结果的人。
- 希望减少模型幻觉和遗漏验证的人。
- 希望保留每轮审计证据、方便追踪问题的人。

## 不是什么

它不是一个完整多 agent runtime。

它也不会替你判断所有问题。它做的是把 Claude/Codex 之间的审计交接标准化、自动化，并留下证据。

