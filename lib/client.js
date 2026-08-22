window.__ModuleLoader__.load({
  id: 'dsh-session-repair',
  factory: (require) => {
    const module = { exports: {} }
    Object.defineProperty(module.exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const jsx = require('react/jsx-runtime').jsx
    const CHANNEL = '/dsh-session-repair'
    const CSS = [
      '.sr-header{display:inline-flex;align-items:center;gap:6px}',
      '.sr-button{box-sizing:border-box;min-height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;align-items:center;gap:4px;padding:3px 10px;font-size:12px;line-height:18px;display:inline-flex;white-space:nowrap}',
      '.sr-button:hover:not(:disabled),.sr-button:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}',
      '.sr-button:disabled{opacity:.5;cursor:not-allowed}',
      '.sr-button--primary{color:var(--dsw-alias-label-on-primary, #fff);background:var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary));border-color:transparent}',
      '.sr-panel{position:fixed;z-index:1000;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100vw - 32px));max-height:min(72vh,760px);overflow:auto;color:var(--dsw-alias-label-primary);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 78%, transparent);backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.35);padding:28px 30px;font-size:12px}',
      '.sr-panel h2{margin:0 0 12px;font-size:16px}',
      '.sr-panel pre{white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-layer-3);border-radius:8px;padding:12px;max-height:36vh;overflow:auto}',
      '.sr-status{margin:8px 0;color:var(--dsw-alias-label-secondary)}',
      '.sr-kv{display:flex;align-items:center;gap:8px;margin:8px 0}',
      '.sr-kv-label{color:var(--dsw-alias-label-secondary)}',
      '.sr-kv-value{font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-all}',
      '.sr-copy{padding:1px 8px;min-height:22px;font-size:11px;line-height:16px}',
      '.sr-tag{display:inline-flex;align-items:center;gap:6px;padding:1px 10px;border-radius:999px;font-weight:600;font-size:12px;line-height:18px;border:1px solid color-mix(in srgb, currentColor 35%, transparent);background:color-mix(in srgb, currentColor 12%, transparent)}',
      '.sr-tag::before{content:\'\';width:6px;height:6px;border-radius:999px;background:currentColor}',
      '.sr-tag--healthy{color:var(--dsw-alias-state-success-primary)}',
      '.sr-tag--warning{color:var(--dsw-alias-state-warn-primary)}',
      '.sr-tag--repairable{color:var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary))}',
      '.sr-tag--blocked{color:var(--dsw-alias-state-error-primary)}',
      '.sr-error{color:var(--dsw-alias-state-error-primary)}',
      '.sr-success{color:var(--dsw-alias-state-success-primary)}',
      '.sr-mask{position:fixed;z-index:1100;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;padding:16px}',
      '.sr-dialog{color:var(--dsw-alias-label-primary);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 82%, transparent);backdrop-filter:blur(16px) saturate(130%);-webkit-backdrop-filter:blur(16px) saturate(130%);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.35);padding:18px 20px;max-width:400px;font-size:12px;line-height:1.6}',
      '.sr-dialog p{margin:0 0 16px;color:var(--dsw-alias-label-secondary)}',
      '.sr-dialog-actions{display:flex;gap:8px;justify-content:flex-end}',
      '.sr-backup-card{display:flex;align-items:center;gap:10px;margin:8px 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-3) 60%, transparent)}',
      '.sr-backup-meta{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
      '.sr-backup-meta .sr-backup-name{font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-all}',
      '.sr-backup-meta .sr-backup-detail{color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));font-size:11px;line-height:16px}',
      '.sr-human-diff{margin:8px 0;padding:10px 12px;border-radius:10px;background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);border:1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, transparent);color:var(--dsw-alias-label-primary)}'
    ].join('')
    if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="dsh-session-repair"]')) {
      const tag = document.createElement('style'); tag.dataset.pluginCss = 'dsh-session-repair'; tag.textContent = CSS; document.head.appendChild(tag)
    }
    function reportText(report) { return JSON.stringify(report, null, 2) }
    function severityClass(severity) {
      if (severity === 'healthy') return 'sr-tag--healthy'
      if (severity === 'warning') return 'sr-tag--warning'
      if (severity === 'repairable') return 'sr-tag--repairable'
      if (severity === 'blocked') return 'sr-tag--blocked'
      return ''
    }
    function ConfirmDialog({ title, message, confirmLabel, busy, onConfirm, onCancel }) {
      return jsx('div', { className:'sr-mask', role:'presentation', onMouseDown:(e)=>{ if (e.target === e.currentTarget && !busy) onCancel() }, children:
        jsx('div', { className:'sr-dialog', role:'alertdialog', 'aria-label':title ?? '确认', onMouseDown:(e)=>e.stopPropagation(), children:[
          title ? jsx('div', { children:title, key:'t', style:{ margin:'0 0 10px', fontWeight:600 } }) : null,
          jsx('p', { children:message, key:'m' }),
          jsx('div', { className:'sr-dialog-actions', key:'a', children:[
            jsx('button', { type:'button', className:'sr-button', disabled:busy, onClick:onCancel, children:'取消', key:'cancel' }),
            jsx('button', { type:'button', className:'sr-button sr-button--primary', disabled:busy, onClick:onConfirm, children:busy?'处理中…':(confirmLabel ?? '确定'), key:'ok' })
          ] })
        ] })
      })
    }
    function RepairPanel({ sessionId, connection, onClose }) {
      const [report, setReport] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [pendingBatch, setPendingBatch] = React.useState(null)
      const [repairBusy, setRepairBusy] = React.useState(false)
      const [repairError, setRepairError] = React.useState(null)
      const [repairResult, setRepairResult] = React.useState(null)
      const inspect = async () => { setBusy(true); setError(null); try { const result = await connection.rpc.call(CHANNEL, 'inspect', { sessionId }); if (!result.ok) throw new Error(result.error?.message ?? 'inspect failed'); setReport(result.value) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
      React.useEffect(() => { void inspect() }, [sessionId])
      React.useEffect(() => {
        if (report && (report.severity === 'repairable' || report.severity === 'blocked') && !report.live && !backups) {
          void (async () => {
            const listed = await connection.rpc.call(CHANNEL, 'listBackups', { sessionId })
            if (listed.ok) setBackups(listed.value)
          })()
        }
      }, [report?.severity, report?.live])
      const copy = async () => { if (report) await navigator.clipboard?.writeText(reportText(report)) }
      const [backups, setBackups] = React.useState(null)
      const [backupsBusy, setBackupsBusy] = React.useState(false)
      const [backupsError, setBackupsError] = React.useState(null)
      const [compareResult, setCompareResult] = React.useState(null)
      const [compareBusy, setCompareBusy] = React.useState(false)
      const listBackups = async () => {
        setBackupsBusy(true); setBackupsError(null)
        try {
          const result = await connection.rpc.call(CHANNEL, 'listBackups', { sessionId })
          if (!result.ok) throw new Error(result.error?.message ?? 'list backups failed')
          setBackups(result.value)
        } catch (e) { setBackupsError(e instanceof Error ? e.message : String(e)) } finally { setBackupsBusy(false) }
      }
      const compareBackup = async (backupId) => {
        setCompareBusy(true)
        try {
          const result = await connection.rpc.call(CHANNEL, 'compareBackup', { sessionId, backupId })
          if (!result.ok) throw new Error(result.error?.message ?? 'compare failed')
          setCompareResult(result.value)
        } catch (e) { setCompareResult({ error: e instanceof Error ? e.message : String(e) }) } finally { setCompareBusy(false) }
      }
      const [restoreBusy, setRestoreBusy] = React.useState(false)
      const [latestBackupId, setLatestBackupId] = React.useState(null)
      const [clearBusy, setClearBusy] = React.useState(false)
      // Single-slot restore: server keeps at most one pre-* rollback point per session.
      // listBackups → restoreLatest runs end-to-end and reverts the artifact.
      const restoreLatest = async () => {
        setRestoreBusy(true); setError(null)
        try {
          const listed = await connection.rpc.call(CHANNEL, 'listBackups', { sessionId })
          if (!listed.ok) throw new Error(listed.error?.message ?? 'list backups failed')
          const items = (listed.value && listed.value.items) || []
          if (items.length === 0) throw new Error('没有可恢复的备份')
          const result = await connection.rpc.call(CHANNEL, 'restoreBackup', { sessionId, backupId: items[0] })
          if (!result.ok) throw new Error(result.error?.message ?? 'restore failed')
          setBackups(null); setLatestBackupId(null); setCompareResult(null); await inspect()
        } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setRestoreBusy(false) }
      }
      const clearBackups = async () => {
        setClearBusy(true)
        try {
          const result = await connection.rpc.call(CHANNEL, 'clearBackups', { sessionId })
          if (!result.ok) throw new Error(result.error?.message ?? 'clear failed')
          setBackups(null); setLatestBackupId(null)
        } catch (e) { setBackupsError(e instanceof Error ? e.message : String(e)) } finally { setClearBusy(false) }
      }
      const humanDiff = (diff) => {
        if (!diff) return null
        if (diff.error) return diff.error
        if (diff.sameContent) return '当前工件与这份备份内容完全一致。'
        const parts = []
        if (diff.advanced) parts.push('当前工件比这份备份多了 ' + diff.newEvents + ' 条新事件（seq 已推进到 ' + diff.current.maxSeq + '，备份在 ' + diff.backup.maxSeq + '）')
        else if (diff.current.maxSeq < diff.backup.maxSeq) parts.push('当前工件比这份备份更旧（seq ' + diff.current.maxSeq + ' vs 备份 ' + diff.backup.maxSeq + '）')
        else parts.push('内容不同，但 seq 推进相同（maxSeq ' + diff.current.maxSeq + '）')
        parts.push('当前 severity：' + diff.current.severity + '，备份时 severity 见其 manifest')
        return parts.join('；') + '。'
      }
      const exportReport = async () => {
        if (!report) return
        try {
          const result = await connection.rpc.call(CHANNEL, 'exportReport', { sessionId })
          if (!result.ok) throw new Error(result.error?.message ?? 'export failed')
          const blob = new Blob([JSON.stringify(result.value, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a'); a.href = url; a.download = 'session-report-' + sessionId + '.json'; a.click()
          URL.revokeObjectURL(url)
        } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
      }
      const askRepair = async () => {
        if (!report?.repairPlans?.length) return
        try {
          const prepared = await connection.rpc.call(CHANNEL, 'prepareRepair', { sessionId })
          if (!prepared.ok) throw new Error(prepared.error?.message ?? 'prepare repair failed')
          setPendingBatch(prepared.value)
        } catch (e) { setRepairError(e instanceof Error ? e.message : String(e)) }
      }
      const confirmRepair = async () => {
        if (!pendingBatch) return
        setRepairBusy(true); setRepairError(null); setRepairResult(null)
        try {
          const result = await connection.rpc.call(CHANNEL, 'repair', { sessionId, batchId: pendingBatch.batchId, expectedFingerprint: pendingBatch.fingerprint })
          if (!result.ok) throw new Error(result.error?.message ?? 'repair failed')
          setRepairResult(result.value); setPendingBatch(null); await inspect()
        } catch (e) { setRepairError(e instanceof Error ? e.message : String(e)); setPendingBatch(null) } finally { setRepairBusy(false) }
      }
      const hasSafetyBackup = (backups?.items?.length ?? 0) > 0
      const showRepair = report?.severity === 'repairable' && report?.repairPlans?.length >= 1 && !hasSafetyBackup
      const showRestore = (report?.severity === 'repairable' || report?.severity === 'blocked') && !report?.live && hasSafetyBackup
      const showClear = hasSafetyBackup
      return jsx('div', { className:'sr-panel', role:'dialog', 'aria-label':'会话体检', children:[
        jsx('h2', { children:'会话体检', key:'title' }),
        jsx('div', { className:'sr-kv', key:'id', children:[
          jsx('span', { className:'sr-kv-label', children:'Session ID', key:'label' }),
          jsx('span', { className:'sr-kv-value', children:sessionId, key:'value' }),
          jsx('button', { className:'sr-button sr-copy', type:'button', title:'复制 Session ID', onClick:()=>{ void navigator.clipboard?.writeText(sessionId) }, children:'复制', key:'copy' })
        ] }),
        error ? jsx('div', { className:'sr-error', role:'alert', children:error, key:'error' }) : null,
        report ? jsx('div', { className:'sr-kv', key:'severity', children:[
          jsx('span', { className:'sr-kv-label', children:'状态', key:'label' }),
          jsx('span', { className:'sr-tag ' + severityClass(report.severity), children:report.severity, key:'value' })
        ] }) : null,
        report?.repairPlans?.length ? jsx('div', { className:'sr-status', children:'检测到确定性修复计划 ' + report.repairPlans.length + ' 条：' + report.repairPlans.map(plan => plan.seqs.join(' → ')).join('；'), key:'repair-plan' }) : null,
        repairError ? jsx('div', { className:'sr-error', role:'alert', children:repairError, key:'repair-error' }) : null,
        repairResult ? jsx('div', { className:'sr-success', role:'status', children:'修复完成，已生成 pre-repair backup 与审计记录。请刷新页面以加载修复后的会话。', key:'repair-result' }) : null,
        backupsError ? jsx('div', { className:'sr-error', role:'alert', children:backupsError, key:'backups-error' }) : null,
        compareResult ? jsx('div', { className:'sr-human-diff', key:'compare-result', children:humanDiff(compareResult) }) : null,
        report ? jsx('pre', { children:reportText(report), key:'report' }) : jsx('div', { className:'sr-status', children:busy?'诊断中…':'暂无报告', key:'loading' }),
        jsx('div', { className:'sr-header', key:'actions', children:[
          jsx('button', { className:'sr-button', type:'button', disabled:busy, onClick:()=>void inspect(), children:'刷新诊断', key:'refresh' }),
          jsx('button', { className:'sr-button', type:'button', disabled:!report, onClick:()=>void copy(), children:'复制报告', key:'copy' }),
          jsx('button', { className:'sr-button', type:'button', disabled:!report, onClick:()=>void exportReport(), children:'导出报告', key:'export' }),
          (showRestore || showClear) ? jsx('button', { className:'sr-button', type:'button', disabled:restoreBusy, onClick:()=>void restoreLatest(), children:restoreBusy?'恢复中…':'恢复上次修复前', key:'restore-latest', title:'把当前会话回滚到最近一次修复操作之前的状态' }) : null,
          showClear ? jsx('button', { className:'sr-button', type:'button', disabled:clearBusy, onClick:()=>void clearBackups(), children:clearBusy?'清空中…':'清空备份', key:'clear-backups' }) : null,
          showRepair ? jsx('button', { className:'sr-button', type:'button', disabled:repairBusy || busy, onClick:()=>void askRepair(), children:repairBusy?'修复中…':'备份并修复', key:'repair' }) : null,
          repairResult ? jsx('button', { className:'sr-button sr-button--primary', type:'button', onClick:()=>location.reload(), children:'刷新页面', key:'reload' }) : null,
          jsx('button', { className:'sr-button', type:'button', onClick:onClose, children:'关闭', key:'close' })
        ] }),
        pendingBatch ? jsx(ConfirmDialog, { key:'confirm', title:'确认修复', message:'将修复 ' + pendingBatch.plans.length + ' 条 tool-call ID 链（' + pendingBatch.plans.map(plan => plan.seqs.join(' → ')).join('；') + '），并先创建 pre-repair backup。确定继续？', confirmLabel:'备份并修复', busy:repairBusy, onConfirm:()=>void confirmRepair(), onCancel:()=>{ if (!repairBusy) setPendingBatch(null) } }) : null
      ] })
    }
    function HeaderAction({ sessionId, connection }) {
      const [open, setOpen] = React.useState(false)
      return jsx('div', { className:'sr-header', children:[
        jsx('button', { type:'button', className:'sr-button', title:'会话体检', onClick:(event)=>{ event.stopPropagation(); setOpen(true) }, children:'会话体检', key:'button' }),
        open ? jsx(RepairPanel, { sessionId, connection, onClose:()=>setOpen(false), key:'panel' }) : null
      ] })
    }
    const inject = ['slots', 'connection']
    function apply(ctx) {
      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name:'conversation.session.header.actions', id:'dsh-session-repair-header', order:45,
        inject:() => ({ connection:ctx.connection })
      }, HeaderAction))
    }
    module.exports.apply = apply; module.exports.inject = inject; return module.exports
  }
})
