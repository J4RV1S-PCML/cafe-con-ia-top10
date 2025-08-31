import Parser from "rss-parser";
import nodemailer from "nodemailer";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { DateTime } from "luxon";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TZ = process.env.TZ || "America/Toronto";
const FEEDS = (process.env.FEEDS || "https://openai.com/blog/rss.xml,https://research.google/blog/rss")
  .split(",").map(s => s.trim());

const SUBJECTS = [
  "☕ Café con IA: Top-10 para hoy",
  "⚡ IA en 5 min: Noticias + Prompts + Tips"
];

const KW = {
  vendors: /(openai|anthropic|google|deepmind|meta|microsoft|databricks|snowflake|nvidia)/i,
  launch: /(launch|nuevo|released|update|modelo|model|gpt|llama|gemini|mixtral|sonnet|haiku)/i,
  policy: /(policy|regulation|regulación|privacidad|copyright|seguridad|eu|uk|usa|canada)/i,
  mkt: /(marketing|seo|content|ads|social|creador)/i,
  prod: /(workflow|productividad|automatización|prompt|best practice|mejor práctica|playbook)/i
};
const tag = t => KW.mkt.test(t) ? "Marketing" : KW.prod.test(t) ? "Productividad" : "Noticias";
const why = t => KW.policy.test(t) ? "Cambia marco regulatorio/riesgo."
  : (KW.vendors.test(t) && KW.launch.test(t)) ? "Afecta roadmap y competitividad."
  : KW.prod.test(t) ? "Ahorra tiempo con mejores prácticas/prompts."
  : KW.mkt.test(t) ? "Impacta adquisición/contenido." : "Relevancia general IA.";
const score = (t, l) => (KW.vendors.test(t) || KW.policy.test(t) ? 3 : 1) *
  (KW.launch.test(t) ? 3 : 1) * (/blog|docs|press|news|arxiv/i.test(l) ? 3 : 2);

function loadTemplate() {
  const rel = process.env.TEMPLATE_PATH || "templates/email.html";
  const path = `${__dirname}/${rel}`;
  if (fs.existsSync(path)) return fs.readFileSync(path, "utf8");
  // Fallback embebido si no existe el archivo
  return `<!doctype html><html><body style="margin:0;background:#0F172A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
  <tr><td align="center" style="padding:24px;">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;">
      <tr><td align="center" style="color:#E2E8F0;font-size:24px;font-weight:800;">☕ Café con IA — Top 10</td></tr>
      <tr><td align="center" style="color:#94A3B8;font-size:14px;padding:6px 0 18px;">{{fecha_larga}} · Lectura 5 min · IVD ≥ 90%</td></tr>
      <tr><td style="background:#FFFFFF;border-radius:16px;padding:24px;">
        <div style="font-size:18px;font-weight:700;color:#0B1220;">Qué pasó / Por qué importa / Qué hacer hoy</div>
        <div style="color:#475569;margin-top:8px;">{{resumen_120_palabras}}</div>
        <hr style="border:none;border-top:1px solid #E2E8F0;margin:16px 0">
        <div style="font-size:16px;font-weight:700;color:#0B1220;">Prompts del día</div>
        {{prompts_html}}
        <hr style="border:none;border-top:1px solid #E2E8F0;margin:16px 0">
        <div style="font-size:16px;font-weight:700;color:#0B1220;">Top 10</div>
        {{top10_html}}
      </td></tr>
    </table>
  </td></tr>
  </table></body></html>`;
}

