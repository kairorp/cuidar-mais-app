import {calculate, day, normalize} from './challenge-model.js?v=20261004-compare2';
const byId=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={onTime:'Entregue no prazo',late:'Concluída com atraso',overdue:'Vencida aberta',upcoming:'Ainda no prazo',pending:'Conferir',excluded:'Excluída com justificativa'};
const date=value=>value?value.split('-').reverse().join('/'):'Sem data';
let data=null, people=[], selected=[], overrides={}, busy=false, current=null;
const storageKey='sucom-challenge-trial-v1';
try { const saved=JSON.parse(localStorage.getItem(storageKey)||'{}'); overrides=saved.overrides||{};selected=saved.selected||[];byId('challengeStart').value=saved.start||'';byId('challengeEnd').value=saved.end||'';}catch{}
function save(){try{localStorage.setItem(storageKey,JSON.stringify({overrides,selected,start:byId('challengeStart').value,end:byId('challengeEnd').value}));}catch{byId('challengeStatus').textContent='O navegador não permitiu salvar a conferência. Ela será perdida ao sair.';}}
async function request(path,options={}){
 const response=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json','X-Sucom-Analysis':'read-only'}});
 const result=await response.json();if(!response.ok)throw new Error(response.status===401?'Sua sessão expirou. Entre novamente.':result.error||'Falha na consulta.');return result;
}
byId('openChallengeBtn').addEventListener('click',()=>byId('challengeDialog').showModal());
byId('challengeForm').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;
 const start=byId('challengeStart').value,end=byId('challengeEnd').value;
 if(!day(start)||!day(end)||start>end){byId('challengeStatus').textContent='A data final precisa ser igual ou posterior à inicial.';return;}
 busy=true;byId('challengeLoad').disabled=true;byId('challengeResults').innerHTML='';byId('challengePeople').innerHTML='';
 try{
  await request('/api/challenge',{method:'POST',body:'{}'});
  let ready=false;
  for(let attempt=0;attempt<300;attempt++){
   const result=await request('/api/challenge');
   if(result.status==='error')throw new Error(result.error);
   if(result.status==='ready'){data=result;ready=true;break;}
   byId('challengeStatus').textContent=`Lendo os nove pipes, incluindo concluídos… ${result.readCards||0} cards lidos. Aguarde.`;
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  if(!ready)throw new Error('A consulta ainda está em andamento. Aguarde e consulte novamente.');
  people=[...new Map(data.cards.flatMap(c=>c.assignees).map(p=>[p.id,p])).values()].sort((a,b)=>a.name.localeCompare(b.name));
  if(!selected.length)for(const first of ['klysman','gabriel','jessica']){
   const matches=people.filter(p=>normalize(p.name).split(' ')[0]===first);
   selected.push(matches.length===1?matches[0].id:'');
  }
  while(selected.length<3)selected.push('');
  byId('challengePeople').innerHTML=selected.slice(0,3).map((id,i)=>`<label>Participante ${i+1}<select data-participant="${i}"><option value="">Selecione a pessoa</option>${people.map(p=>`<option value="${escape(p.id)}" ${id===p.id?'selected':''}>${escape(p.name)}</option>`).join('')}</select></label>`).join('');
  save();render();
 }catch(error){byId('challengeStatus').textContent=error.message;}finally{busy=false;byId('challengeLoad').disabled=false;}
});
byId('challengePeople').addEventListener('change',event=>{const index=event.target.dataset.participant;if(index!==undefined){selected[Number(index)]=event.target.value;save();try{render();}catch(error){byId('challengeStatus').textContent='Não foi possível mostrar a comparação: '+error.message;}}});
['challengeStart','challengeEnd'].forEach(id=>byId(id).addEventListener('change',()=>{if(data){save();render();}}));
function render(){
 if(!data)return;
 selected=selected.slice(0,3);
 const members=[...new Set(selected.filter(Boolean))].map(id=>people.find(p=>p.id===id)).filter(Boolean);
 try{current=calculate(data.cards,members,{start:byId('challengeStart').value,end:byId('challengeEnd').value,overrides});}catch(e){byId('challengeStatus').textContent=e.message;return;}
 const sync=new Date(data.synchronizedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
 byId('challengeStatus').textContent=`${members.length<3?'Selecione três pessoas diferentes para completar a comparação. ':''}${current.partial?'Resultado parcial':'Consulta do período'} · simulação · ${data.pipes}/9 pipes · leitura em ${sync}. ${current.pending} cards aguardam conferência. Sem prazo aparecem para revisão, fora do cálculo.`;
 const compared=selected.map((id,i)=>current.people.find(p=>p.id===id)||{id:'slot'+i,name:'Selecione o participante '+(i+1),score:null,matched:0,onTime:0,late:0,overdue:0,upcoming:0,pending:0,support:0,dueSoon:0,denominator:0,placeholder:true});
 byId('challengeResults').innerHTML=`<section class="comparison-chart" aria-labelledby="comparisonTitle"><div class="comparison-heading"><div><p class="eyebrow">COMPARAÇÃO DA EQUIPE</p><h3 id="comparisonTitle">Quem está entregando em dia?</h3><p>Quanto maior a barra, maior o percentual de entregas no prazo.</p></div><span class="status-badge">${current.partial?'Parcial':'Simulação'}</span></div>
 <div class="comparison-formula"><strong>A conta é uma só:</strong> entregas em dia ÷ demandas avaliadas × 100.<br><span>Exemplo: 8 em dia e 2 fora do prazo = <strong>80%</strong>. Fora do prazo inclui entregas atrasadas e demandas que venceram e continuam abertas. As que ainda vão vencer não reduzem o percentual.</span></div>
 <div class="comparison-axis"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
 ${compared.map((p,i)=>`<div class="comparison-row" data-comparison-person="${escape(p.id)}"><div class="comparison-label"><strong>${escape(p.name)}</strong><b>${p.score===null?'Sem pontuação':p.score.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'}</b></div><div class="comparison-track ${p.score===null?'no-score':''}" role="img" aria-label="${escape(p.name)}: ${p.score===null?'sem dados suficientes para pontuar':p.score.toLocaleString('pt-BR',{maximumFractionDigits:1})+' por cento no prazo'}"><div class="comparison-bar color-${i}" style="width:${p.score||0}%"></div></div><p class="comparison-caption">${p.placeholder?'Escolha uma pessoa acima.':p.score!==null?`<strong>${p.onTime} em dia</strong> de ${p.denominator} avaliadas · ${p.late+p.overdue} fora do prazo`:p.matched===0?'Nenhuma demanda desta pessoa com vencimento no período selecionado.':p.pending?`${p.pending} card(s) precisam de conferência antes de pontuar. Veja os motivos na lista abaixo.`:p.upcoming?`${p.upcoming} demanda(s) ainda no prazo. O resultado aparecerá com as entregas ou o vencimento.`:p.support?'Neste período, esta pessoa aparece como apoio. Apoios não geram pontuação.':'Nenhuma demanda elegível para pontuar neste período.'}</p>${!p.placeholder?`<div class="comparison-context"><span>${p.matched} cards encontrados</span><span>${p.upcoming} ainda no prazo</span><span>${p.dueSoon} vencem em 7 dias</span><span>${p.pending} para conferir</span><span>${p.support} apoios</span></div>`:''}</div>`).join('')}
 </section>
 <details class="comparison-breakdown"><summary>Ver os números detalhados</summary><div class="table-wrap"><table><thead><tr><th>Pessoa</th><th>Em dia</th><th>Entregues atrasadas</th><th>Vencidas abertas</th><th>Ainda no prazo</th><th>Apoios</th></tr></thead><tbody>${current.people.map(p=>`<tr><td>${escape(p.name)}</td><td>${p.onTime}</td><td>${p.late}</td><td>${p.overdue}</td><td>${p.upcoming}</td><td>${p.support}</td></tr>`).join('')}</tbody></table></div></details>
 <p class="chart-note">As barras medem cumprimento de prazo. Apoios e cards para conferir ficam separados da pontuação. Sem pontuação não significa 0%.</p>
 <div class="challenge-table-head"><h3>Cards do cálculo e conferência</h3><select id="challengeFilter" aria-label="Filtrar situação"><option value="">Todas as situações</option>${Object.entries(labels).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select><select id="challengePersonFilter" aria-label="Filtrar participante"><option value="">Todos os participantes</option>${members.map(p=>`<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('')}</select></div>
 <div class="table-wrap"><table><thead><tr><th>Demanda</th><th>Principal / apoios</th><th>Referência / conclusão</th><th>Situação</th><th>Conferência</th></tr></thead><tbody id="challengeRows"></tbody></table></div>`;
 byId('challengeFilter').addEventListener('change',renderRows);byId('challengePersonFilter').addEventListener('change',renderRows);renderRows();
}
function renderRows(){
 const status=byId('challengeFilter').value,person=byId('challengePersonFilter').value;
 const rows=current.rows.filter(r=>(!status||r.status===status)&&(!person||r.assignees.some(p=>p.id===person)));
 byId('challengeRows').innerHTML=rows.map(r=>{
  const owner=r.assignees.find(p=>p.id===r.ownerId),supports=r.ownerId?r.assignees.filter(p=>p.id!==r.ownerId):[];
  return `<tr><td><a href="https://app.pipefy.com/open-cards/${encodeURIComponent(r.id)}" target="_blank" rel="noopener noreferrer">${escape(r.title)}</a><span class="subtext">${escape(r.pipe.name)} · ${escape(r.phase?.name||'Sem fase')}</span></td><td>${escape(owner?.name||'Definir principal')}<span class="subtext">${supports.length?'Apoio: '+supports.map(p=>escape(p.name)).join(', '):''}</span></td><td>${date(r.due)}<span class="subtext">${r.referenceAdjusted?'Referência ajustada':'Vencimento atual'}<br>Conclusão: ${date(r.completed)}</span></td><td><span class="status-badge ${r.status==='overdue'||r.status==='late'?'red':r.status==='pending'?'amber':''}">${labels[r.status]}</span>${r.status==='pending'?`<span class="subtext">${(r.pendingReasons||[]).map(escape).join('<br>')}</span>`:''}${r.dueSoon?'<span class="subtext">Vence em até 7 dias</span>':''}${r.reason?`<span class="subtext">${escape(r.reason)}</span>`:''}</td><td><button class="btn btn-ghost" data-review="${escape(r.id)}">Conferir</button></td></tr>`;
 }).join('')||'<tr><td colspan="5">Nenhuma demanda encontrada.</td></tr>';
}
byId('challengeResults').addEventListener('click',event=>{
 const button=event.target.closest('[data-review]');if(!button)return;
 const card=data.cards.find(c=>c.id===button.dataset.review),rule=overrides[card.id]||{};
 const dialog=document.createElement('dialog');dialog.className='detail-dialog challenge-review';dialog.setAttribute('aria-label','Conferir demanda');
 dialog.innerHTML=`<form><h3>Conferir demanda</h3><p>${escape(card.title)}</p><label>Responsável principal<select name="owner"><option value="">Usar identificação automática</option>${card.assignees.map(p=>`<option value="${escape(p.id)}" ${rule.ownerId===p.id?'selected':''}>${escape(p.name)}</option>`).join('')}</select></label><label>Prazo de referência para este teste<input name="due" type="date" value="${escape(rule.dueDate||'')}"></label><p class="chart-note">Deixe vazio para usar o vencimento atual: ${date(day(card.dueDate))}.</p><label class="challenge-checkbox"><input name="excluded" type="checkbox" ${rule.excluded?'checked':''}>Excluir do cálculo com justificativa</label><label>Justificativa do ajuste ou exclusão<textarea name="reason" maxlength="500">${escape(rule.reason||'')}</textarea></label><p class="form-error" role="alert"></p><div class="challenge-review-actions"><button type="button" class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-primary" type="submit">Salvar conferência</button></div></form>`;
 document.body.append(dialog);dialog.showModal();dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[data-cancel]').addEventListener('click',()=>dialog.close());
 dialog.querySelector('form').addEventListener('submit',e=>{
  e.preventDefault();const form=e.target,values=new FormData(form),reason=String(values.get('reason')||'').trim(),due=String(values.get('due')||'');
  if((due||values.has('excluded'))&&!reason){dialog.querySelector('[role="alert"]').textContent='Informe a justificativa do ajuste de prazo ou da exclusão.';return;}
  overrides[card.id]={ownerId:values.get('owner'),dueDate:due,excluded:values.has('excluded'),reason,reviewedAt:new Date().toISOString()};save();dialog.close();render();
 });
});
