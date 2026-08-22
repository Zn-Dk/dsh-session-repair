# dsh-session-repair

DSH Web 会话诊断、可信 checkpoint、pre-repair backup 与安全修复插件。

## 安装

开发或构建前必须先在插件目录执行：

    pnpm install

### 开发阶段：使用 link 实时观察源码

当前版本尚未对外发布，开发阶段按 dsh-session-archive 的模式使用目录 link：

    cd /root/proj/dsh-proj/dsh-session-repair
    pnpm install
    pnpm dsh plugin --profile web add link:/root/proj/dsh-proj/dsh-session-repair

修改源码后重启现有 dsh web；不要启动替代服务器。若同时运行 deepseek-harness 的 dev:web watcher，Client bundle 可通过现有 HMR 接收更新。

### 发布阶段：再用 tarball 验收

对外发布前才执行：

    pnpm test
    pnpm pack
    dsh plugin --profile web add ./dsh-session-repair-0.1.0.tgz

发布包安装后重启现有 dsh web，再刷新 http://127.0.0.1:3080。

## 状态分级

诊断报告的 `severity` 由检查项汇总而来，用于决定是否显示可写修复入口：

| status | case-when |
| --- | --- |
| `healthy` | 无 blocked/repairable/warning 检查项。`seq-gap` 与 live 会话中未闭合的 turn/step 仅作 info 观察项，不抬高等级。 |
| `warning` | 已结束（非 live）的历史存在未闭合的 turn/step 结构，或有其他潜在问题。可读、不提供写入修复。 |
| `repairable` | 存在确定性可修复问题（如空 tool-call ID 链），可提交修复计划。 |
| `blocked` | 会话无法正常展示，且存在无法自动修复的硬冲突（如 ID 冲突、zstd 损坏、会话不匹配）。 |

## 使用

打开任意会话，在 Chat header 点击「会话体检」。当报告为 repairable 且至少有一条确定性修复计划时，面板会显示「备份并修复」按钮，并列出全部待修 seq 链。点击后先确认目标 seq 和 pre-repair backup，再一次性执行修复并重新校验；歧义、live、文件变化或其他 blocked 状态不会显示可写修复按钮。

健康会话中也可以输入 /dsh-session-repair，或调用 dsh_session_repair 并传入旧 sessionId 来诊断 history unavailable 会话。

## 安全边界

Host 先读取 raw storage，再决定是否调用引擎展示接口。Client 不直接触碰 ~/.dsh，也不能提交任意 JSON patch。修复使用 batchId 与 artifact fingerprint，修复前必生成 pre-repair backup，复验成功后才原子替换。多条独立空 ID 链在一次性批次中修复；歧义、zstd 损坏、文件变化、live/追加中的会话一律不写入。live 会话通过 `ctx.get('sessions')` / `ctx.get('agents')` 判定，其未闭合的 turn/step 属正常追加状态，仅记为 info。

插件自有数据位于 ~/.dsh/session-repair/，包括 backups 和 audit。外部 ~/.dsh/backup-sessions-* 目录只作为 legacy 取证与比较来源，默认不自动恢复。

## 当前实现状态

当前仓库已包含 raw zstd/JSONL 诊断、tool-call ID 检查、确定性 repair plan、checkpoint/pre-repair backup 写入、RPC、Agent tool、header 报告面板和随包 Skill。MVP 未完成端点会返回明确的 not-implemented，不会伪装成功。

## 第三方边界

本插件不依赖、不修改、不融合 dsh-session-archive 或 dsh-session-manager。Skill 与插件同名但属于不同注册表；Skill 随包发布在 skills/dsh-session-repair/SKILL.md，由 Host runtime 注册，不单独发布、不使用 submodule、不默认软链接。
