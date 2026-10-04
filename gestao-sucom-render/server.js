import express from "express";
import crypto from "node:crypto";
import { ANALYSIS_QUERY_FIELDS, createAdvisor } from "./insights.js";

import { classifyCard } from "./card-status.js";

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.static("public", {
  maxAge: "1h", etag: true,
  setHeaders(res, path) {
    if (path.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  },
}));

const PORT = process.env.PORT || 10000;
const PIPEFY_CLIENT_ID = process.env.PIPEFY_CLIENT_ID || "cAgQJc_xj4pxiBz-yM86t8umUc6ywOANmsFdwXvP5QU";
const PIPEFY_ORG_ID = process.env.PIPEFY_ORG_ID || "301076130";
const PIPE_IDS = (process.env.PIPEFY_PIPE_IDS || "303430099,303318555,303217226,306878960,306797715,303436854,303318888,303500097,303318834")
  .split(",").map(s => s.trim()).filter(Boolean);

const TOKEN_URL = "https://app.pipefy.com/oauth/token";
const GRAPHQL_URL = "https://api.pipefy.com/graphql";
const PAGE_SIZE = 50;
const CACHE_MS = 60_000;

let tokenCache = null;
let tokenInflight = null;
let dashboardCache = null;
let advisoryReadCheck = { ready: false, checkedPipes: 0 };

function envReady() {
  return Boolean(process.env.PIPEFY_CLIENT_SECRET && process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET);
}

function safeError(err) {
  if (err && typeof err.message === "string") return err.message.replace(/Bearer\s+\S+/gi, "Bearer [oculto]");
  return "Erro inesperado.";
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return Object.fromEntries(raw.split(";").map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf("=");
    return i === -1 ? [v, ""] : [decodeURIComponent(v.slice(0, i)), decodeURIComponent(v.slice(i + 1))];
  }));
}

function signSession(exp) {
  const payload = Buffer.from(JSON.stringify({ ok: true, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifySession(token) {
  if (!token || !process.env.SESSION_SECRET) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data?.ok === true && Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

function requireAuth(req, res, next) {
  const token = parseCookies(req).sucom_session;
  if (!verifySession(token)) return res.status(401).json({ ok: false, error: "Sessão expirada ou não autenticada." });
  next();
}

app.post("/api/login", (req, res) => {
  if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
    return res.status(503).json({ ok: false, error: "Acesso administrativo ainda não configurado." });
  }
  const supplied = String(req.body?.password || "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(process.env.ADMIN_PASSWORD);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) return res.status(401).json({ ok: false, error: "Senha incorreta." });
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  res.setHeader("Set-Cookie", `sucom_session=${encodeURIComponent(signSession(exp))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`);
  res.json({ ok: true });
});

app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "sucom_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
  res.json({ authenticated: verifySession(parseCookies(req).sucom_session) });
});

async function getToken() {
  if (!process.env.PIPEFY_CLIENT_SECRET) throw new Error("PIPEFY_CLIENT_SECRET não configurado.");
  if (tokenCache && Date.now() < tokenCache.expiresAt - 120_000) return tokenCache.token;
  if (tokenInflight) return tokenInflight;

  tokenInflight = (async () => {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: PIPEFY_CLIENT_ID,
        client_secret: process.env.PIPEFY_CLIENT_SECRET,
      }),
    });
    if (!response.ok) throw new Error(`Autenticação Pipefy recusada (HTTP ${response.status}).`);
    const data = await response.json();
    if (!data.access_token) throw new Error("Pipefy não retornou access_token.");
    tokenCache = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
    return data.access_token;
  })().finally(() => { tokenInflight = null; });

  return tokenInflight;
}

