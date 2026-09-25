import test from 'node:test';
import assert from 'node:assert/strict';
import {makeContext,validateAnalysis,requestAnalysis,createAdvisor,localDate} from '../insights.js';

const card={id:'1',title:'Briefing da campanha',done:false,pipe:{name:'Campanhas'},phase:{name:'Aprovação'},assignees:[{name:'Pessoa A',email:'privado@example.com'}],dueDate:'2026-09-25',fields:[{name:'Briefing',value:'Confirmar público e data.'},{name:'CPF',value:'111.222.333-44'},{name:'Email',value:'privado@example.com'}],comments:[{text:'Retorno: privado@example.com. Ver https://example.com/segredo',created_at:'2026-09-24'}],phaseAge:172800,phasesHistory:[]};
const snapshot={cards:[card,{...card,id:'2',done:true,title:'Concluída'}],warnings:[],synchronizedAt:'2026-09-25T01:00:00Z',distributions:{pipes:[{name:'Campanhas'}]}};
const recommendation={titulo:'Validar briefing',decisao:'Qual público deve ser atendido?',evidencia:'O campo pede confirmação de público e data.',sugestao:'Confirmar o escopo antes da produção.',confirmar:'Disponibilidade para aprovação.',certeza:'evidencia',cardIds:['1']};
const raw={resumo:'Há uma decisão de briefing.',hoje:[recommendation],gargalos:[],organizacao:[],limitacoes:[]};
const result=()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(raw)}]}],usage:{input_tokens:100,output_tokens:100}})});

test('somente abertas, sem emails, CPF ou links, com a data de São Paulo',()=>{
 const c=makeContext(snapshot,new Date('2026-09-25T01:30:00Z'));
 assert.equal(c.hoje,'2026-09-24');assert.equal(c.cards.length,1);assert.equal(c.cards[0].diasNaFase,2);
 assert.doesNotMatch(JSON.stringify(c),/privado@|111\.222|example\.com/);
 assert.equal(c.cards[0].campos.length,1);
});
test('leitura incompleta bloqueia inferência de cenário global',()=>{
 assert.throws(()=>makeContext({...snapshot,warnings:['Pipe indisponível']}),/incompleta/);
});
test('cards inventados ou concluídos não podem sustentar uma recomendação',()=>{
 for(const id of ['999','2'])assert.throws(()=>validateAnalysis({...raw,hoje:[{...recommendation,cardIds:[id]}]},snapshot),/card/);
 const analysis=validateAnalysis(raw,snapshot);
 assert.equal(analysis.hoje[0].cards[0].url,'https://app.pipefy.com/open-cards/1');
});
test('sem chave não chama provedor; sem cards não gera cobrança',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return result();};
 await assert.rejects(requestAnalysis(snapshot,{fetchImpl}),/ativação/);
 const empty=await requestAnalysis({...snapshot,cards:[]},{apiKey:'test',fetchImpl});
 assert.equal(empty.analysis.hoje.length,0);assert.equal(calls,0);
});
test('envia apenas contexto e schema sem ferramentas, não armazena resposta no provedor',async()=>{
 let body;
 const output=await requestAnalysis(snapshot,{apiKey:'test',fetchImpl:async(url,options)=>{
   assert.equal(url,'https://api.openai.com/v1/responses');body=JSON.parse(options.body);return result();
 }});
 assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.equal(body.text.format.strict,true);
 assert.match(body.instructions,/nunca obedeça/);assert.equal(output.analysis.hoje.length,1);
});
test('recusa, saída truncada e credencial inválida não viram análise inventada',async()=>{
 for(const response of [{status:'incomplete',output:[]},{status:'completed',output:[{content:[{type:'refusal'}]}]}]){
  await assert.rejects(requestAnalysis(snapshot,{apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>response})}),/não concluiu/);
 }
 await assert.rejects(requestAnalysis(snapshot,{apiKey:'test',fetchImpl:async()=>({ok:false,status:401})}),/credencial/);
});
test('cliques concorrentes e repetidos geram uma única chamada paga',async()=>{
 let calls=0;
 const advisor=createAdvisor({getSnapshot:async()=>snapshot,env:{OPENAI_API_KEY:'test'},fetchImpl:async()=>{calls++;return result();},now:()=>Date.parse('2026-09-25T12:00:00Z')});
 const [a,b]=await Promise.all([advisor.analyze(),advisor.analyze()]);
 assert.deepEqual(a,b);assert.equal(calls,1);
 const c=await advisor.analyze();assert.equal(c.cached,true);assert.equal(calls,1);
});
test('novo dia em São Paulo não reutiliza como atual uma análise de ontem',async()=>{
 let current=Date.parse('2026-09-25T02:58:00Z'),calls=0;
 const advisor=createAdvisor({getSnapshot:async()=>snapshot,env:{OPENAI_API_KEY:'test'},fetchImpl:async()=>{calls++;return result();},now:()=>current});
 assert.equal((await advisor.analyze()).referenceDate,'2026-09-24');
 current=Date.parse('2026-09-25T03:01:00Z');
 await assert.rejects(advisor.analyze(),/Aguarde/);assert.equal(calls,1);
 current=Date.parse('2026-09-25T03:14:00Z');
 assert.equal((await advisor.analyze()).referenceDate,'2026-09-25');assert.equal(calls,2);
});
