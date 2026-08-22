# Changelog

遵循 Keep a Changelog，版本号遵循 SemVer。

## [0.5.0] - 2026-08-22

### 新增
- 备份改为单槽模型：每次 repair 只保留一份 pre-repair 回滚点（覆盖式），不再累积多份。
- `restoreBackup` 端点：repairable/blocked 会话可一键恢复到最近一次修复前，全套安全边界（live 拒绝 + pre-restore 备份 + 原子替换 + 复验 + 审计），恢复成功后自动清空 safety 槽。
- `clearBackups` 端点：手动清空 safety 备份。

### 修复
- `listBackups`/`compareBackup` 误用 projectKey 的 bug 已修；inspect 在 healthy/warning 且非 live 时自动清理 safety 备份并记录 `cleanedBackups`。
- 备份相关按钮互斥：有备份时只显示「恢复上次修复前」+「清空备份」，无备份时显示「备份并修复」，避免三按钮同现。

## [0.4.2] - 2026-08-22

### 修复
- `listBackups` / `compareBackup` 误用 `'pre-repair'` 作为 projectKey，导致备份清单永远为空、GUI「备份列表」无反应；改为从当前会话工件路径推导 projectKey。

### 变更
- 体检面板缩短（inset 收紧、内边距减小、报告区最大高度下调）；面板与确认弹窗增加 backdrop-filter 磨砂玻璃效果。

## [0.4.1] - 2026-08-22

### 文档
- README 补充 npm/GitHub 安装方式、备份列表与报告导出说明，以及 awesome-dsh-plugin 收录指引。

## [0.4.0] - 2026-08-22

### 新增
- GUI 面板增加「备份列表」：展示 pre-repair 备份清单，并支持逐份与当前工件对比（sha256/bytes/maxSeq/severity）。
- GUI 面板增加「导出报告」：一键下载诊断报告 JSON。

## [0.3.0] - 2026-08-22

### 新增
- 实现 `compareBackup` 端点：对比当前会话工件与指定 pre-repair 备份的指纹（sha256/bytes）、maxSeq、事件数与 severity，并报告是否内容一致、是否有新事件（超过备份 maxSeq）。

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
