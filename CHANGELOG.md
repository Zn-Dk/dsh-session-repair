# Changelog

遵循 Keep a Changelog，版本号遵循 SemVer。

## [0.2.0] - 2026-08-22

### 变更
- Host 半区从 JavaScript 源码迁移为 TypeScript（`src/*.ts` 经 tsc 编译到 `lib/*.js`），Client bundle 保持手写 JS（`window.__ModuleLoader__` 运行时注入格式）。
- 新增 `tsconfig.json` 与 `build`/`prepack`/`test` 脚本；测试迁移为 `.ts` 并由 `tsx` 运行。

## [0.1.0] - 2026-08-22

### 新增
- 当前会话 header「会话体检」入口。
- raw storage 诊断、可信 checkpoint、pre-repair backup 和审计记录。
- 已知空 tool-call ID 链的确定性安全修复。
- 报告面板提供「备份并修复」按钮，修复前确认并展示结果。
- 开发阶段支持目录 link，发布阶段保留 tgz 安装验收。
- 随插件发布并注册的 dsh-session-repair Skill。

### 修复
- 修复按钮从「恰好 1 条确定性计划」放宽为「≥1 条」，多条独立空 tool-call ID 链可一次性批量修复。
- 报告面板诊断 JSON 区域高度下调 50px，避免 dialog 溢出滚动。
- 重新界定 healthy/warning：`seq-gap` 降为 info 观察项（DSH chunk 事件消耗 seq 但不落盘，gap 是结构常态）；live 会话未闭合的 turn/step 记为 info，仅已结束历史的未闭合结构计为 warning。

### 已知限制
- 外部 backup-sessions 仅作 legacy 取证，不自动恢复。
- 插件安装前且没有 trusted checkpoint 的损坏历史不承诺可恢复。
- MVP 不处理删除、归档、批量扫描或未知 schema 自动修复。