function renderPrompts(prompts){
  return prompts.map(p=>`
    <div style="margin-top:6px;color:#0B1220;">
      • <b>${p.titulo}</b><br>${p.texto}<br>
      <code style="background:#F1F5F9;padding:4px 6px;border-radius:6px;display:inline-block;">${p.codigo}</code>
    </div>`).join("");
}
function renderItems(items){
  return items.map((it,i)=>`
  <table role="presentation" width="100%" style="margin-top:12px;"><tr>
    <td width="48" align="center">
      <div style="background:#F1F5F9;border-radius:12px;padding:8px 0;font-weight:800;color:#0B1220;">#${i+1}</div>
    </td>
    <td style="padding-left:12px;">
      <div style="font-size:16px;font-weight:700;color:#0B1220;">${it.title}</div>
      <div style="color:#475569;margin-top:4px;">${it.porque}</div>
      <div style="margin-top:6px;">
        <a href="${it.link}" style="color:#14B8A6;text-decoration:none;">Fuente</a> · ${it.fecha}
        <span style="background:#ECFEFF;color:#0B1220;padding:2px 8px;border-radius:10px;margin-left:6px;">${it.tag}</span>
      </div>
    </td>
  </tr></table>`).join("");
}
function toText({fecha_larga,resumen,prompts,items}){
  const lines = [];
  lines.push(`Café con IA — Top 10 (${fecha_larga})`,"","Resumen:",resumen,"","Prompts del día:");
  prompts.forEach(p=>{lines.push(`• ${p.titulo}: ${p.texto}`); lines.push(p.codigo);});
  lines.push("","Top 10:");
  items.forEach((it,i)=>lines.push(`#${i+1} ${it.title} — ${it.porque} (${it.fecha}) [${it.link}]`));
  return lines.join("\n");
}

async function aggregate(){
  const parser = new Parser();
  const feeds = await Promise.all(FEEDS.map(f=>parser.parseURL(f).catch(()=>({items:[]}))));
  const raw = feeds.flatMap(f=>f.items.map(x=>({
    title: x.title?.trim()||"(Sin título)",
    link: x.link||x.guid||"",
    iso: x.isoDate||x.pubDate||null,
    desc: x.contentSnippet||x.content||""
  }))).filter(x=>x.link);

  const dedup = Array.from(new Map(raw.map(a=>[a.link,a])).values());
  return dedup.map(x=>{
    const t = `${x.title} ${x.desc}`;
    return {
      ...x,
      tag: tag(t),
      porque: why(t),
      fecha: x.iso ? DateTime.fromISO(x.iso).setZone(TZ).toISODate() : "s/f",
      score: score(t,x.link)
    };
  }).sort((a,b)=>b.score-a.score).slice(0,10);
}

async function sendGmail({html,text}){
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
  });
  const subject = SUBJECTS[Math.floor(Date.now()/86400000)%SUBJECTS.length];
  await transporter.sendMail({
    from: `"Café con IA — Top 10" <${process.env.GMAIL_USER}>`,
    to: process.env.RECIPIENTS,
    subject,
    headers: { "X-Preheader": "Resumen verificado en 5 min" },
    html, text
  });
}

async function main(){
  const items = await aggregate();
  const now = DateTime.now().setZone(TZ).setLocale("es");
  const fecha_larga = now.toFormat("cccc, d 'de' LLLL 'de' yyyy");
  const resumen = `Lo clave: ${items.slice(0,3).map(i=>i.title).join(" · ")}.`;
  const prompts = [
    { titulo:"Resumen 5x5", texto:"5 datos + 5 implicaciones.", codigo:"Resume en 5 datos y 5 implicaciones: {pega_texto}." },
    { titulo:"Comparador rápido", texto:"Compara 2 lanzamientos y su impacto.", codigo:"Compara {A} vs {B}: target, costo, riesgos, madurez, quick wins." }
  ];

  let html = loadTemplate();
  html = html.replaceAll("{{fecha_larga}}", fecha_larga)
             .replaceAll("{{resumen_120_palabras}}", resumen)
             .replaceAll("{{prompts_html}}", renderPrompts(prompts))
             .replaceAll("{{top10_html}}", renderItems(items))
             .replaceAll("{{cta_url}}", "https://www.notion.so/");
  const text = toText({fecha_larga,resumen,prompts,items});
  await sendGmail({html,text});
  console.log("Correo enviado con Gmail ✅");
}

main().catch(e=>{ console.error(e); process.exit(1); });
