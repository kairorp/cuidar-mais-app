import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate,ownerOf,day} from '../public/challenge-model.js';
const a={id:'a',name:'Klysman'},b={id:'b',name:'Gabriel'},c={id:'c',name:'Jéssica'};
const base={id:'1',assignees:[a],dueDate:'2026-10-03',done:false,phase:{name:'Produção'}};
const options={start:'2026-10-01',end:'2026-10-31',now:new Date('2026-10-04T21:00:00Z')};
const calc=(cards,extra={})=>calculate(cards,[a,b,c],{...options,...extra});
test('denominator includes unfinished overdue, excludes future/today; completion on deadline qualifies',()=>{
 const result=calc([base,{...base,id:'2',done:true,finishedAt:'2026-10-03T22:00:00Z'},{...base,id:'3',done:true,finishedAt:'2026-10-04T12:00:00Z'},{...base,id:'4',dueDate:'2026-10-04'},{...base,id:'5',dueDate:'2026-10-08'}]);
 const p=result.people.find(p=>p.id==='a');assert.equal(p.denominator,3);assert.equal(p.onTime,1);assert.equal(p.overdue,1);assert.equal(p.late,1);assert.equal(p.upcoming,2);assert.equal(p.dueSoon,2);assert.ok(Math.abs(p.score-100/3)<1e-9);assert.equal(result.people.find(p=>p.id==='b').score,null);
});
test('shared cards never assume first assignee; explicit owner gives supports no points',()=>{
 const card={...base,assignees:[a,b]};assert.equal(ownerOf(card),null);assert.equal(calc([card]).pending,1);
 const result=calc([card],{overrides:{1:{ownerId:'a'}}});assert.equal(result.people.find(p=>p.id==='b').support,1);assert.equal(result.people.find(p=>p.id==='b').denominator,0);assert.equal(result.people.find(p=>p.id==='a').overdue,1);
});
test('suspended, cancelled, no deadline and missing finish date await review; exclusion requires reason',()=>{
 const result=calc([{...base,phase:{name:'Suspensa'}},{...base,id:'2',dueDate:null},{...base,id:'3',done:true},{...base,id:'4',phase:{name:'Cancelado'}}]);assert.equal(result.pending,4);assert.equal(result.people[0].denominator,0);
 assert.equal(calc([base],{overrides:{1:{excluded:true}}}).rows[0].status,'overdue');
 assert.equal(calc([base],{overrides:{1:{excluded:true,reason:'Impedimento externo validado'}}}).rows[0].status,'excluded');
});
test('reference deadline filters period; duplicates never count twice; reopened does not use old finish',()=>{
 assert.equal(calc([base,base]).people[0].overdue,1);
 assert.equal(calc([base],{overrides:{1:{dueDate:'2026-11-03'}}}).rows.length,0);
 assert.equal(calc([{...base,finishedAt:'2026-10-01',done:false}]).rows[0].status,'overdue');
 assert.equal(calc([{...base,dueDate:'2026-10-10'}]).people[0].denominator,0);
});
test('Brazil calendar and validation',()=>{
 assert.equal(day('2026-10-04T01:00:00Z'),'2026-10-03');assert.equal(day('2026-02-30'),null);
 assert.throws(()=>calc([base],{start:'2026-11-01',end:'2026-10-01'}));
 assert.equal(calc([{...base,done:true,finishedAt:'2026-10-04T01:00:00Z'}]).rows[0].status,'onTime');
});