async function gql(query, variables) {
  // Enforce read-only access independently of the account permissions.
  if (!/^\s*query\b/.test(query)) throw new Error("A integração aceita somente consultas.");
  let token = await getToken();
  let response = await fetch(GRAPHQL_URL, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (response.status === 401) {
    tokenCache = null;
    token = await getToken();
    response = await fetch(GRAPHQL_URL, {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });
  }
  if (!response.ok) throw new Error(`Pipefy GraphQL respondeu HTTP ${response.status}.`);
  const json = await response.json();
  if (json.errors?.length) throw new Error(`Pipefy: ${json.errors[0].message}`);
  if (!json.data) throw new Error("Pipefy retornou resposta vazia.");
  return json.data;
}

const PIPE_QUERY = `
  query Pipes($ids: [ID]!) {
    pipes(ids: $ids) { id name }
  }
`;

const ACTIVE_CARDS_QUERY = `
  query ActiveCards($pipeId: ID!, $first: Int!, $after: String) {
    cards(pipe_id: $pipeId, first: $first, after: $after, search: { include_done: false }) {
      edges {
        node {
          id
          title
          url
          done
          due_date
          overdue
          late
          expired
          updated_at
          createdAt
          current_phase { id name }
          pipe { id name }
          assignees { id name email avatarUrl }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

async function fetchPipes() {
  const data = await gql(PIPE_QUERY, { ids: PIPE_IDS });
  const pipes = (data.pipes || []).filter(Boolean).map(p => ({ id: String(p.id), name: p.name }));
  const index = new Map(pipes.map(p => [p.id, p]));
  return PIPE_IDS.map(id => index.get(id) || { id, name: `Pipe ${id}` });
}

const DETAILED_CARDS_QUERY = ACTIVE_CARDS_QUERY.replace("updated_at", `updated_at ${ANALYSIS_QUERY_FIELDS}`);

async function fetchActiveCardsForPipe(pipe, detailed = false) {
  const out = [];
  let after = null;
  let pages = 0;
  while (pages < 100) {
    pages += 1;
    const data = await gql(detailed ? DETAILED_CARDS_QUERY : ACTIVE_CARDS_QUERY, { pipeId: pipe.id, first: PAGE_SIZE, after });
    const connection = data.cards;
    if (!connection) throw new Error(`Sem retorno ao consultar ${pipe.name}.`);
    for (const edge of connection.edges || []) {
      const c = edge.node;
      if (c.done) continue;
      out.push({
        id: String(c.id),
        title: c.title || "(sem título)",
        url: c.url || null,
        done: false,
        ...(detailed ? { fields: c.fields || [], comments: c.comments || [],
          phaseAge: c.current_phase_age, phasesHistory: c.phases_history || [] } : {}),
        dueDate: c.due_date || null,
        overdue: Boolean(c.overdue),
        late: Boolean(c.late),
        expired: Boolean(c.expired),
        updatedAt: c.updated_at || null,
        createdAt: c.createdAt || null,
        phase: c.current_phase ? { id: String(c.current_phase.id), name: c.current_phase.name } : null,
        pipe: c.pipe ? { id: String(c.pipe.id), name: c.pipe.name } : pipe,
        assignees: (c.assignees || []).map(a => ({ id: String(a.id), name: a.name, email: a.email || null, avatarUrl: a.avatarUrl || null })),
      });
    }
    if (!connection.pageInfo?.hasNextPage || !connection.pageInfo?.endCursor) break;
    after = connection.pageInfo.endCursor;
    if (pages === 100) throw new Error("Limite de páginas atingido; leitura incompleta.");
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  const result = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      result[i] = await fn(items[i], i);
    }
  }));
  return result;
}

function buildSnapshot(pipes, cards, warnings) {
  const now = new Date();
  const active = cards.filter(c => !c.done).map(c => classifyCard(c, now));
  active.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  const attention = active
    .filter(card => card.attentionReasons.length)
    .sort((a, b) => {
      const aa = Number(a.overdue);
      const bb = Number(b.overdue);
      if (aa !== bb) return bb - aa;
      return (a.dueDays ?? 9999) - (b.dueDays ?? 9999);
    });

  const workloadMap = new Map();
  for (const card of active) {
    for (const person of card.assignees) {
      const current = workloadMap.get(person.id) || { id: person.id, name: person.name, email: person.email, avatarUrl: person.avatarUrl || null, count: 0, attention: 0 };
      current.count += 1;
      if (card.attentionReasons.length) current.attention += 1;
      workloadMap.set(person.id, current);
    }
  }
  const workload = [...workloadMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const maxLoad = workload[0]?.count || 1;
  workload.forEach((x, i) => {
    x.percentOfMax = Math.round((x.count / maxLoad) * 100);
    x.rank = i + 1;
  });

  const byPipe = pipes.map(pipe => ({
    id: pipe.id,
    name: pipe.name,
    count: active.filter(c => c.pipe.id === pipe.id).length,
  })).sort((a, b) => b.count - a.count);

  const phaseMap = new Map();
  for (const card of active) {
    const key = card.phase?.id || "sem-fase";
    const item = phaseMap.get(key) || { id: key, name: card.phase?.name || "Sem fase", count: 0 };
    item.count += 1;
    phaseMap.set(key, item);
  }
  const byPhase = [...phaseMap.values()].sort((a, b) => b.count - a.count);

  const overdue = active.filter(c => c.overdue).length;
  const dueSoon = active.filter(c => c.dueSoon).length;
  const unassigned = active.filter(c => !c.assignees.length).length;

  return {
    source: "Pipefy",
    synchronizedAt: new Date().toISOString(),
    kpis: {
      active: active.length,
      attention: attention.length,
      overdue,
      dueSoon,
      unassigned,
    },
    attention,
    workload,
    distributions: { pipes: byPipe, phases: byPhase },
    cards: active,
    warnings,
  };
}

async function getDashboard(force = false) {
  if (!force && dashboardCache && Date.now() - dashboardCache.at < CACHE_MS) return dashboardCache.data;

  const pipes = await fetchPipes();
  const warnings = [];
  const results = await mapLimit(pipes, 3, async pipe => {
    try {
      return await fetchActiveCardsForPipe(pipe);
    } catch (err) {
      warnings.push(`Não foi possível consultar ${pipe.name}: ${safeError(err)}`);
      return [];
    }
  });
  const data = buildSnapshot(pipes, results.flat(), warnings);
  dashboardCache = { at: Date.now(), data };
  return data;
}

async function getAnalysisSnapshot() {
  const pipes = await fetchPipes();
  if (pipes.length !== PIPE_IDS.length) throw new Error("Nem todos os pipes estão acessíveis para análise.");
  const results = await mapLimit(pipes, 2, pipe => fetchActiveCardsForPipe(pipe, true));
  return buildSnapshot(pipes, results.flat(), []);
}
const advisor = createAdvisor({ getSnapshot: getAnalysisSnapshot });
app.get("/api/insights", requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, ...advisor.status() });
});
app.post("/api/insights", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  // Only the same-origin UI can initiate a potentially billable analysis.
  if (req.headers["x-sucom-analysis"] !== "read-only" || req.headers["sec-fetch-site"] === "cross-site") {
    return res.status(403).json({ ok: false, error: "Solicitação não autorizada." });
  }
  try { res.json({ ok: true, report: await advisor.analyze() }); }
  catch (err) {
    console.error("[analysis] Failed", err.status || 502);
    res.status(err.status || 502).json({ ok: false, error: err.status ? err.message : "Não foi possível ler todos os cards. Atualize os dados e tente novamente." });
  }
});

// Separate, authenticated historical read for the challenge. Never enters dashboard KPIs.
const CHALLENGE_QUERY = ACTIVE_CARDS_QUERY
  .replace('query ActiveCards', 'query ChallengeCards')
  .replace('include_done: false', 'include_done: true')
  .replace('updated_at', 'updated_at finished_at fields { name value }');
let challengeJob = { status: 'idle' };
let challengeInflight = null;
async function loadChallengeCards() {
  const pipes = await fetchPipes();
  // fetchPipes has fallbacks for the dashboard; require all real pipes here.
  const accessible = await gql(PIPE_QUERY, {ids: PIPE_IDS});
  if((accessible.pipes || []).filter(Boolean).length !== PIPE_IDS.length) throw new Error('Acesso incompleto aos pipes.');
  let count=0;
  const results = await mapLimit(pipes, 2, async pipe => {
    const cards=[];let after=null;const cursors=new Set();
    for(let page=0;page<200;page++) {
      const data=await gql(CHALLENGE_QUERY,{pipeId:pipe.id,first:PAGE_SIZE,after});
      if(!data.cards)throw new Error('Leitura histórica incompleta.');
      for(const {node:c} of data.cards.edges || [])cards.push({
        id:String(c.id),title:c.title || '(sem título)',done:Boolean(c.done),
        dueDate:c.due_date || null,finishedAt:c.finished_at || null,
        phase:c.current_phase,pipe,fields:c.fields || [],
        assignees:(c.assignees || []).map(a=>({id:String(a.id),name:a.name,avatarUrl:a.avatarUrl || null}))
      });
      challengeJob.readCards=count+cards.length;
      if(!data.cards.pageInfo?.hasNextPage){count+=cards.length;challengeJob.readCards=count;return cards;}
      const cursor=data.cards.pageInfo.endCursor;
      if(!cursor || cursors.has(cursor))throw new Error('Paginação histórica incompleta.');
      cursors.add(cursor);after=cursor;
    }
    throw new Error('Leitura histórica excedeu o limite. Nenhum resultado parcial foi calculado.');
  });
  const cards=[...new Map(results.flat().map(c=>[c.id,c])).values()];
  console.log('[challenge-read-check]',JSON.stringify({pipes:pipes.length,cards:cards.length,finished:cards.filter(c=>c.done).length}));
  return {cards,pipes:pipes.length,synchronizedAt:new Date().toISOString()};
}
app.get('/api/challenge',requireAuth,(_req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(challengeJob.status==='ready')return res.json({ok:true,status:'ready',...challengeJob.data});
  res.json({ok:true,status:challengeJob.status,readCards:challengeJob.readCards || 0,error:challengeJob.error || null});
});
app.post('/api/challenge',requireAuth,(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.headers['x-sucom-analysis']!=='read-only' || req.headers['sec-fetch-site']==='cross-site')return res.status(403).json({ok:false,error:'Solicitação não autorizada.'});
  if(!challengeInflight && !(challengeJob.status==='ready' && Date.now()-challengeJob.at<60000)){
    challengeJob={status:'loading',readCards:0};
    challengeInflight=loadChallengeCards().then(data=>{challengeJob={status:'ready',data,at:Date.now()};})
      .catch(err=>{console.error('[challenge] Failed:',safeError(err));challengeJob={status:'error',error:'Não foi possível ler todos os pipes. Tente novamente; nenhum resultado parcial será exibido.'};})
      .finally(()=>{challengeInflight=null;});
  }
  res.status(202).json({ok:true,status:challengeJob.status});
});

app.get("/api/health", async (_req, res) => {
  const base = {
    ok: true,
    configured: envReady(),
    pipefyConfigured: Boolean(process.env.PIPEFY_CLIENT_SECRET),
    adminConfigured: Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET),
    expectedPipes: PIPE_IDS.length,
    release: "2026-10-04-challenge-trial",
    aiConfigured: Boolean(process.env.OPENAI_API_KEY) && process.env.AI_ENABLED !== "false",
    aiReadOnly: true,
    advisoryReadCheck,
  };
  if (!process.env.PIPEFY_CLIENT_SECRET) return res.status(503).json({ ...base, ok: false });
  try {
    const pipes = await fetchPipes();
    res.json({ ...base, pipefyAuth: true, accessiblePipes: pipes.length, pipeNames: pipes.map(p => p.name) });
  } catch (err) {
    res.status(502).json({ ...base, ok: false, pipefyAuth: false, error: safeError(err) });
  }
});

app.get("/api/dashboard", requireAuth, async (req, res) => {
  try {
    const data = await getDashboard(req.query.force === "1");
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(502).json({ ok: false, error: safeError(err) });
  }
});

app.use((_req, res) => res.sendFile(new URL("./public/index.html", import.meta.url).pathname));

const server = app.listen(PORT, "0.0.0.0", async () => {
  console.log(`Gestão SUCOM ativo na porta ${server.address().port}`);
  if (!process.env.PIPEFY_CLIENT_SECRET) {
    console.log("[startup-check] PIPEFY_CLIENT_SECRET ausente; validação adiada.");
    return;
  }
  try {
    const snapshot = await getDashboard(true);
    console.log("[deadline-check]", JSON.stringify({suspended:snapshot.cards.filter(c=>c.suspended).length, overdue:snapshot.kpis.overdue, phaseFlagsWithoutOverdue:snapshot.cards.filter(c=>!c.overdue&&(c.late||c.expired)).length}));
    console.log("[startup-check] Pipefy OK", JSON.stringify({
      active: snapshot.kpis.active,
      attention: snapshot.kpis.attention,
      overdue: snapshot.kpis.overdue,
      dueSoon: snapshot.kpis.dueSoon,
      unassigned: snapshot.kpis.unassigned,
      pipes: snapshot.distributions.pipes.map(p => ({ name: p.name, active: p.count })),
      topWorkload: snapshot.workload.slice(0, 5).map(p => ({ name: p.name, active: p.count, attention: p.attention })),
      warnings: snapshot.warnings,
    }));
    const accessChecks = await mapLimit(snapshot.distributions.pipes, 2, async pipe => {
      const data = await gql(DETAILED_CARDS_QUERY, {pipeId:pipe.id,first:1,after:null});
      const trial = await gql(CHALLENGE_QUERY, {pipeId:pipe.id,first:1,after:null});
      if (!trial.cards) throw new Error("Leitura do desafio indisponível.");
      if (!data.cards) throw new Error("Leitura detalhada indisponível.");
      return {pipeId:pipe.id, available:true};
    });
    advisoryReadCheck = {ready:accessChecks.length === PIPE_IDS.length, checkedPipes:accessChecks.length};
    console.log("[challenge-schema-check]", JSON.stringify({checkedPipes:accessChecks.length,ready:true}));
    console.log("[advisory-read-check]", JSON.stringify({...advisoryReadCheck,aiConfigured:advisor.status().configured}));
  } catch (err) {
    console.error("[startup-check] Pipefy FALHOU:", safeError(err));
  }
});
