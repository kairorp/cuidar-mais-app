let state = { data: null, filtered: [] };
const $ = id => document.getElementById(id);

function toast(message){ const el=$("toast"); el.textContent=message; el.classList.remove("hidden"); setTimeout(()=>el.classList.add("hidden"),2800); }
function esc(v){ return String(v??"").replace(/[&<>"']/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[s])); }
function fmtDate(v){ if(!v)return "Sem prazo"; const d=new Date(v); return Number.isNaN(d)? "Sem prazo": d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"2-digit"}); }
function daysUntil(v){ if(!v)return null; const d=new Date(v); if(Number.isNaN(d))return null; return Math.ceil((d-Date.now())/86400000); }
function reasons(card){ const r=[]; if(card.overdue||card.late||card.expired)r.push("Atrasada"); const d=daysUntil(card.dueDate); if(d!==null&&d>=0&&d<=2)r.push(d===0?"Vence hoje":`Vence em ${d} dia${d===1?"":"s"}`); if(!card.assignees.length)r.push("Sem responsável"); return r; }

async function api(path, opts={}){
  const res=await fetch(path,{...opts,credentials:"same-origin",headers:{"Content-Type":"application/json",...(opts.headers||{})}});
  const data=await res.json().catch(()=>({}));
  if(res.status===401 && path!=="/api/login"){ showLogin(); throw new Error("Sessão expirada."); }
  if(!res.ok) throw new Error(data.error||"Falha na solicitação.");
  return data;
}

function showLogin(){ $("loginView").classList.remove("hidden"); $("appView").classList.add("hidden"); }
function showApp(){ $("loginView").classList.add("hidden"); $("appView").classList.remove("hidden"); loadAnalysisStatus(); }

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
let analysisRunning=false;
function analysisDate(value){return new Date(value).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"});}
async function loadAnalysisStatus(){
  try{
    const info=await api("/api/insights");
    $("analyzeBtn").disabled=!info.configured||analysisRunning;
    $("analysisStatus").textContent=info.configured
      ? "Pronto para analisar. A leitura é feita ao clicar; análises recentes são reaproveitadas por 15 minutos."
      : "A área está pronta. A análise por IA aguarda ativação do serviço de inteligência artificial.";
    if(info.latest)renderAnalysis(info.latest);
  }catch(err){$("analysisStatus").textContent=err.message;}
}
function renderAnalysis(report){
  const group=(key,title)=>`<section class="analysis-group"><h3>${title}</h3>${report[key].length
    ?`<div class="analysis-items">${report[key].map(item=>`<article class="analysis-item">
      <span class="analysis-label ${item.certeza==="hipotese"?"hypothesis":""}">${item.certeza==="hipotese"?"Hipótese para validar":"Base nos cards"}</span>
      <h4>${esc(item.titulo)}</h4>
      <p><strong>Decisão:</strong> ${esc(item.decisao)}</p>
      <p class="evidence"><strong>Por quê:</strong> ${esc(item.evidencia)}</p>
      <p><strong>Sugestão:</strong> ${esc(item.sugestao)}</p>
      ${item.confirmar?`<p class="evidence"><strong>Antes de decidir:</strong> ${esc(item.confirmar)}</p>`:""}
      <div class="analysis-links">${item.cards.map(c=>`<a href="https://app.pipefy.com/open-cards/${encodeURIComponent(c.id)}" target="_blank" rel="noopener noreferrer">${esc(c.title)} ↗</a>`).join("")}</div>
    </article>`).join("")}</div>`:'<p class="analysis-empty">Sem recomendação adicional sustentada pelos cards nesta análise.</p>'}</section>`;
  $("analysisReport").innerHTML=`<p class="analysis-summary">${esc(report.resumo)}</p>
    <p class="analysis-date">Análise de ${analysisDate(report.generatedAt)} · ${report.activeCards} demandas abertas · ${report.pipes} frentes · dados coletados em ${analysisDate(report.synchronizedAt)}</p>
    ${group("hoje","Decidir hoje")}${group("gargalos","Destravar entregas")}${group("organizacao","Reorganizar demandas")}
    <details class="analysis-limits"><summary>Limites desta análise</summary><ul>${report.limitacoes.map(l=>`<li>${esc(l)}</li>`).join("")}</ul></details>`;
  $("analysisReport").classList.remove("hidden");
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  if(report.referenceDate!==today)$("analysisStatus").textContent="Esta análise é de outro dia. Gere uma nova antes de definir as prioridades de hoje.";
}
$("analyzeBtn").addEventListener("click",async()=>{
  if(analysisRunning)return;
  analysisRunning=true; const btn=$("analyzeBtn");btn.disabled=true;btn.textContent="Analisando…";
  $("analysisError").classList.add("hidden");
  $("analysisStatus").textContent="Lendo as demandas abertas e preparando sugestões. Isso pode levar cerca de um minuto.";
  try{
    const data=await api("/api/insights",{method:"POST",headers:{"X-Sucom-Analysis":"read-only"},body:"{}"});
    renderAnalysis(data.report);
    $("analysisStatus").textContent=data.report.cached?"Exibindo a análise recente, sem uma nova chamada à IA.":"Análise concluída. Confira os cards e decida os próximos passos.";
  }catch(err){
    $("analysisError").textContent=err.message;$("analysisError").classList.remove("hidden");
    $("analysisStatus").textContent="Não foi possível concluir uma nova análise. Nenhuma demanda foi alterada.";
  }finally{analysisRunning=false;btn.disabled=false;btn.textContent="Analisar cenário";}
});
init();
