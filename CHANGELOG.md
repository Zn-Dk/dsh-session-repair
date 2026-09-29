# Changelog

遵循 Keep a Changelog，版本号遵循 SemVer。

## [0.7.0] - 2026-09-25

### 新增
- **DSH 0.1.5-rc.1 会话格式（V3）检测能力**，三个新诊断码，规则对齐引擎的会话准入校验：
  - `source-kind-unclassified`（blocked）：`message.source.kind` 不在引擎的 15 项审计词表内（例如 `plugin:dsh-mnemon` 这类插件私有写法）；
  - `source-field-unexpected`（repairable）：`agent-message` 来源出现闭合形状之外的字段（引擎只对该分支校验字段名）；
  - `usage-null-token`（null 为 repairable，负值/非安全整数为 blocked）：`usage` 里出现引擎拒绝的 token 计数。
- **V3 修复动作** `findFormatRepairs` / `applyFormatRepair`：只做不臆造数据的机械修复（丢弃无信息的 `null` token 计数）。**未经分类的 `source.kind` 不自动改写**——挑选合法 kind 属于对插件意图的判断，交由人工或写入方决定。
- 新增 14 个 V3 专项测试，其中包含「同一字段名出现在其他事件类型时不得被误改」的隔离断言。

### 修复
- **修复在 DSH ≥ 0.1.5-rc.1 上完全不可达**（严重）：插件依赖的 `sessionPersistence.locate()` 已被 rc.1 移除，且 rc.1 的 `list()` 返回 `{ header, revision, ... }` 嵌套快照而旧代码读 `x.id`，导致每次检查都返回 `artifact-missing`、所有修复路径不可达。现在：兼容两种快照形状；`locate` 变为可选调用；新增**路径重算**（复刻引擎 `projectKey` + `encodeSegment` 规则，含 `_no-cwd` 与目录扫描兜底），已在真实会话上验证可精确定位 artifact。
- `seq-gap` 由「每个跳跃报一条」改为**聚合成一条汇总**（带 `gapCount`）。真实 subagent 会话常有上千次跳跃（事件被裁剪所致，完全正常），逐条上报会淹没其他发现。

### 说明
- 诊断码的严重级别与引擎实际行为对齐：`source.kind` 非法会被引擎拒绝加载，故为 blocked；`null` token 可机械修复，故为 repairable。
- 曾考虑增加 `format-version-unsupported`，经真实数据核实**予以否决**：已存会话 header 的 `version` 是*物理代际*（真实文件为 `version: 0`），并非 V3 逻辑版本，据此判断会产生误报。

### Added (en)
- **DSH 0.1.5-rc.1 session-format (V3) detection**, three new diagnostic codes mirroring the engine's session admission rules: `source-kind-unclassified` (blocked), `source-field-unexpected` (repairable, `agent-message` closed shape only), and `usage-null-token` (repairable for `null`, blocked for negative/unsafe counts).
- **V3 repair actions** `findFormatRepairs` / `applyFormatRepair` performing only mechanical, non-inventive fixes (dropping an information-free `null` token count). An unclassified `source.kind` is deliberately NOT auto-rewritten — choosing a lawful kind is a judgement about plugin intent.
- 14 new V3-focused tests, including an isolation assertion that a same-named key on an unrelated event type is never rewritten.

### Fixed (en)
- **The plugin was entirely unreachable on DSH >= 0.1.5-rc.1**: its `sessionPersistence.locate()` dependency was removed in rc.1 and the rc.1 `list()` returns nested `{ header, revision, ... }` snapshots while the old code read `x.id`, so every inspection reported `artifact-missing`. Now: both snapshot shapes are read, `locate` is an optional call, and a new path recomputation (mirroring the engine's `projectKey` + `encodeSegment`, with `_no-cwd` and directory-scan fallbacks) resolves the artifact — verified against a real session.
- `seq-gap` now aggregates into a single summarized check carrying `gapCount`, instead of one row per jump (real subagent sessions legitimately carry thousands of jumps and buried every other finding).

### Notes (en)
- Severities match engine behaviour: an illegal `source.kind` is refused at load (blocked); a `null` token count is mechanically fixable (repairable).
- A `format-version-unsupported` check was considered and **rejected** after checking real data: a stored header's `version` is the *physical generation* (real files carry `version: 0`), not the V3 logical version, so asserting on it produces false positives.

## [0.6.0] - 2026-08-24

### 新增
- i18n：GUI 全部用户可见文案中英双语，语言跟随 DSH Web UI（navigator.language / document.documentElement.lang），零配置。
- README 双语：`README.md`（英文，npm/GitHub 默认展示）+ `README.zh.md`（中文），顶部互链。

### 变更
- Client bundle 内置 `I18N = { zh, en }` 文案表，JSX 不再散落中文字符串字面量。

### Added (en)
- i18n: all GUI user-facing copy is now zh/en bilingual, following the DSH Web UI language (navigator.language / document.documentElement.lang), zero configuration.
- Bilingual README: `README.md` (English, shown by default on npm/GitHub) + `README.zh.md` (Chinese), cross-linked at the top.

### Changed (en)
- Client bundle ships an `I18N = { zh, en }` dictionary; JSX no longer contains scattered Chinese string literals.

## [0.6.2] - 2026-08-24

### 修复
- i18n 未跟随宿主语言：改用 Host locale 服务（`ctx.get('locale')` 读 `locale.preference`），并通过 `useSyncExternalStore` 订阅切换实时重渲染；不再依赖 `navigator.language`（用户切 English 后仍显示中文的问题）。

### 变更
- Client bundle 通过 `locale.register('dsh-session-repair', { zh, en })` 注册文案，`t()` 优先走宿主翻译管道。
- humanDiff 标点与 seq 列表分隔符也 i18n 化（`joinEnd`/`sentenceEnd`/`seqSep`）。

### Fixed (en)
- i18n now follows the Host locale service (`ctx.get('locale')` reads `locale.preference`) with `useSyncExternalStore` reactive re-render; no longer relies on `navigator.language` (which stayed zh after switching the UI to English).

### Changed (en)
- Client bundle registers copy via `locale.register('dsh-session-repair', { zh, en })`; `t()` prefers the Host translation pipeline.
- humanDiff punctuation and seq-list separators are i18n keys (`joinEnd`/`sentenceEnd`/`seqSep`).

## [0.6.1] - 2026-08-24

### Changed
- `package.json#description` switched to English to match the English README on the npm page.

### Changed (en)
- `package.json#description` is now English for consistency with the English README.

## [0.5.3] - 2026-08-22

### 文档
- SKILL.md 补充 `dsh_session_repair` 工具用法：模型调用、只读诊断、修复仍需 header 面板。

## [0.5.2] - 2026-08-22

### 文档
- 说明 `dsh_session_repair` 是模型调用工具（非用户手动触发）：只做只读诊断，修复仍需 header 面板按钮。

## [0.5.1] - 2026-08-22

### 修复
- 移除斜杠命令 `/dsh-session-repair`：GUI 下损坏会话无法在输入框执行命令，健康会话无需修复；修复入口统一为 header「会话体检」按钮，避免 slash 菜单出现不可用的误导入口。

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
