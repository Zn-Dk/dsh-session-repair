import test from 'node:test'
import assert from 'node:assert/strict'
import { applyEmptyToolChain, applyEmptyToolChains, findEmptyToolChains } from '../lib/repair.js'
const events=[
 {type:'session',id:'s1'},
 {type:'assistant/message',seq:1,data:{turn:1,step:1,message:{content:[{type:'tool-call',id:'',name:'run_code'}]}}},
 {type:'tool/call',seq:2,data:{turn:1,step:1,callId:'',name:'run_code'}},
 {type:'tool/result',seq:3,data:{turn:1,step:1,sourceEventSeqs:[2],message:{source:{kind:'tool',callId:''},content:[{type:'tool-result',toolCallId:''}]}}},
]
test('plans one unique empty-id chain',()=>{const plans=findEmptyToolChains(events);assert.equal(plans.length,1);const fixed=applyEmptyToolChain(events,plans[0]);assert.match(fixed.callId,/^call_repair_/);assert.equal(fixed.events[1].data.message.content[0].id,fixed.callId);assert.equal(fixed.events[2].data.callId,fixed.callId);assert.equal(fixed.events[3].data.message.source.callId,fixed.callId);assert.equal(fixed.events[3].data.message.content[0].toolCallId,fixed.callId)})
test('does not plan ambiguous empty results',()=>{const ambiguous=[...events,{type:'tool/result',seq:4,data:{turn:1,step:1,message:{source:{kind:'tool',callId:''},content:[{type:'tool-result',toolCallId:''}]}}}];assert.equal(findEmptyToolChains(ambiguous).length,0)})
test('applies multiple deterministic empty-id chains in one batch',()=>{
  const chain2=[
    {type:'assistant/message',seq:11,data:{turn:2,step:2,message:{content:[{type:'tool-call',id:'',name:'run_code'}]}}},
    {type:'tool/call',seq:12,data:{turn:2,step:2,callId:'',name:'run_code'}},
    {type:'tool/result',seq:13,data:{turn:2,step:2,sourceEventSeqs:[12],message:{source:{kind:'tool',callId:''},content:[{type:'tool-result',toolCallId:''}]}}},
  ]
  const all=[...events,...chain2]
  const plans=findEmptyToolChains(all)
  assert.equal(plans.length,2)
  const fixed=applyEmptyToolChains(all,plans)
  assert.equal(fixed.callIds.size,2)
  for(const plan of plans){
    const id=fixed.callIds.get(plan.repairId)
    assert.match(id,/^call_repair_/)
    assert.equal(fixed.events.find(e=>e.seq===plan.assistantSeq).data.message.content[0].id,id)
    assert.equal(fixed.events.find(e=>e.seq===plan.callSeq).data.callId,id)
    assert.equal(fixed.events.find(e=>e.seq===plan.resultSeq).data.message.source.callId,id)
  }
})

test('identity-loss matrix: missing, null, and empty-string ids all plan and repair', () => {
  const shapes = ['missing', 'null', 'empty-string']
  const events = []
  shapes.forEach((shape, i) => {
    const turn = 10 + i
    const seqA = 100 + i * 10 + 1
    const seqC = 100 + i * 10 + 2
    const seqR = 100 + i * 10 + 3
    const idFor = (shape) => shape === 'missing' ? undefined : shape === 'null' ? null : ''
    const id = idFor(shape)
    const assistantBlock = { type: 'tool-call', name: 'run_code' }
    if (id !== undefined) assistantBlock.id = id
    const call = { type: 'tool/call', seq: seqC, data: { turn, step: 1, name: 'run_code' } }
    if (id !== undefined) call.data.callId = id
    const result = {
      type: 'tool/result', seq: seqR,
      data: { turn, step: 1, sourceEventSeqs: [seqC], message: { source: { kind: 'tool' }, content: [{ type: 'tool-result' }] } },
    }
    if (id !== undefined) result.data.message.source.callId = id
    if (id !== undefined) result.data.message.content[0].toolCallId = id
    events.push(
      { type: 'assistant/message', seq: seqA, data: { turn, step: 1, message: { content: [assistantBlock] } } },
      call,
      result,
    )
  })
  const plans = findEmptyToolChains(events)
  assert.equal(plans.length, 3, 'all three loss shapes must be detected')
  const fixed = applyEmptyToolChains(events, plans)
  assert.equal(fixed.callIds.size, 3)
  for (const plan of plans) {
    const id = fixed.callIds.get(plan.repairId)
    assert.match(id, /^call_repair_/)
    assert.equal(fixed.events.find(e => e.seq === plan.assistantSeq).data.message.content[0].id, id)
    assert.equal(fixed.events.find(e => e.seq === plan.callSeq).data.callId, id)
    assert.equal(fixed.events.find(e => e.seq === plan.resultSeq).data.message.source.callId, id)
    assert.equal(fixed.events.find(e => e.seq === plan.resultSeq).data.message.content[0].toolCallId, id)
  }
})
