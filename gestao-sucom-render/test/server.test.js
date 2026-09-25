import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';

test('rotas consultivas exigem sessão; ativação ausente é explícita e frontend é novo',async()=>{
 const password=randomUUID();
 const child=spawn(process.execPath,['server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',ADMIN_PASSWORD:password,SESSION_SECRET:randomUUID(),PIPEFY_CLIENT_SECRET:'',OPENAI_API_KEY:'',AI_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
 // PORT=0 gets a free port; server emits the bound port below.
 let buffer='';
 const address=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Server did not start')),5000);
   child.stdout.on('data',chunk=>{buffer+=chunk.toString();const match=buffer.match(/porta (\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}});
   child.once('error',reject);
 });
 try{
   assert.equal((await fetch(address+'/api/insights')).status,401);
   const login=await fetch(address+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
   assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
   const status=await (await fetch(address+'/api/insights',{headers:{cookie}})).json();
   assert.equal(status.configured,false);assert.equal(status.readOnly,true);assert.equal(status.latest,null);
   assert.equal((await fetch(address+'/api/insights',{method:'POST',headers:{cookie}})).status,403);
   const disabled=await fetch(address+'/api/insights',{method:'POST',headers:{cookie,'X-Sucom-Analysis':'read-only'}});
   assert.equal(disabled.status,503);assert.match((await disabled.json()).error,/ativação/);
   const page=await fetch(address+'/');assert.equal(page.headers.get('cache-control'),'no-cache');
   const html=await page.text();assert.match(html,/O que decidir hoje/);assert.doesNotMatch(html,/comms-visual|bubble|Distribuição por fase/);
   const css=await(await fetch(address+'/styles.css')).text();assert.doesNotMatch(css,/radial-gradient|border-radius:50%/);
 }finally{child.kill();await once(child,'exit');}
});
