const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;

const sb = async (path, opts = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
};

const fmt = n => "$" + Number(n).toLocaleString("es-AR", { minimumFractionDigits: 0 });
const monthLabel = key => {
  const [y, m] = key.split("-");
  return ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"][parseInt(m)-1] + " " + y;
};

const CATEGORIES = [
  { id:"colegio",     label:"Colegio / Educación",   emoji:"🎓" },
  { id:"salud",       label:"Salud / Médicos",        emoji:"🏥" },
  { id:"ropa",        label:"Ropa / Calzado",         emoji:"👗" },
  { id:"actividades", label:"Actividades / Deportes", emoji:"⚽" },
  { id:"mascota",     label:"Mascota / Veterinaria",  emoji:"🐾" },
  { id:"otros",       label:"Otros",                  emoji:"📦" },
];
const TOLERANCE = 2000;

const isLastDayOfMonth = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.getDate() === 1;
};

const getCurrentMonth = () => new Date().toISOString().slice(0, 7);

// Devuelve meses anteriores al actual que no fueron cerrados
const getForgottenMonths = async (currentMonth) => {
  const expensesR = await sb("expenses?order=date.asc&limit=1");
  const monthsR   = await sb("months");
  if (!expensesR.data?.length) return [];
  const firstMonth = expensesR.data[0].date.slice(0, 7);
  const closedSet  = new Set((monthsR.data || []).map(m => m.month));
  const result = [];
  let cursor = new Date(firstMonth + "-01");
  const limit = new Date(currentMonth + "-01");
  while (cursor < limit) {
    const key = cursor.toISOString().slice(0, 7);
    if (!closedSet.has(key)) result.push(key);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return result;
};

const generateReportHTML = (month, expenses, payments) => {
  const monthExp  = expenses.filter(e => e.date.startsWith(month) && !e.cancelled);
  const monthPays = payments.filter(p => p.month === month);
  const totalGus  = monthExp.filter(e => e.who === "Gus").reduce((s, e) => s + Number(e.amount), 0);
  const totalBet  = monthExp.filter(e => e.who === "Betiana").reduce((s, e) => s + Number(e.amount), 0);
  const total     = totalGus + totalBet;
  const half      = total / 2;
  const rawDiff   = totalGus - totalBet;
  const comp      = Math.abs(rawDiff / 2);
  const totalPaid = monthPays.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(0, comp - totalPaid);
  const settled   = remaining <= TOLERANCE;
  const debtor    = rawDiff > 0 ? "Betiana" : "Gus";
  const creditor  = rawDiff > 0 ? "Gus" : "Betiana";
  const nenaTotal = (nena) => monthExp.filter(e => e.nena === nena || e.nena === "Ambas").reduce((s, e) => s + (e.nena === "Ambas" ? Number(e.amount) / 2 : Number(e.amount)), 0);
  const fridaTotal = monthExp.filter(e => e.nena === "Frida").reduce((s, e) => s + Number(e.amount), 0);
  const byCat = (nena) => CATEGORIES.map(cat => ({ ...cat, total: monthExp.filter(e => (e.nena === nena || e.nena === "Ambas") && e.category === cat.id).reduce((s, e) => s + (e.nena === "Ambas" ? Number(e.amount) / 2 : Number(e.amount)), 0) })).filter(c => c.total > 0);
  const fridaCats = CATEGORIES.map(cat => ({ ...cat, total: monthExp.filter(e => e.nena === "Frida" && e.category === cat.id).reduce((s, e) => s + Number(e.amount), 0) })).filter(c => c.total > 0);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Reporte ${monthLabel(month)}</title>
<style>
  body{font-family:Arial,sans-serif;padding:32px;color:#222;max-width:800px;margin:0 auto}
  h1{color:#f97316}h2{color:#444;margin:24px 0 12px;border-bottom:2px solid #eee;padding-bottom:6px}
  table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px}
  th,td{border:1px solid #ddd;padding:8px 12px;text-align:left}th{background:#f3f4f6}tr:nth-child(even){background:#f9fafb}
  .badge{display:inline-block;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600}
  .ok{background:#dcfce7;color:#166534}.err{background:#fee2e2;color:#991b1b}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:12px 0}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin:12px 0}
  .card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px}
  .num{font-size:24px;font-weight:700;color:#f97316}
  footer{margin-top:40px;color:#999;font-size:12px;border-top:1px solid #eee;padding-top:12px}
</style></head><body>
<h1>👧 Gastos Familiares</h1>
<p style="color:#888">Reporte · <strong>${monthLabel(month)}</strong> · ${new Date().toLocaleDateString("es-AR")}</p>
<h2>💰 Balance</h2>
<div class="grid">
  <div class="card"><h3>👨 Gus</h3><div class="num">${fmt(totalGus)}</div><div style="color:#888;font-size:13px">50% = ${fmt(half)}</div></div>
  <div class="card"><h3>👩 Betiana</h3><div class="num">${fmt(totalBet)}</div><div style="color:#888;font-size:13px">50% = ${fmt(half)}</div></div>
</div>
<p><strong>Total:</strong> ${fmt(total)} &nbsp;|&nbsp;
  <span class="badge ${settled ? "ok" : "err"}">${settled ? "✅ Compensado" : `⚠️ ${debtor} debe ${fmt(remaining)} a ${creditor}`}</span>
</p>
${monthPays.length > 0 ? `<p><strong>Pagos:</strong> ${monthPays.map(p => `${p.date} ${fmt(p.amount)}${p.note ? ` (${p.note})` : ""}`).join(" · ")}</p>` : ""}
<h2>👧 Por integrante</h2>
<div class="grid3">
  <div class="card"><h3>🌟 Valen</h3><div class="num" style="color:#f59e0b">${fmt(nenaTotal("Valen"))}</div>${byCat("Valen").map(c => `<div style="display:flex;justify-content:space-between;font-size:13px;margin-top:6px"><span>${c.emoji} ${c.label}</span><span>${fmt(c.total)}</span></div>`).join("")}</div>
  <div class="card"><h3>💫 Pili</h3><div class="num" style="color:#06b6d4">${fmt(nenaTotal("Pili"))}</div>${byCat("Pili").map(c => `<div style="display:flex;justify-content:space-between;font-size:13px;margin-top:6px"><span>${c.emoji} ${c.label}</span><span>${fmt(c.total)}</span></div>`).join("")}</div>
  <div class="card"><h3>🐱 Frida</h3><div class="num" style="color:#f472b6">${fmt(fridaTotal)}</div>${fridaCats.map(c => `<div style="display:flex;justify-content:space-between;font-size:13px;margin-top:6px"><span>${c.emoji} ${c.label}</span><span>${fmt(c.total)}</span></div>`).join("")}${fridaCats.length === 0 ? '<div style="font-size:13px;color:#999">Sin gastos</div>' : ""}</div>
</div>
<h2>📋 Detalle</h2>
<table>
  <tr><th>Fecha</th><th>Quién</th><th>Para</th><th>Categoría</th><th>Descripción</th><th>Monto</th></tr>
  ${monthExp.sort((a, b) => a.date.localeCompare(b.date)).map(e => `<tr><td>${e.date}</td><td style="font-weight:600">${e.who}</td><td>${e.nena || "-"}</td><td>${CATEGORIES.find(c => c.id === e.category)?.emoji || ""} ${CATEGORIES.find(c => c.id === e.category)?.label || e.category}</td><td>${e.description || ""}${e.installment_group ? ` 💳 ${e.installment_num}/${e.installment_total}` : ""}</td><td style="font-weight:600">${fmt(e.amount)}</td></tr>`).join("")}
  <tr style="background:#f3f4f6"><td colspan="5"><strong>Total</strong></td><td><strong>${fmt(total)}</strong></td></tr>
</table>
<footer>Gastos Familiares App · Gus &amp; Betiana · ${monthLabel(month)}</footer>
</body></html>`;
};

// Cierra un mes específico
const closeMonth = async (targetMonth) => {
  const existing = await sb(`months?month=eq.${targetMonth}`);
  if (existing.data?.length > 0 && existing.data[0].status !== "open") {
    return { skipped: true, month: targetMonth, reason: "Already closed" };
  }

  const [expensesR, paymentsR, galleryR] = await Promise.all([
    sb(`expenses?date=gte.${targetMonth}-01&date=lte.${targetMonth}-31&order=date.asc`),
    sb(`payments?month=eq.${targetMonth}`),
    sb("gallery"),
  ]);

  const expenses = (expensesR.data || []).filter(e => !e.cancelled);
  const payments = paymentsR.data || [];
  const gallery  = galleryR.data  || [];

  const totalGus  = expenses.filter(e => e.who === "Gus").reduce((s, e) => s + Number(e.amount), 0);
  const totalBet  = expenses.filter(e => e.who === "Betiana").reduce((s, e) => s + Number(e.amount), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const rawDiff   = totalGus - totalBet;
  const comp      = Math.abs(rawDiff / 2);
  const remaining = Math.max(0, comp - totalPaid);
  const settled   = remaining <= TOLERANCE;
  const debtor    = rawDiff > 0 ? "Betiana" : "Gus";
  const creditor  = rawDiff > 0 ? "Gus" : "Betiana";

  // Subir reporte a Storage
  const reportHTML   = generateReportHTML(targetMonth, expenses, payments);
  const reportPath   = `reportes/${targetMonth}/Reporte-${targetMonth}.html`;
  await fetch(`${SUPABASE_URL}/storage/v1/object/gastos-nenas/${reportPath}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "text/html", "x-upsert": "true" },
    body: Buffer.from(reportHTML, "utf-8"),
  });
  const reportUrl = `${SUPABASE_URL}/storage/v1/object/public/gastos-nenas/${reportPath}`;

  // Archivar comprobantes del mes
  const monthFiles = gallery.filter(g => expenses.find(e => e.id === g.expense_id));
  for (const item of monthFiles) {
    if (!item.storage_path) continue;
    await sb(`gallery?expense_id=eq.${item.expense_id}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: true, archived_path: item.storage_path.replace("comprobantes/", "historico/") }),
    });
  }

  // Guardar registro del mes
  await sb("months", {
    method: "POST",
    body: JSON.stringify({
      month: targetMonth, status: settled ? "settled" : "closed",
      total_gus: totalGus, total_bet: totalBet, total: totalGus + totalBet,
      compensation: comp, remaining,
      debtor: settled ? null : debtor, creditor: settled ? null : creditor,
      settled, report_url: reportUrl, closed_at: new Date().toISOString(),
    }),
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  });

  console.log(`✅ Mes ${targetMonth} cerrado. Settled: ${settled}`);
  return { success: true, month: targetMonth, settled, remaining };
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    console.log("Cron sin secret match — continuando (Vercel interno)");
  }

  try {
    const currentMonth = getCurrentMonth();
    const isAutoCron   = !req.body?.month;
    const targetMonth  = req.body?.month || currentMonth;

    if (isAutoCron && !isLastDayOfMonth()) {
      return res.status(200).json({ skipped: true, reason: "Not last day of month" });
    }

    const monthsToClose = [];

    if (isAutoCron) {
      const forgotten = await getForgottenMonths(currentMonth);
      if (forgotten.length > 0) {
        console.log(`Meses olvidados: ${forgotten.join(", ")}`);
        monthsToClose.push(...forgotten);
      }
    }

    monthsToClose.push(targetMonth);

    const results = [];
    for (const month of monthsToClose) {
      const r = await closeMonth(month);
      results.push(r);
    }

    return res.status(200).json({ success: true, closed: results });

  } catch (error) {
    console.error("Cron error:", error);
    return res.status(500).json({ error: error.message });
  }
}
