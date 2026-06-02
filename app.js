const REQUIRED = {
  protocol: ["protocolo", "protocol", "protocol_mod"],
  locality: ["trial_mod", "localidad", "trial"],
  date: ["activity_date", "fecha", "date"],
  description: ["activity_description", "activity description", "descripcion", "descripción"],
  code: ["activity_timing_code", "activity_code", "activity code", "codigo", "código"],
  irrigation: ["avg(irrigation_amount)", "irrigation_amount", "irrigation", "precipitacion", "precipitación", "lluvia", "mm"]
};

const COLORS = {
  bayerGreen: "#66B512",
  bayerBlue: "#00A3E0",
  bayerNavy: "#003B71",
  gray: "#64748B",
  grid: "#D9ECF4",
  appFill: "#DDF3D0"
};

let allRows = [];
let filteredRows = [];
let groupedResult = new Map();

const els = {
  dataInput: document.getElementById("dataInput"),
  processBtn: document.getElementById("processBtn"),
  clearBtn: document.getElementById("clearBtn"),
  loadDemoBtn: document.getElementById("loadDemoBtn"),
  status: document.getElementById("status"),
  resultTable: document.getElementById("resultTable"),
  summary: document.getElementById("summary"),
  charts: document.getElementById("charts"),
  downloadXlsBtn: document.getElementById("downloadXlsBtn")
};

els.processBtn.addEventListener("click", processInput);
els.clearBtn.addEventListener("click", clearAll);
els.loadDemoBtn.addEventListener("click", loadDemo);
els.downloadXlsBtn.addEventListener("click", () => downloadExcel(filteredRows));

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function findColumn(headers, alternatives) {
  const normalized = headers.map(normalizeHeader);
  for (const alt of alternatives) {
    const target = normalizeHeader(alt);
    const idx = normalized.indexOf(target);
    if (idx !== -1) return idx;
  }
  for (const alt of alternatives) {
    const target = normalizeHeader(alt);
    const idx = normalized.findIndex(h => h.includes(target) || target.includes(h));
    if (idx !== -1) return idx;
  }
  return -1;
}

function detectDelimiter(firstLine) {
  const candidates = ["\t", ";", ","];
  return candidates.map(d => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
}

function parseDelimited(text) {
  const clean = text.replace(/\r/g, "").trim();
  if (!clean) throw new Error("Pegá una tabla antes de procesar.");
  const firstLine = clean.split("\n")[0];
  const delimiter = detectDelimiter(firstLine);
  const rows = clean.split("\n").filter(Boolean).map(line => splitLine(line, delimiter));
  if (rows.length < 2) throw new Error("La tabla debe tener encabezados y al menos una fila de datos.");
  return rows;
}

function splitLine(line, delimiter) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      out.push(current.trim());
      current = "";
    } else current += char;
  }
  out.push(current.trim());
  return out;
}

function excelSerialToDate(serial) {
  const utc = Math.round((Number(serial) - 25569) * 86400 * 1000);
  return new Date(utc);
}

function parseDateValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw) && Number(raw) > 20000) return excelSerialToDate(Number(raw));
  const normalized = raw.includes("/") ? raw.split("/").reverse().join("-") : raw;
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.toLowerCase() === "null" || raw === "-") return null;
  const cleaned = raw.replace(/%/g, "").replace(/\s/g, "").replace(/\./g, "").replace(/,/g, ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatDate(date) {
  if (!(date instanceof Date)) return "";
  return date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function typeOfRow(description) {
  const d = String(description || "").trim().toLowerCase();
  if (d.includes("application") || d.includes("aplic")) return "Application";
  if (d.includes("assessment") || d.includes("evalu")) return "Assessment";
  if (d.includes("rain") || d.includes("lluv")) return "Rain";
  return description || "Other";
}

function processInput() {
  try {
    const matrix = parseDelimited(els.dataInput.value);
    const headers = matrix[0];
    const idx = {
      protocol: findColumn(headers, REQUIRED.protocol),
      locality: findColumn(headers, REQUIRED.locality),
      date: findColumn(headers, REQUIRED.date),
      description: findColumn(headers, REQUIRED.description),
      code: findColumn(headers, REQUIRED.code),
      irrigation: findColumn(headers, REQUIRED.irrigation)
    };
    const requiredKeys = ["locality", "date", "description", "code", "irrigation"];
    const missing = requiredKeys.filter(k => idx[k] === -1);
    if (missing.length) throw new Error("No pude reconocer estas columnas: " + missing.join(", "));

    allRows = matrix.slice(1).map((r, i) => {
      const date = parseDateValue(r[idx.date]);
      const type = typeOfRow(r[idx.description]);
      return {
        protocol: idx.protocol === -1 ? "" : (r[idx.protocol] || ""),
        locality: r[idx.locality] || "Sin localidad",
        date,
        dateLabel: formatDate(date),
        description: r[idx.description] || "",
        type,
        code: cleanCode(r[idx.code]),
        irrigation: parseNumber(r[idx.irrigation]),
        originalIndex: i + 2
      };
    }).filter(r => r.date);

    groupedResult = buildWindows(allRows);
    filteredRows = Array.from(groupedResult.values()).flat();
    renderSummary(groupedResult, filteredRows);
    renderTable(filteredRows);
    renderCharts(groupedResult, allRows);
    els.downloadXlsBtn.disabled = filteredRows.length === 0;
    els.status.textContent = `Listo: ${filteredRows.length} filas filtradas en ${groupedResult.size} localidades. Se generó también el gráfico general con todas las lluvias y assessments cargados.`;
  } catch (err) {
    els.status.textContent = err.message;
    els.downloadXlsBtn.disabled = true;
  }
}

function cleanCode(value) {
  const text = String(value ?? "").trim();
  return (!text || text === "(Empty)" || text.toLowerCase() === "null") ? "" : text;
}

function buildWindows(rows) {
  const byLocality = new Map();
  rows.forEach(r => {
    const key = `${r.protocol}||${r.locality}`;
    if (!byLocality.has(key)) byLocality.set(key, []);
    byLocality.get(key).push(r);
  });
  const result = new Map();
  for (const [key, items] of byLocality.entries()) {
    const sorted = [...items].sort((a, b) => a.date - b.date || a.originalIndex - b.originalIndex);
    const applications = sorted.filter(r => r.type === "Application");
    if (!applications.length) continue;
    const firstApp = applications[0];
    const lastApp = applications[applications.length - 1];

    let startIndex = sorted.findIndex(r => r === firstApp);
    for (let i = startIndex - 1; i >= 0; i--) {
      if (sorted[i].type === "Rain" && sorted[i].date < firstApp.date) {
        startIndex = i;
        break;
      }
    }

    let endIndex = sorted.findIndex(r => r === lastApp);
    for (let i = endIndex + 1; i < sorted.length; i++) {
      if (sorted[i].type === "Rain" && sorted[i].date > lastApp.date) {
        endIndex = i;
        break;
      }
    }
    result.set(key, sorted.slice(startIndex, endIndex + 1));
  }
  return result;
}

function renderSummary(groups, rows) {
  const applications = rows.filter(r => r.type === "Application").length;
  const assessments = rows.filter(r => r.type === "Assessment").length;
  const rainMm = rows.reduce((sum, r) => sum + (r.type === "Rain" && r.irrigation ? r.irrigation : 0), 0);
  els.summary.innerHTML = `
    <div class="kpi"><strong>${groups.size}</strong><span>Localidades con aplicación</span></div>
    <div class="kpi"><strong>${rows.length}</strong><span>Filas dentro de ventana</span></div>
    <div class="kpi"><strong>${applications}</strong><span>Aplicaciones detectadas</span></div>
    <div class="kpi"><strong>${assessments}</strong><span>Assessments detectados</span></div>
    <div class="kpi"><strong>${round(rainMm, 1)} mm</strong><span>Precipitación acumulada filtrada</span></div>
  `;
}

function renderTable(rows) {
  if (!rows.length) {
    els.resultTable.innerHTML = "";
    return;
  }
  const head = ["Protocolo", "Localidad", "Fecha", "Activity description", "Activity code", "Irrigation / lluvia (mm)"];
  const body = rows.map(r => `
    <tr class="${r.type === "Application" ? "app-row" : ""}">
      <td>${escapeHtml(r.protocol)}</td>
      <td>${escapeHtml(r.locality)}</td>
      <td>${escapeHtml(r.dateLabel)}</td>
      <td>${escapeHtml(r.description)}</td>
      <td>${escapeHtml(r.code)}</td>
      <td>${r.irrigation ?? ""}</td>
    </tr>
  `).join("");
  els.resultTable.innerHTML = `<thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody>`;
}

function renderCharts(groups, sourceRows = []) {
  els.charts.innerHTML = "";

  if (sourceRows.length) {
    const globalBox = document.createElement("div");
    globalBox.className = "chart-box chart-box-featured";
    globalBox.innerHTML = `
      <div class="chart-head">
        <div>
          <p class="chart-kicker">Resumen general</p>
          <h3>Todas las lluvias, aplicaciones y assessments cargados</h3>
        </div>
        <button class="secondary">Descargar PNG Bayer general</button>
      </div>
      <canvas></canvas>
    `;
    els.charts.appendChild(globalBox);
    const globalCanvas = globalBox.querySelector("canvas");
    drawChart(globalCanvas, "Resumen general · Todas las lluvias y assessments", buildGeneralChartRows(sourceRows), { general: true });
    globalBox.querySelector("button").addEventListener("click", () => downloadCanvas(globalCanvas, "grafico_general_todas_las_lluvias_assessments.png"));
  }

  for (const [key, rows] of groups.entries()) {
    const locality = rows[0]?.locality || key.split("||")[1] || key;
    const protocol = rows[0]?.protocol || "";
    const title = protocol ? `${protocol} · ${locality}` : locality;
    const box = document.createElement("div");
    box.className = "chart-box";
    box.innerHTML = `
      <div class="chart-head">
        <h3>${escapeHtml(title)}</h3>
        <button class="secondary">Descargar PNG Bayer</button>
      </div>
      <canvas></canvas>
    `;
    els.charts.appendChild(box);
    const canvas = box.querySelector("canvas");
    drawChart(canvas, title, rows);
    box.querySelector("button").addEventListener("click", () => downloadCanvas(canvas, `grafico_${safeFile(title)}.png`));
  }
}


function buildGeneralChartRows(rows) {
  const rainByDate = new Map();
  const events = [];

  rows.forEach(r => {
    const dateKey = r.date.toISOString().slice(0, 10);
    if (r.type === "Rain" && Number.isFinite(r.irrigation)) {
      const current = rainByDate.get(dateKey) || {
        ...r,
        irrigation: 0,
        description: "Rain",
        type: "Rain",
        code: "",
        localities: new Set()
      };
      current.irrigation += r.irrigation;
      current.localities.add(r.locality);
      rainByDate.set(dateKey, current);
    } else if (r.type === "Application" || r.type === "Assessment") {
      events.push({ ...r });
    }
  });

  const rains = [...rainByDate.values()].map(r => ({
    ...r,
    code: r.localities.size > 1 ? `${r.localities.size} loc.` : "",
    dateLabel: formatDate(r.date)
  }));

  return [...rains, ...events].sort((a, b) => a.date - b.date || a.originalIndex - b.originalIndex);
}

function drawChart(canvas, title, rows, options = {}) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 980;
  const cssHeight = canvas.clientHeight || 460;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const W = cssWidth;
  const H = cssHeight;
  const m = { left: 82, right: 38, top: 46, bottom: 84 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const minT = Math.min(...rows.map(r => r.date.getTime()));
  const maxT = Math.max(...rows.map(r => r.date.getTime()));
  const rawSpan = Math.max(maxT - minT, 86400000);
  const visualSpan = rawSpan;
  const span = visualSpan;
  const rains = rows.filter(r => r.type === "Rain" && Number.isFinite(r.irrigation));
  const maxRain = Math.max(0, ...rains.map(r => r.irrigation));
  const maxY = getNiceMaxY(maxRain);
  const x = date => m.left + ((date.getTime() - minT) / span) * plotW;
  const y = v => m.top + plotH - (v / maxY) * plotH;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = COLORS.bayerNavy;
  ctx.font = "800 18px Inter, Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(title, m.left, 28);

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = COLORS.gray;
  ctx.font = "12px Inter, Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const val = (maxY / ticks) * i;
    const yy = y(val);
    ctx.beginPath();
    ctx.moveTo(m.left, yy);
    ctx.lineTo(W - m.right, yy);
    ctx.stroke();
    ctx.fillText(round(val, 0), m.left - 10, yy);
  }

  ctx.save();
  ctx.translate(22, m.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = COLORS.bayerNavy;
  ctx.font = "800 12px Inter, Arial";
  ctx.textAlign = "center";
  ctx.fillText("Precipitación / irrigación (mm)", 0, 0);
  ctx.restore();

  ctx.strokeStyle = COLORS.bayerNavy;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(m.left, m.top);
  ctx.lineTo(m.left, m.top + plotH);
  ctx.lineTo(W - m.right, m.top + plotH);
  ctx.stroke();

  const minSpacing = getMinSpacing(rains.map(r => x(r.date)));
  const barWidth = getBarWidth(rains.length, minSpacing, plotW);
  rains.forEach((r, i) => {
    const xx = x(r.date) - barWidth / 2;
    const yy = y(r.irrigation);
    const h = m.top + plotH - yy;
    ctx.fillStyle = COLORS.bayerBlue;
    roundRect(ctx, xx, yy, barWidth, h, Math.min(5, barWidth / 2));
    ctx.fill();
    ctx.fillStyle = COLORS.bayerNavy;
    ctx.font = "800 11px Inter, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${round(r.irrigation, 1)}`, x(r.date), yy - 5 - (i % 2) * 10);
  });

  rows.filter(r => r.type === "Application").forEach((r, i) => drawVerticalEvent(ctx, x(r.date), m, plotH, COLORS.bayerGreen, false, `Aplic. ${r.code || i + 1}`, i));
  rows.filter(r => r.type === "Assessment").forEach((r, i) => drawVerticalEvent(ctx, x(r.date), m, plotH, COLORS.bayerNavy, true, r.code || "Assessment", i));

  drawDateTicks(ctx, rows, x, m, plotH);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "12px Inter, Arial";
  ctx.fillStyle = COLORS.gray;
  ctx.fillText("Fecha", m.left + plotW / 2, H - 22);
}


function getNiceMaxY(maxValue) {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return 5;
  const padded = maxValue * 1.18;
  if (padded <= 3) return 3;
  if (padded <= 5) return 5;
  if (padded <= 10) return 10;
  if (padded <= 20) return 20;
  if (padded <= 50) return Math.ceil(padded / 5) * 5;
  return Math.ceil(padded / 10) * 10;
}

function getMinSpacing(values) {
  const sorted = [...values].sort((a, b) => a - b);
  let min = Infinity;
  for (let i = 1; i < sorted.length; i++) min = Math.min(min, sorted[i] - sorted[i - 1]);
  return Number.isFinite(min) && min > 0 ? min : 42;
}

function getBarWidth(count, minSpacing, plotW) {
  if (count <= 1) return 34;
  if (count <= 3) return Math.max(24, Math.min(38, minSpacing * 0.55));
  if (count <= 7) return Math.max(18, Math.min(32, minSpacing * 0.50));
  return Math.max(9, Math.min(24, minSpacing * 0.42, plotW / Math.max(count, 10) * 0.65));
}

function drawVerticalEvent(ctx, xx, m, plotH, color, dashed, label, index) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = dashed ? 1.5 : 2.5;
  ctx.setLineDash(dashed ? [6, 5] : []);
  ctx.beginPath();
  ctx.moveTo(xx, m.top);
  ctx.lineTo(xx, m.top + plotH);
  ctx.stroke();
  ctx.setLineDash([]);

  const offset = (index % 5) * 18;
  ctx.translate(xx + 5, m.top + 22 + offset);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = color;
  ctx.font = dashed ? "700 11px Inter, Arial" : "900 12px Inter, Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

function drawDateTicks(ctx, rows, x, m, plotH) {
  const unique = [];
  const seen = new Set();
  rows.forEach(r => {
    const key = r.date.toISOString().slice(0, 10);
    if (!seen.has(key)) { seen.add(key); unique.push(r.date); }
  });
  const maxTicks = Math.max(8, Math.floor((m.left + (x(unique.at(-1) || new Date()) - m.left)) / 82));
  const step = Math.max(1, Math.ceil(unique.length / maxTicks));
  ctx.fillStyle = COLORS.gray;
  ctx.strokeStyle = COLORS.grid;
  ctx.font = "10.5px Inter, Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  unique.filter((_, i) => i % step === 0 || i === unique.length - 1).forEach((date, i) => {
    const xx = x(date);
    ctx.beginPath();
    ctx.moveTo(xx, m.top + plotH);
    ctx.lineTo(xx, m.top + plotH + 6);
    ctx.stroke();
    const yLabel = m.top + plotH + 12 + (i % 2) * 18;
    ctx.fillText(formatDate(date), xx, yLabel);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function downloadCanvas(canvas, filename) {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = filename;
  a.click();
}

function downloadExcel(rows) {
  const html = buildExcelHtml(rows);
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lluvias_aplicaciones_filtrado.xls";
  a.click();
  URL.revokeObjectURL(url);
}

function buildExcelHtml(rows) {
  const groups = [];
  let i = 0;
  while (i < rows.length) {
    const start = i;
    const locality = rows[i].locality;
    while (i < rows.length && rows[i].locality === locality) i++;
    groups.push({ start, end: i, size: i - start });
  }
  let groupByStart = new Map(groups.map(g => [g.start, g]));
  const body = rows.map((r, idx) => {
    const g = groupByStart.get(idx);
    const localityCell = g ? `<td rowspan="${g.size}" class="merged">${escapeHtml(r.locality)}</td>` : "";
    const cls = r.type === "Application" ? " class='application'" : "";
    return `<tr${cls}>
      <td>${escapeHtml(r.protocol)}</td>
      ${localityCell}
      <td>${escapeHtml(r.dateLabel)}</td>
      <td>${escapeHtml(r.description)}</td>
      <td>${escapeHtml(r.code)}</td>
      <td>${r.irrigation ?? ""}</td>
    </tr>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="UTF-8"><style>
    table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt;}
    th{background:#003B71;color:white;font-weight:700;border:1px solid #8bb8d2;padding:7px;text-align:left;}
    td{border:1px solid #c9dce8;padding:6px;vertical-align:middle;}
    .application td,.application{background:#DDF3D0;}
    .merged{font-weight:700;background:#F3F9FC;}
  </style></head><body><table>
    <thead><tr><th>Protocolo</th><th>Trial_mod</th><th>Activity_date</th><th>Activity description</th><th>Activity code</th><th>Avg(irrigation_amount)</th></tr></thead>
    <tbody>${body}</tbody>
  </table></body></html>`;
}

function clearAll() {
  els.dataInput.value = "";
  els.status.textContent = "";
  els.resultTable.innerHTML = "";
  els.summary.innerHTML = "";
  els.charts.innerHTML = "";
  els.downloadXlsBtn.disabled = true;
  allRows = [];
  filteredRows = [];
  groupedResult = new Map();
}

function loadDemo() {
  els.dataInput.value = `protocolo\tTrial_mod\tactivity_date\tactivity_description\tactivity_timing_code\tAvg(irrigation_amount)\nHP26ARGC01\tCG01-Corralito\t45968\tRain\t(Empty)\t26\nHP26ARGC01\tCG01-Corralito\t45970\tApplication\tA\t\nHP26ARGC01\tCG01-Corralito\t45973\tRain\t(Empty)\t4\nHP26ARGC01\tCG01-Corralito\t45993\tAssessment\tA1\t\nHP26ARGC01\tCG01-Corralito\t46000\tAssessment\tA2\t\nHP26ARGC01\tCG01-Corralito\t46021\tApplication\tB\t\nHP26ARGC01\tCG01-Corralito\t46023\tRain\t(Empty)\t9\nHP26ARGC02\tCG02-Pergamino\t45970\tRain\t(Empty)\t12\nHP26ARGC02\tCG02-Pergamino\t45971\tApplication\tA\t\nHP26ARGC02\tCG02-Pergamino\t45978\tAssessment\tA1\t\nHP26ARGC02\tCG02-Pergamino\t45980\tApplication\tC\t\nHP26ARGC02\tCG02-Pergamino\t45985\tRain\t(Empty)\t18`;
  processInput();
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[c]));
}
function round(n, d = 0) { return Number(n).toFixed(d).replace(/\.0$/, ""); }
function safeFile(name) { return String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase(); }
