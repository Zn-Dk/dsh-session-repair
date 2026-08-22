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
