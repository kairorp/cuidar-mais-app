let state = { data: null, filtered: [] };
const $ = id => document.getElementById(id);

function toast(message){ const el=$("toast"); el.textContent=message; el.classList.remove("hidden"); setTimeout(()=>el.classList.add("hidden"),2800); }
function esc(v){ return String(v??"").replace(/[&<>"']/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[s])); }
function fmtDate(v){ if(!v)return "Sem prazo"; const d=new Date(v); return Number.isNaN(d)? "Sem prazo": d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"2-digit"}); }
function daysUntil(v){ if(!v)return null; const d=new Date(v); if(Number.isNaN(d))return null; return Math.ceil((d-Date.now())/86400000); }
function reasons(card){ const r=[]; if(card.overdue||card.late||card.expired)r.push("Atrasada"); const d=daysUntil(card.dueDate); if(d!==null&&d>=0&&d<=2)r.push(d===0?"Vence hoje":`Vence em ${d} dia${d===1?"":"s"}`); if(!card.assignees.length)r.push("Sem responsável"); return r; }

async function api(path, opts={}){
  const res=await fetch(path,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(opts.headers||{})},...opts});
  const data=await res.json().catch(()=>({}));
  if(res.status===401 && path!=="/api/login"){ showLogin(); throw new Error("Sessão expirada."); }
  if(!res.ok) throw new Error(data.error||"Falha na solicitação.");
  return data;
}

function showLogin(){ $("loginView").classList.remove("hidden"); $("appView").classList.add("hidden"); }
function showApp(){ $("loginView").classList.add("hidden"); $("appView").classList.remove("hidden"); }

$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault(); $("loginError").classList.add("hidden");
  try{
    await api("/api/login",{method:"POST",body:JSON.stringify({password:$("password").value})});
    $("password").value=""; showApp(); await loadDashboard(true);
  }catch(err){ $("loginError").textContent=err.message; $("loginError").classList.remove("hidden"); }
});
$("logoutBtn").addEventListener("click",async()=>{ await api("/api/logout",{method:"POST"}).catch(()=>{}); showLogin(); });
$("refreshBtn").addEventListener("click",()=>loadDashboard(true));

async function init(){
  try{
    const s=await api("/api/session");
    if(s.authenticated){ showApp(); await loadDashboard(false); } else showLogin();
  }catch{ showLogin(); }
}

async function loadDashboard(force){
  const btn=$("refreshBtn"); btn.disabled=true; btn.textContent="Atualizando…";
  try{
    const data=await api("/api/dashboard"+(force?"?force=1":""));
    state.data=data; render(data);
    if(force) toast("Dados atualizados com o Pipefy.");
  }catch(err){ toast(err.message); }
  finally{ btn.disabled=false; btn.textContent="Atualizar"; }
}

function render(d){
  $("lastSync").textContent="Atualizado "+new Date(d.synchronizedAt).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  $("attentionCount").textContent=d.kpis.attention;
  $("kpiActive").textContent=d.kpis.active;
  $("kpiOverdue").textContent=d.kpis.overdue;
  $("kpiDueSoon").textContent=d.kpis.dueSoon;
  $("kpiUnassigned").textContent=d.kpis.unassigned;

  $("attentionList").innerHTML=d.attention.length ? d.attention.slice(0,9).map(c=>`
    <a class="attention-item" href="${esc(c.url||"#")}" target="_blank" rel="noopener">
      <strong>${esc(c.title)}</strong>
      <div class="attention-meta">
        <span>${esc(c.pipe.name)}</span>
        ${c.attentionReasons.map(x=>`<span class="badge-light">${esc(x)}</span>`).join("")}
      </div>
    </a>`).join("") : '<div class="attention-item"><strong>Nenhuma demanda crítica neste momento.</strong><div class="attention-meta">Tudo sob controle.</div></div>';

  $("workloadList").innerHTML=d.workload.length ? d.workload.map((p,i)=>{
    return `
    <div class="workload-row ${i<3?"top":""}">
      <div class="workload-name"><strong>${p.rank}. ${esc(p.name)}</strong><span>${p.attention} exigindo atenção</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,Math.min(100,p.percentOfMax))}%"></div></div>
      <div class="load-value">${p.count}<small>${p.percentOfMax}% da maior carga</small></div>
    </div>`}).join("") : '<p class="muted">Nenhuma demanda atribuída.</p>';

  const maxPipe=Math.max(1,...d.distributions.pipes.map(x=>x.count));
  $("pipeBars").innerHTML=d.distributions.pipes.map(x=>`
    <div class="pipe-tile">
      <strong>${x.count}</strong>
      <span>${esc(x.name)}</span>
      <div class="mini-meter"><i style="width:${Math.round(x.count/maxPipe*100)}%"></i></div>
    </div>`).join("");

  if(d.warnings?.length){ $("warnings").innerHTML=d.warnings.map(w=>`<div>${esc(w)}</div>`).join(""); $("warnings").classList.remove("hidden"); }
  else $("warnings").classList.add("hidden");

  fillSelect($("pipeFilter"),d.distributions.pipes,"Todas as frentes");
  fillSelect($("phaseFilter"),d.distributions.phases,"Todas as fases");
  fillSelect($("personFilter"),d.workload.map(x=>({id:x.id,name:x.name})),"Todos os responsáveis");
  applyFilters();
}

