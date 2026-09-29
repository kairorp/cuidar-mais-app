const workloadColors = ['#2859c5','#00a59b','#8557ca','#de9635','#db567a','#4692b9','#6b8d40','#aa6953','#5868a6','#98578e'];
function workloadAvatar(person) {
  const initials=String(person.name||'?').trim().split(/\s+/).map(x=>x[0]).slice(0,2).join('');
  let url='';
  try { const parsed=new URL(person.avatarUrl); if(parsed.protocol==='https:')url=parsed.href; } catch {}
  return `<span class="person-avatar"><span>${esc(initials)}</span>${url?`<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''}</span>`;
}
function renderWorkload(data) {
  const people=data.workload.filter(p=>p.count>0);
  const total=people.reduce((sum,p)=>sum+p.count,0);
  const chart=document.getElementById('workloadChart');
  const list=document.getElementById('workloadList');
  if(!total){chart.innerHTML='<p class="muted">Nenhuma demanda atribuída.</p>';list.innerHTML='';return;}
  let offset=0;
  const segments=people.map((p,i)=>{
    const share=p.count/total*100;
    const circle=`<circle class="workload-slice" data-person="${i}" role="button" tabindex="0" aria-label="${esc(p.name)}: ${p.count} demandas, ${p.attention} precisam de atenção" cx="150" cy="150" r="112" pathLength="100" fill="none" stroke="${workloadColors[i%workloadColors.length]}" stroke-width="42" stroke-dasharray="${share} ${100-share}" stroke-dashoffset="${-offset}" transform="rotate(-90 150 150)"><title>${esc(p.name)}: ${p.count} demandas</title></circle>`;
    offset+=share;return circle;
  }).join('');
  chart.innerHTML=`<div class="workload-donut"><svg viewBox="0 0 300 300" aria-label="Distribuição das atribuições por responsável">${segments}</svg><div class="donut-center"><strong>${data.kpis.active}</strong><span>demandas abertas</span></div></div><div id="workloadDetail" class="workload-detail" aria-live="polite"></div>`;
  list.innerHTML=people.map((p,i)=>`<button class="person-row" data-person="${i}" type="button" aria-label="Ver carga de ${esc(p.name)}" style="--person-color:${workloadColors[i%workloadColors.length]}">${workloadAvatar(p)}<span class="person-info"><strong>${esc(p.name)}</strong><small>${p.attention} precisando de atenção</small></span><span class="person-count">${p.count}<small>${(p.count/total*100).toLocaleString('pt-BR',{maximumFractionDigits:1})}%</small></span></button>`).join('');
  function images(root){root.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>img.remove(),{once:true}));}
  function select(index){
    const p=people[index];if(!p)return;
    chart.querySelectorAll('.workload-slice').forEach(el=>{el.classList.toggle('selected',Number(el.dataset.person)===index);el.classList.toggle('dimmed',Number(el.dataset.person)!==index);});
    list.querySelectorAll('.person-row').forEach(el=>el.classList.toggle('selected',Number(el.dataset.person)===index));
    document.getElementById('workloadDetail').innerHTML=`${workloadAvatar(p)}<div><strong>${esc(p.name)}</strong><span>${p.count} demandas abertas · ${p.attention} precisam de atenção</span><button type="button" class="person-demands" data-demand-person="${esc(p.id)}">Ver demandas →</button></div>`;
    images(document.getElementById('workloadDetail'));
  }
  function reset(){chart.querySelectorAll('.workload-slice').forEach(el=>el.classList.remove('selected','dimmed'));list.querySelectorAll('.person-row').forEach(el=>el.classList.remove('selected'));document.getElementById('workloadDetail').innerHTML='<span class="workload-hint">Passe o mouse, toque em uma fatia ou selecione um responsável.</span>';}
  [chart,list].forEach(root=>root.querySelectorAll('[data-person]').forEach(el=>{
    const activate=()=>select(Number(el.dataset.person));
    el.addEventListener('pointerenter',activate);el.addEventListener('focus',activate);el.addEventListener('click',activate);
    el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}if(e.key==='Escape'){reset();el.blur();}});
  }));
  images(list);reset();
}
