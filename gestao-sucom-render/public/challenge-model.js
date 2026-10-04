// Shared deterministic scoring for the trial view. No Pipefy mutations.
export function day(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value ? value : null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function ownerOf(card, override) {
  const people = card.assignees || [];
  if (override?.ownerId && people.some(p=>p.id===override.ownerId)) return override.ownerId;
  const fields = (card.fields || []).filter(f=>['responsavel principal','responsavel pela demanda'].includes(normalize(f.name)));
  const matches = people.filter(p=>fields.some(f=>normalize(f.value)===normalize(p.name) || String(f.value)===p.id));
  if(matches.length===1) return matches[0].id;
  return people.length===1 ? people[0].id : null;
}
export function calculate(cards, people, {start, end, overrides={}, now=new Date()}={}) {
  if(!day(start)||!day(end)||start>end) throw new Error('Escolha uma data inicial e final válidas.');
  const today=day(now), rows=[], seen=new Set();
  const stats=people.map(p=>({...p,onTime:0,late:0,overdue:0,upcoming:0,dueSoon:0,support:0,pending:0,excluded:0,total:0,denominator:0,score:null}));
  const lookup=new Map(stats.map(p=>[p.id,p]));
  for(const card of cards){
    if(seen.has(card.id))continue;seen.add(card.id);
    if(!card.assignees?.some(p=>lookup.has(p.id)))continue;
    const rule=overrides[card.id] || {}, due=day(rule.dueDate || card.dueDate), completed=day(card.finishedAt);
    if(due && (due<start||due>end))continue;
    const ownerId=ownerOf(card,rule), owner=lookup.get(ownerId);
    const phase=normalize(card.phase?.name);
    let status;
    if(rule.excluded && rule.reason?.trim())status='excluded';
    else if(!due || !ownerId || /\b(suspens[ao]s?|suspendid[ao]s?|cancelad[ao]s?)\b/.test(phase) || (card.done && (!completed || completed>today)))status='pending';
    else if(card.done)status=completed<=due?'onTime':'late';
    else status=due<today?'overdue':'upcoming';
    const dueSoon=status==='upcoming' && (Date.parse(due)-Date.parse(today))/86400000<=7;
    const row={...card,ownerId,due,completed,status,dueSoon,reason:rule.reason || '',referenceAdjusted:Boolean(rule.dueDate)};
    rows.push(row);
    if(owner){
      owner.total++;owner[status]++;if(dueSoon)owner.dueSoon++;
    }else if(!ownerId){
      for(const p of card.assignees)if(lookup.has(p.id))lookup.get(p.id).pending++;
    }
    // Only known non-primary assignees count as support, never as points.
    if(ownerId && status!=='excluded') for(const p of card.assignees)if(p.id!==ownerId && lookup.has(p.id))lookup.get(p.id).support++;
  }
  for(const p of stats){p.denominator=p.onTime+p.late+p.overdue;p.score=p.denominator?p.onTime/p.denominator*100:null;}
  stats.sort((a,b)=>(b.score??-1)-(a.score??-1)||a.name.localeCompare(b.name));
  return {people:stats,rows,today,partial:end>=today,pending:rows.filter(r=>r.status==='pending').length};
}