function fillSelect(sel,items,first){
  const previous=sel.value;
  sel.innerHTML=`<option value="">${first}</option>`+items.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");
  if([...sel.options].some(o=>o.value===previous)) sel.value=previous;
}

function applyFilters(){
  if(!state.data)return;
  const q=$("searchInput").value.trim().toLowerCase();
  const pipe=$("pipeFilter").value, phase=$("phaseFilter").value, person=$("personFilter").value, status=$("statusFilter").value;
  state.filtered=state.data.cards.filter(c=>{
    if(q && !c.title.toLowerCase().includes(q))return false;
    if(pipe && c.pipe.id!==pipe)return false;
    if(phase && c.phase?.id!==phase)return false;
    if(person && !c.assignees.some(a=>a.id===person))return false;
    if(status==="attention" && !reasons(c).length)return false;
    if(status==="overdue" && !(c.overdue||c.late||c.expired))return false;
    if(status==="dueSoon"){const d=daysUntil(c.dueDate); if(!(d!==null&&d>=0&&d<=7))return false;}
    if(status==="unassigned" && c.assignees.length)return false;
    return true;
  });
  renderTable();
}

function renderTable(){
  $("filteredCount").textContent=`${state.filtered.length} de ${state.data.cards.length} abertas`;
  $("demandsBody").innerHTML=state.filtered.map(c=>{
    const rs=reasons(c), delayed=c.overdue||c.late||c.expired;
    const status=delayed?'<span class="status-badge red">Atrasada</span>':rs.length?'<span class="status-badge amber">Atenção</span>':'<span class="status-badge">Em andamento</span>';
    return `<tr>
      <td><a href="${esc(c.url||"#")}" target="_blank" rel="noopener">${esc(c.title)}</a><span class="subtext">Atualizada ${c.updatedAt?new Date(c.updatedAt).toLocaleDateString("pt-BR"):"—"}</span></td>
      <td><strong>${esc(c.pipe.name)}</strong><span class="subtext">${esc(c.phase?.name||"Sem fase")}</span></td>
      <td>${c.assignees.length?c.assignees.map(a=>esc(a.name)).join(", "):'<span class="status-badge amber">Sem responsável</span>'}</td>
      <td>${fmtDate(c.dueDate)}</td>
      <td>${status}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="5" class="muted">Nenhuma demanda encontrada com estes filtros.</td></tr>';
}

["searchInput","pipeFilter","phaseFilter","personFilter","statusFilter"].forEach(id=>$(id).addEventListener(id==="searchInput"?"input":"change",applyFilters));
$("viewAttentionBtn").addEventListener("click",()=>{
  if(!state.data)return;
  ["searchInput","pipeFilter","phaseFilter","personFilter"].forEach(id=>$(id).value="");
  $("statusFilter").value="attention";
  applyFilters();
  $("demandsSection").scrollIntoView({block:"start"});
  $("statusFilter").focus({preventScroll:true});
});
init();
