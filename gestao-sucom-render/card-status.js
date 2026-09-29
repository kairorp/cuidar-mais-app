// All dashboard deadlines use calendar days in the team's timezone.
const dayFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
export function calendarDate(value) {
  if(!value)return null;
  if(typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)){
    const d=new Date(`${value}T12:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===value ? value : null;
  }
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return null;
  const p=Object.fromEntries(dayFormat.formatToParts(date).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function classifyCard(card, now=new Date()) {
  const phase=String(card.phase?.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const suspended=/\b(suspens[ao]s?|suspendid[ao]s?)\b/.test(phase);
  const dueDateDay=calendarDate(card.dueDate),today=calendarDate(now);
  const dueDays=dueDateDay && today ? Math.round((Date.parse(dueDateDay+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000):null;
  const eligible=!card.done && !suspended;
  const overdue=eligible && dueDays!==null && dueDays<0;
  const dueSoon=eligible && dueDays!==null && dueDays>=0 && dueDays<=7;
  const attentionReasons=[];
  if(eligible){
    if(overdue)attentionReasons.push('Atrasada');
    if(dueDays!==null && dueDays>=0 && dueDays<=2)attentionReasons.push(dueDays===0?'Vence hoje':`Vence em ${dueDays} dia${dueDays===1?'':'s'}`);
    if(!card.assignees?.length)attentionReasons.push('Sem responsável');
  }
  return {...card,suspended,dueDateDay,dueDays,overdue,dueSoon,attentionReasons};
}
