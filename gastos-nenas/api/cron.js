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

const generateReportHTML = (month, expenses, payments, allExpenses = []) => {
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

  // ── Datos históricos para gráficos ──────────────────────────────────────
  const allMonths = [...new Set(allExpenses.map(e => e.date.slice(0,7)))].sort();
  const histLabels  = allMonths.map(m => monthLabel(m));
  const histGus     = allMonths.map(m => allExpenses.filter(e => e.date.startsWith(m) && e.who === "Gus").reduce((s,e) => s+Number(e.amount), 0));
  const histBet     = allMonths.map(m => allExpenses.filter(e => e.date.startsWith(m) && e.who === "Betiana").reduce((s,e) => s+Number(e.amount), 0));
  const histTotal   = allMonths.map((_, i) => histGus[i] + histBet[i]);

  // Acumulados globales
  const accumGus   = allExpenses.filter(e => e.who === "Gus").reduce((s,e) => s+Number(e.amount), 0);
  const accumBet   = allExpenses.filter(e => e.who === "Betiana").reduce((s,e) => s+Number(e.amount), 0);
  const accumTotal = accumGus + accumBet;
  const avgMonthly = allMonths.length > 0 ? Math.round(accumTotal / allMonths.length) : 0;
  const avgGus     = allMonths.length > 0 ? Math.round(accumGus / allMonths.length) : 0;
  const avgBet     = allMonths.length > 0 ? Math.round(accumBet / allMonths.length) : 0;

  // Categorías del mes para torta
  const catTotals  = CATEGORIES.map(c => ({ ...c, total: monthExp.filter(e => e.category === c.id).reduce((s,e) => s+Number(e.amount), 0) })).filter(c => c.total > 0);
  const catLabels  = JSON.stringify(catTotals.map(c => c.label.split("/")[0].trim()));
  const catData    = JSON.stringify(catTotals.map(c => c.total));
  const catColors  = JSON.stringify(["#f97316","#06b6d4","#a78bfa","#22c55e","#f472b6","#fbbf24"].slice(0, catTotals.length));

  // Tendencia vs mes anterior
  const prevIdx    = allMonths.indexOf(month) - 1;
  const prevTotal  = prevIdx >= 0 ? histTotal[prevIdx] : null;
  const trendDiff  = prevTotal !== null ? total - prevTotal : null;
  const trendPct   = prevTotal > 0 && trendDiff !== null ? Math.round((trendDiff / prevTotal) * 100) : null;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reporte ${monthLabel(month)}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
<style>
  *{box-sizing:border-box}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f8f9fa;color:#222;margin:0;padding:0}
  .wrap{max-width:860px;margin:0 auto;padding:24px 16px 48px}
  h1{color:#f97316;margin:0 0 4px}
  .subtitle{color:#888;font-size:14px;margin-bottom:24px}
  h2{color:#444;margin:32px 0 14px;font-size:17px;border-left:4px solid #f97316;padding-left:10px}
  .badge{display:inline-block;padding:4px 12px;border-radius:6px;font-size:13px;font-weight:700}
  .ok{background:#dcfce7;color:#166534}.err{background:#fee2e2;color:#991b1b}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:14px}
  .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:14px}
  @media(max-width:600px){.grid2,.grid3,.grid4{grid-template-columns:1fr 1fr}.grid4{grid-template-columns:1fr 1fr}}
  @media(max-width:400px){.grid2,.grid3{grid-template-columns:1fr}}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px}
  .card-title{font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
  .card-val{font-size:22px;font-weight:700;color:#f97316}
  .card-sub{font-size:12px;color:#aaa;margin-top:4px}
  .chart-wrap{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:14px}
  .chart-title{font-size:14px;font-weight:700;color:#444;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb}
  th{background:#f3f4f6;padding:10px 12px;text-align:left;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.5px}
  td{padding:10px 12px;border-top:1px solid #f3f4f6}
  tr:hover td{background:#fafafa}
  .trend-up{color:#ef4444;font-weight:700}.trend-down{color:#22c55e;font-weight:700}.trend-flat{color:#888}
  .nena-valen{color:#f59e0b;font-weight:700}.nena-pili{color:#06b6d4;font-weight:700}.nena-frida{color:#f472b6;font-weight:700}
  footer{text-align:center;color:#bbb;font-size:12px;margin-top:40px;padding-top:16px;border-top:1px solid #eee}
</style></head>
<body><div class="wrap">

<h1>👧 Gastos Familiares</h1>
<div class="subtitle">Reporte de cierre · <strong>${monthLabel(month)}</strong> · Generado el ${new Date().toLocaleDateString("es-AR")}</div>

<h2>💰 Balance del mes</h2>
<div class="grid2">
  <div class="card"><div class="card-title">👨 Gus</div><div class="card-val">${fmt(totalGus)}</div><div class="card-sub">50% = ${fmt(half)}</div></div>
  <div class="card"><div class="card-title">👩 Betiana</div><div class="card-val">${fmt(totalBet)}</div><div class="card-sub">50% = ${fmt(half)}</div></div>
</div>
<div class="card" style="margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
  <div><span style="font-size:15px;font-weight:700">Total del mes: ${fmt(total)}</span>${trendPct!==null?`<span class="trend-${trendDiff>0?"up":trendDiff<0?"down":"flat"}" style="margin-left:12px;font-size:13px">${trendDiff>0?"▲":"▼"} ${Math.abs(trendPct)}% vs ${monthLabel(allMonths[prevIdx])}</span>`:""}</div>
  <span class="badge ${settled?"ok":"err"}">${settled?"✅ Compensado":`⚠️ ${debtor} debe ${fmt(remaining)} a ${creditor}`}</span>
</div>
${monthPays.length > 0 ? `<div class="card" style="margin-bottom:14px;font-size:13px;color:#666"><strong>Pagos registrados:</strong> ${monthPays.map(p=>`${p.date} ${fmt(p.amount)}${p.note?` (${p.note})`:""}`).join(" · ")}</div>` : ""}

<h2>👧 Por integrante</h2>
<div class="grid3">
  <div class="card"><div class="card-title">🌟 Valen</div><div class="card-val" style="color:#f59e0b">${fmt(nenaTotal("Valen"))}</div>${byCat("Valen").map(c=>`<div style="display:flex;justify-content:space-between;font-size:12px;color:#888;margin-top:5px"><span>${c.emoji} ${c.label.split("/")[0].trim()}</span><span style="color:#333;font-weight:600">${fmt(c.total)}</span></div>`).join("")}</div>
  <div class="card"><div class="card-title">💫 Pili</div><div class="card-val" style="color:#06b6d4">${fmt(nenaTotal("Pili"))}</div>${byCat("Pili").map(c=>`<div style="display:flex;justify-content:space-between;font-size:12px;color:#888;margin-top:5px"><span>${c.emoji} ${c.label.split("/")[0].trim()}</span><span style="color:#333;font-weight:600">${fmt(c.total)}</span></div>`).join("")}</div>
  <div class="card"><div class="card-title">🐱 Frida</div><div class="card-val" style="color:#f472b6">${fmt(fridaTotal)}</div>${fridaCats.map(c=>`<div style="display:flex;justify-content:space-between;font-size:12px;color:#888;margin-top:5px"><span>${c.emoji} ${c.label.split("/")[0].trim()}</span><span style="color:#333;font-weight:600">${fmt(c.total)}</span></div>`).join("")}${fridaCats.length===0?'<div style="font-size:12px;color:#bbb;margin-top:5px">Sin gastos</div>':""}</div>
</div>

${allMonths.length > 0 ? `
<h2>📊 Histórico acumulado</h2>
<div class="grid4">
  <div class="card"><div class="card-title">Total acumulado</div><div class="card-val">${fmt(accumTotal)}</div><div class="card-sub">${allMonths.length} meses</div></div>
  <div class="card"><div class="card-title">Promedio mensual</div><div class="card-val">${fmt(avgMonthly)}</div><div class="card-sub">por mes</div></div>
  <div class="card"><div class="card-title">Promedio Gus</div><div class="card-val" style="font-size:18px">${fmt(avgGus)}</div><div class="card-sub">por mes</div></div>
  <div class="card"><div class="card-title">Promedio Betiana</div><div class="card-val" style="font-size:18px">${fmt(avgBet)}</div><div class="card-sub">por mes</div></div>
</div>

<div class="chart-wrap">
  <div class="chart-title">📈 Gastos mensuales — Gus vs Betiana</div>
  <canvas id="chartBar" height="100"></canvas>
</div>

<div class="grid2">
  <div class="chart-wrap">
    <div class="chart-title">🥧 Distribución por categoría</div>
    <canvas id="chartPie" height="200"></canvas>
  </div>
  <div class="chart-wrap">
    <div class="chart-title">📉 Total por mes</div>
    <canvas id="chartLine" height="200"></canvas>
  </div>
</div>
` : ""}

<h2>📋 Detalle de gastos</h2>
<table>
  <tr><th>Fecha</th><th>Quién</th><th>Para</th><th>Categoría</th><th>Descripción</th><th>Monto</th></tr>
  ${monthExp.sort((a,b)=>a.date.localeCompare(b.date)).map(e=>`
  <tr>
    <td>${e.date}</td>
    <td style="font-weight:700">${e.who}</td>
    <td class="nena-${(e.nena||"").toLowerCase()}">${e.nena||"-"}</td>
    <td>${CATEGORIES.find(c=>c.id===e.category)?.emoji||""} ${CATEGORIES.find(c=>c.id===e.category)?.label||e.category}</td>
    <td>${e.description||""}${e.installment_group?` <span style="background:#fff7ed;color:#f97316;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:700">💳 ${e.installment_num}/${e.installment_total}</span>`:""}</td>
    <td style="font-weight:700">${fmt(e.amount)}</td>
  </tr>`).join("")}
  <tr style="background:#f9fafb"><td colspan="5" style="font-weight:700">Total del mes</td><td style="font-weight:700;color:#f97316">${fmt(total)}</td></tr>
</table>

<footer>Gastos Familiares App · Gus &amp; Betiana · ${monthLabel(month)}</footer>
</div>

${allMonths.length > 0 ? `
<script>
const orange="#f97316",blue="#06b6d4",purple="#a78bfa";
Chart.defaults.font.family="'Segoe UI',Arial,sans-serif";
Chart.defaults.plugins.legend.labels.boxWidth=12;

// Barras — Gus vs Betiana por mes
new Chart(document.getElementById("chartBar"),{
  type:"bar",
  data:{
    labels:${JSON.stringify(histLabels)},
    datasets:[
      {label:"Gus",data:${JSON.stringify(histGus)},backgroundColor:orange+"cc",borderRadius:4},
      {label:"Betiana",data:${JSON.stringify(histBet)},backgroundColor:blue+"cc",borderRadius:4}
    ]
  },
  options:{responsive:true,plugins:{legend:{position:"top"}},scales:{y:{ticks:{callback:v=>"$"+v.toLocaleString("es-AR")},grid:{color:"#f3f4f6"}},x:{grid:{display:false}}}}
});

// Torta — categorías del mes
new Chart(document.getElementById("chartPie"),{
  type:"doughnut",
  data:{labels:${catLabels},datasets:[{data:${catData},backgroundColor:${catColors},borderWidth:2,borderColor:"#fff"}]},
  options:{responsive:true,plugins:{legend:{position:"bottom"},tooltip:{callbacks:{label:ctx=>" "+ctx.label+": $"+ctx.raw.toLocaleString("es-AR")}}}}
});

// Línea — total por mes
new Chart(document.getElementById("chartLine"),{
  type:"line",
  data:{
    labels:${JSON.stringify(histLabels)},
    datasets:[{label:"Total",data:${JSON.stringify(histTotal)},borderColor:orange,backgroundColor:orange+"22",fill:true,tension:0.3,pointBackgroundColor:orange,pointRadius:4}]
  },
  options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>"$"+v.toLocaleString("es-AR")},grid:{color:"#f3f4f6"}},x:{grid:{display:false}}}}
});
<\/script>
` : ""}
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

  // Subir reporte a Storage — pasamos todos los gastos históricos para los gráficos
  const allExpensesR = await sb("expenses?order=date.asc");
  const allExpenses  = (allExpensesR.data || []).filter(e => !e.cancelled);
  const reportHTML   = generateReportHTML(targetMonth, expenses, payments, allExpenses);
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
