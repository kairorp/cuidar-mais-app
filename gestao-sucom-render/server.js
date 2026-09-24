import express from "express";
import crypto from "node:crypto";

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.static("public", { maxAge: "1h", etag: true }));

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
  let token = await getToken();
  let response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (response.status === 401) {
    tokenCache = null;
    token = await getToken();
    response = await fetch(GRAPHQL_URL, {
      method: "POST",
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
          assignees { id name email }
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

async function fetchActiveCardsForPipe(pipe) {
  const out = [];
  let after = null;
  let pages = 0;
  while (pages < 100) {
    pages += 1;
    const data = await gql(ACTIVE_CARDS_QUERY, { pipeId: pipe.id, first: PAGE_SIZE, after });
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
        dueDate: c.due_date || null,
        overdue: Boolean(c.overdue),
        late: Boolean(c.late),
        expired: Boolean(c.expired),
        updatedAt: c.updated_at || null,
        createdAt: c.createdAt || null,
        phase: c.current_phase ? { id: String(c.current_phase.id), name: c.current_phase.name } : null,
        pipe: c.pipe ? { id: String(c.pipe.id), name: c.pipe.name } : pipe,
        assignees: (c.assignees || []).map(a => ({ id: String(a.id), name: a.name, email: a.email || null })),
      });
    }
    if (!connection.pageInfo?.hasNextPage || !connection.pageInfo?.endCursor) break;
    after = connection.pageInfo.endCursor;
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

function localDay(dateLike) {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dueInDays(dueDate) {
  const d = localDay(dueDate);
  if (!d) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

function attentionReasons(card) {
  const reasons = [];
  if (card.overdue || card.late || card.expired) reasons.push("Atrasada");
  const days = dueInDays(card.dueDate);
  if (days !== null && days >= 0 && days <= 2) reasons.push(days === 0 ? "Vence hoje" : `Vence em ${days} dia${days === 1 ? "" : "s"}`);
  if (!card.assignees.length) reasons.push("Sem responsável");
  return reasons;
}

function buildSnapshot(pipes, cards, warnings) {
  const active = cards.filter(c => !c.done);
  active.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  const attention = active
    .map(card => ({ ...card, attentionReasons: attentionReasons(card) }))
    .filter(card => card.attentionReasons.length)
    .sort((a, b) => {
      const aa = Number(a.overdue || a.late || a.expired);
      const bb = Number(b.overdue || b.late || b.expired);
      if (aa !== bb) return bb - aa;
      return (dueInDays(a.dueDate) ?? 9999) - (dueInDays(b.dueDate) ?? 9999);
    });

  const workloadMap = new Map();
  for (const card of active) {
    for (const person of card.assignees) {
      const current = workloadMap.get(person.id) || { id: person.id, name: person.name, email: person.email, count: 0, attention: 0 };
      current.count += 1;
      if (attentionReasons(card).length) current.attention += 1;
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

  const overdue = active.filter(c => c.overdue || c.late || c.expired).length;
  const dueSoon = active.filter(c => {
    const d = dueInDays(c.dueDate);
    return d !== null && d >= 0 && d <= 7;
  }).length;
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

app.get("/api/health", async (_req, res) => {
  const base = {
    ok: true,
    configured: envReady(),
    pipefyConfigured: Boolean(process.env.PIPEFY_CLIENT_SECRET),
    adminConfigured: Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET),
    expectedPipes: PIPE_IDS.length,
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

app.get("*", (_req, res) => res.sendFile(new URL("./public/index.html", import.meta.url).pathname));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Gestão SUCOM ativo na porta ${PORT}`);
});
