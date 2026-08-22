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
      '.sr-panel{position:fixed;z-index:1000;inset:12vh 8vw 12vh 8vw;overflow:auto;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.35);padding:20px;font-size:12px}',
      '.sr-panel h2{margin:0 0 12px;font-size:16px}',
      '.sr-panel pre{white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-layer-3);border-radius:8px;padding:12px;max-height:calc(55vh - 50px);overflow:auto}',
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
      '.sr-dialog{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.35);padding:18px 20px;max-width:400px;font-size:12px;line-height:1.6}',
      '.sr-dialog p{margin:0 0 16px;color:var(--dsw-alias-label-secondary)}',
      '.sr-dialog-actions{display:flex;gap:8px;justify-content:flex-end}'
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
    function DoctorPanel({ sessionId, connection, onClose }) {
      const [report, setReport] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [pendingBatch, setPendingBatch] = React.useState(null)
      const [repairBusy, setRepairBusy] = React.useState(false)
      const [repairError, setRepairError] = React.useState(null)
      const [repairResult, setRepairResult] = React.useState(null)
      const inspect = async () => { setBusy(true); setError(null); try { const result = await connection.rpc.call(CHANNEL, 'inspect', { sessionId }); if (!result.ok) throw new Error(result.error?.message ?? 'inspect failed'); setReport(result.value) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
      React.useEffect(() => { void inspect() }, [sessionId])
      const copy = async () => { if (report) await navigator.clipboard?.writeText(reportText(report)) }
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
      const showRepair = report?.severity === 'repairable' && report?.repairPlans?.length >= 1
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
        report ? jsx('pre', { children:reportText(report), key:'report' }) : jsx('div', { className:'sr-status', children:busy?'诊断中…':'暂无报告', key:'loading' }),
        jsx('div', { className:'sr-header', key:'actions', children:[
          jsx('button', { className:'sr-button', type:'button', disabled:busy, onClick:()=>void inspect(), children:'刷新诊断', key:'refresh' }),
          jsx('button', { className:'sr-button', type:'button', disabled:!report, onClick:()=>void copy(), children:'复制报告', key:'copy' }),
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
        open ? jsx(DoctorPanel, { sessionId, connection, onClose:()=>setOpen(false), key:'panel' }) : null
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
