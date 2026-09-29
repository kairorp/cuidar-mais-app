import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyCard} from '../card-status.js';
const now=new Date('2026-09-29T19:00:00Z');
const card={done:false,phase:{name:'Produção'},assignees:[{id:'1'}],dueDate:'2026-09-10',overdue:true,late:true,expired:true};
test('vencimento alterado prevalece sobre todos os sinais antigos do Pipefy',()=>{
 assert.equal(classifyCard(card,now).overdue,true);
 const changed=classifyCard({...card,dueDate:'2026-10-10'},now);
 assert.equal(changed.overdue,false);assert.deepEqual(changed.attentionReasons,[]);
});
test('suspensas não geram alertas nem prazos próximos; reativação recalcula',()=>{
 for(const name of ['Suspensa','SUSPENSO','Demandas suspensas','Solicitação suspensa']){
  const suspended=classifyCard({...card,phase:{name},assignees:[]},now);
  assert.equal(suspended.suspended,true);assert.equal(suspended.overdue,false);assert.deepEqual(suspended.attentionReasons,[]);
  assert.equal(classifyCard({...suspended,dueDate:'2026-09-30'},now).dueSoon,false);
  assert.equal(classifyCard({...suspended,phase:{name:'Produção'}},now).overdue,true);
 }
});
test('hoje não está atrasado; datas usam o calendário de São Paulo',()=>{
 const today=classifyCard({...card,dueDate:'2026-09-29'},now);
 assert.equal(today.overdue,false);assert.equal(today.dueDays,0);assert.deepEqual(today.attentionReasons,['Vence hoje']);
 const lateNight=new Date('2026-09-30T02:59:59Z');
 assert.equal(classifyCard({...card,dueDate:'2026-09-29'},lateNight).overdue,false);
 assert.equal(classifyCard({...card,dueDate:'2026-09-29'},new Date('2026-09-30T03:00:00Z')).overdue,true);
 assert.equal(classifyCard({...card,dueDate:'2026-09-30T02:00:00Z'},now).dueDateDay,'2026-09-29');
});
test('sem data válida ou concluído não é atrasado; sete dias inclusivos',()=>{
 for(const dueDate of [null,'','inválido','2026-02-30'])assert.equal(classifyCard({...card,dueDate},now).overdue,false);
 assert.equal(classifyCard({...card,done:true},now).overdue,false);
 assert.equal(classifyCard({...card,dueDate:'2026-10-06'},now).dueSoon,true);
 assert.equal(classifyCard({...card,dueDate:'2026-10-07'},now).dueSoon,false);
});
