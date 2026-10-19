// Levantamento de uso e custo de IA -- Grupo Consominas. Sem dependencias: so' modulos nativos do Node.
// Dados em /data/respostas.jsonl (um envio por linha). Tela de resultados protegida por ADMIN_TOKEN.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || "/data";
const ARQ = path.join(DATA_DIR, "respostas.jsonl");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
fs.mkdirSync(DATA_DIR, { recursive: true });

const MESES = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
const FORMAS = ["Cartão corporativo", "Reembolso (cartão pessoal)", "Outra"];
const html = (f) => fs.readFileSync(path.join(__dirname, "public", f), "utf-8");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const limpa = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n);

function lerTudo() {
  if (!fs.existsSync(ARQ)) return [];
  return fs.readFileSync(ARQ, "utf-8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function linhas(envios) {
  const out = [];
  for (const e of envios) for (const f of e.ferramentas) for (const m of f.meses) {
    out.push({ envioId: e.id, recebidoEm: e.recebidoEm, nome: e.nome, email: e.email, area: e.area, ferramenta: f.ferramenta, mes: m.mes, custo: m.custo, forma: m.forma, finalidade: f.finalidade, justificativa: f.justificativa });
  }
  return out;
}
const brl = (v) => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mesTxt = (m) => ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(m.slice(5)) - 1] + "/" + m.slice(2, 4);

function validar(b) {
  const erros = [];
  const nome = limpa(b.nome, 120), email = limpa(b.email, 160), area = limpa(b.area, 160);
  if (nome.length < 3) erros.push("Informe seu nome.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erros.push("Informe um e-mail válido.");
  if (area.length < 2) erros.push("Informe sua área, equipe ou contrato.");
  const ferramentas = [];
  if (!Array.isArray(b.ferramentas) || b.ferramentas.length === 0 || b.ferramentas.length > 30) erros.push("Inclua pelo menos uma ferramenta.");
  else b.ferramentas.forEach((f, i) => {
    const nomeF = limpa(f.ferramenta === "Outra" ? f.outra : f.ferramenta, 80);
    if (!nomeF) { erros.push(`Ferramenta ${i + 1}: informe qual é a ferramenta.`); return; }
    const meses = [];
    for (const m of Array.isArray(f.meses) ? f.meses : []) {
      if (!MESES.includes(m.mes)) continue;
      const custo = Number(String(m.custo ?? "").replace(/\./g, "").replace(",", "."));
      if (m.custo === "" || m.custo === null || m.custo === undefined || Number.isNaN(custo) || custo < 0 || custo > 1_000_000) continue;
      const forma = FORMAS.includes(m.forma) ? m.forma : "";
      if (custo > 0 && !forma) { erros.push(`${nomeF}: escolha a forma de pagamento de ${mesTxt(m.mes)}.`); continue; }
      meses.push({ mes: m.mes, custo: Math.round(custo * 100) / 100, forma: forma || "—" });
    }
    if (meses.length === 0) erros.push(`${nomeF}: informe o custo de pelo menos um mês (use 0 se não houve custo).`);
    const finalidade = limpa(f.finalidade, 1500), justificativa = limpa(f.justificativa, 1500);
    if (finalidade.length < 5) erros.push(`${nomeF}: descreva para que a ferramenta é usada.`);
    if (justificativa.length < 5) erros.push(`${nomeF}: escreva a justificativa de uso.`);
    ferramentas.push({ ferramenta: nomeF, meses, finalidade, justificativa });
  });
  return { erros, dados: { nome, email, area, ferramentas } };
}

function admin(req, url) {
  const t = url.searchParams.get("token") || "";
  return ADMIN_TOKEN.length >= 12 && t === ADMIN_TOKEN;
}

function paginaResultados(token) {
  const envios = lerTudo(), L = linhas(envios);
  const total = L.reduce((s, l) => s + l.custo, 0);
  const porForma = {}, porMes = {}, porFerr = {}, pivot = {};
  for (const l of L) {
    porForma[l.forma] = (porForma[l.forma] || 0) + l.custo; porMes[l.mes] = (porMes[l.mes] || 0) + l.custo; porFerr[l.ferramenta] = (porFerr[l.ferramenta] || 0) + l.custo;
    pivot[l.ferramenta] = pivot[l.ferramenta] || {}; pivot[l.ferramenta][l.mes] = (pivot[l.ferramenta][l.mes] || 0) + l.custo;
  }
  const cards = [["Respostas", envios.length], ["Pessoas", new Set(envios.map((e) => e.email.toLowerCase())).size], ["Custo informado", brl(total)], ...Object.entries(porForma).filter(([f]) => f !== "—").map(([f, v]) => [f, brl(v)])]
    .map(([k, v]) => `<div class="card"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
  const ferr = Object.keys(pivot).sort((a, b) => porFerr[b] - porFerr[a]);
  const pv = `<table><thead><tr><th>Ferramenta</th>${MESES.map((m) => `<th class="n">${mesTxt(m)}</th>`).join("")}<th class="n">Total</th></tr></thead><tbody>${ferr.map((f) => `<tr><td>${esc(f)}</td>${MESES.map((m) => `<td class="n">${pivot[f][m] ? brl(pivot[f][m]) : "–"}</td>`).join("")}<td class="n"><b>${brl(porFerr[f])}</b></td></tr>`).join("")}<tr class="tot"><td>Total</td>${MESES.map((m) => `<td class="n">${porMes[m] ? brl(porMes[m]) : "–"}</td>`).join("")}<td class="n">${brl(total)}</td></tr></tbody></table>`;
  const det = envios.slice().reverse().map((e) => `<details><summary><b>${esc(e.nome)}</b> · ${esc(e.area)} · ${esc(e.email)} <span class="mut">· ${esc(new Date(e.recebidoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }))}</span></summary>${e.ferramentas.map((f) => `<div class="fe"><p><b>${esc(f.ferramenta)}</b> — ${f.meses.map((m) => `${mesTxt(m.mes)}: ${brl(m.custo)} (${esc(m.forma)})`).join(" · ")}</p><p><i>Uso:</i> ${esc(f.finalidade)}</p><p><i>Justificativa:</i> ${esc(f.justificativa)}</p></div>`).join("")}</details>`).join("") || "<p class='mut'>Nenhuma resposta ainda.</p>";
  return html("resultados.html").replace("{{CARDS}}", cards).replace("{{PIVOT}}", L.length ? pv : "<p class='mut'>Sem dados ainda.</p>").replace("{{DETALHE}}", det).replace("{{CSV}}", `/resultados.csv?token=${encodeURIComponent(token)}`);
}

function csv() {
  const cab = ["recebido_em", "nome", "email", "area", "ferramenta", "mes", "custo_brl", "forma_pagamento", "uso_finalidade", "justificativa"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  return "﻿" + [cab.join(";")].concat(linhas(lerTudo()).map((l) => [l.recebidoEm, l.nome, l.email, l.area, l.ferramenta, l.mes, String(l.custo).replace(".", ","), l.forma, l.finalidade, l.justificativa].map(q).join(";"))).join("\r\n");
}

const tentativas = new Map();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body, type = "text/html; charset=utf-8", extra = {}) => { res.writeHead(code, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra }); res.end(body); };
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return send(200, html("index.html"));
    if (req.method === "GET" && url.pathname === "/health") return send(200, "ok", "text/plain");
    if (req.method === "POST" && url.pathname === "/api/enviar") {
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      const agora = Date.now(), lista = (tentativas.get(ip) || []).filter((t) => agora - t < 60_000);
      if (lista.length >= 12) return send(429, JSON.stringify({ erros: ["Muitos envios seguidos. Aguarde um minuto."] }), "application/json");
      lista.push(agora); tentativas.set(ip, lista);
      let corpo = ""; req.on("data", (c) => { corpo += c; if (corpo.length > 200_000) req.destroy(); });
      req.on("end", () => {
        let b; try { b = JSON.parse(corpo); } catch { return send(400, JSON.stringify({ erros: ["Formato inválido."] }), "application/json"); }
        const { erros, dados } = validar(b);
        if (erros.length) return send(422, JSON.stringify({ erros }), "application/json");
        const envio = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), recebidoEm: new Date().toISOString(), ...dados };
        fs.appendFileSync(ARQ, JSON.stringify(envio) + "\n");
        send(200, JSON.stringify({ ok: true, id: envio.id }), "application/json");
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/resultados") return admin(req, url) ? send(200, paginaResultados(url.searchParams.get("token"))) : send(401, "Acesso restrito.", "text/plain; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/resultados.csv") return admin(req, url) ? send(200, csv(), "text/csv; charset=utf-8", { "Content-Disposition": 'attachment; filename="levantamento_ia.csv"' }) : send(401, "Acesso restrito.", "text/plain; charset=utf-8");
    send(404, "Não encontrado", "text/plain; charset=utf-8");
  } catch (e) { send(500, "Erro interno", "text/plain; charset=utf-8"); }
});
server.listen(PORT, () => console.log("levantamento-ia na porta " + PORT));
