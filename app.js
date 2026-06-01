const REQUIRED = {
  locality: ["trial_mod", "localidad", "trial"],
  date: ["activity_date", "fecha", "date"],
  description: ["activity_description", "activity description", "descripcion", "descripción"],
  code: ["activity_timing_code", "activity_code", "activity code", "codigo", "código"],
  irrigation: ["avg(irrigation_amount)", "irrigation_amount", "irrigation", "precipitacion", "precipitación", "lluvia", "mm"]
};

const COLORS = {
  green: "#66B512",
  blue: "#00A3E0",
  navy: "#003B71",
  gray: "#64748B",
  light: "#E8F7FC",
  grid: "#D9ECF4"
};

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
  downloadCsvBtn: document.getElementById("downloadCsvBtn")
};

els.processBtn.addEventListener("click", processInput);
els.clearBtn.addEventListener("click", clearAll);
els.loadDemoBtn.addEventListener("click", loadDemo);
els.downloadCsvBtn.addEventListener("click", () => downloadCsv(filteredRows));

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
      locality: findColumn(headers, REQUIRED.locality),
      date: findColumn(headers, REQUIRED.date),
      description: findColumn(headers, REQUIRED.description),
      code: findColumn(headers, REQUIRED.code),
      irrigation: findColumn(headers, REQUIRED.irrigation)
    };
    const missing = Object.entries(idx).filter(([, v]) => v === -1).map(([k]) => k);
    if (missing.length) throw new Error("No pude reconocer estas columnas: " + missing.join(", "));

    const rows = matrix.slice(1).map((r, i) => {
      const date = parseDateValue(r[idx.date]);
      const type = typeOfRow(r[idx.description]);
      return {
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

    groupedResult = buildWindows(rows);
    filteredRows = Array.from(groupedResult.values()).flat();
    renderSummary(rows, groupedResult, filteredRows);
    renderTable(filteredRows);
    renderCharts(groupedResult);
    els.downloadCsvBtn.disabled = filteredRows.length === 0;
    els.status.textContent = `Listo: ${filteredRows.length} filas filtradas en ${groupedResult.size} localidades.`;
  } catch (err) {
    els.status.textContent = err.message;
    els.downloadCsvBtn.disabled = true;
  }
}

function cleanCode(value) {
  const text = String(value ?? "").trim();
  return (!text || text === "(Empty)" || text.toLowerCase() === "null") ? "" : text;
}

function buildWindows(rows) {
  const byLocality = new Map();
  rows.forEach(r => {
    if (!byLocality.has(r.locality)) byLocality.set(r.locality, []);
    byLocality.get(r.locality).push(r);
  });
  const result = new Map();
  for (const [locality, items] of byLocality.entries()) {
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
    result.set(locality, sorted.slice(startIndex, endIndex + 1));
  }
  return result;
}

function renderSummary(allRows, groups, rows) {
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
  const head = ["Localidad", "Fecha", "Activity description", "Activity code", "Irrigation / lluvia (mm)"];
  const body = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.locality)}</td>
      <td>${escapeHtml(r.dateLabel)}</td>
      <td>${escapeHtml(r.description)}</td>
      <td>${escapeHtml(r.code)}</td>
      <td>${r.irrigation ?? ""}</td>
    </tr>
  `).join("");
  els.resultTable.innerHTML = `<thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody>`;
}

function renderCharts(groups) {
  els.charts.innerHTML = "";
  for (const [locality, rows] of groups.entries()) {
    const box = document.createElement("div");
    box.className = "chart-box";
    box.innerHTML = `
      <div class="chart-head">
        <h3>${escapeHtml(locality)}</h3>
        <button class="secondary">Descargar PNG</button>
      </div>
      <canvas></canvas>
    `;
    els.charts.appendChild(box);
    const canvas = box.querySelector("canvas");
    drawChart(canvas, locality, rows);
    box.querySelector("button").addEventListener("click", () => downloadCanvas(canvas, `grafico_${safeFile(locality)}.png`));
  }
}

function drawChart(canvas, locality, rows) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 980;
  const cssHeight = canvas.clientHeight || 430;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const W = cssWidth;
  const H = cssHeight;
  const m = { left: 62, right: 28, top: 42, bottom: 72 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const minT = Math.min(...rows.map(r => r.date.getTime()));
  const maxT = Math.max(...rows.map(r => r.date.getTime()));
  const span = Math.max(maxT - minT, 86400000);
  const rains = rows.filter(r => r.type === "Rain" && Number.isFinite(r.irrigation));
  const maxY = Math.max(10, ...rains.map(r => r.irrigation)) * 1.22;
  const x = date => m.left + ((date.getTime() - minT) / span) * plotW;
  const y = v => m.top + plotH - (v / maxY) * plotH;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = COLORS.navy;
  ctx.font = "800 18px Inter, Arial";
  ctx.fillText(locality, m.left, 26);

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
    ctx.fillText(round(val, 0), m.left - 9, yy);
  }

  ctx.strokeStyle = COLORS.navy;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(m.left, m.top);
  ctx.lineTo(m.left, m.top + plotH);
  ctx.lineTo(W - m.right, m.top + plotH);
  ctx.stroke();

  const barWidth = Math.max(5, Math.min(24, plotW / Math.max(rains.length, 12) * 0.62));
  rains.forEach(r => {
    const xx = x(r.date) - barWidth / 2;
    const yy = y(r.irrigation);
    const h = m.top + plotH - yy;
    const grad = ctx.createLinearGradient(0, yy, 0, m.top + plotH);
    grad.addColorStop(0, COLORS.blue);
    grad.addColorStop(1, "#BFEFFF");
    ctx.fillStyle = grad;
    roundRect(ctx, xx, yy, barWidth, h, 6);
    ctx.fill();
    ctx.fillStyle = COLORS.navy;
    ctx.font = "800 11px Inter, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${round(r.irrigation, 1)} mm`, x(r.date), yy - 4);
  });

  rows.filter(r => r.type === "Application").forEach((r, i) => drawVerticalEvent(ctx, x(r.date), m, plotH, COLORS.green, false, `Aplic. ${r.code || i + 1}`, i));
  rows.filter(r => r.type === "Assessment").forEach((r, i) => drawVerticalEvent(ctx, x(r.date), m, plotH, COLORS.navy, true, r.code || "Assessment", i));

  drawDateTicks(ctx, rows, x, m, plotH, W);

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "12px Inter, Arial";
  ctx.fillStyle = COLORS.gray;
  ctx.fillText("Precipitación / irrigación (mm)", m.left, H - 18);
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

  const offset = (index % 4) * 18;
  ctx.translate(xx + 5, m.top + 18 + offset);
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
  const maxTicks = 10;
  const step = Math.max(1, Math.ceil(unique.length / maxTicks));
  ctx.fillStyle = COLORS.gray;
  ctx.strokeStyle = COLORS.grid;
  ctx.font = "11px Inter, Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  unique.filter((_, i) => i % step === 0 || i === unique.length - 1).forEach(date => {
    const xx = x(date);
    ctx.beginPath();
    ctx.moveTo(xx, m.top + plotH);
    ctx.lineTo(xx, m.top + plotH + 6);
    ctx.stroke();
    ctx.save();
    ctx.translate(xx - 4, m.top + plotH + 47);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(formatDate(date), 0, 0);
    ctx.restore();
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function downloadCanvas(canvas, filename) {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = filename;
  a.click();
}

function downloadCsv(rows) {
  const header = ["Trial_mod", "activity_date", "activity_description", "activity_timing_code", "Avg(irrigation_amount)"];
  const lines = [header.join(";")].concat(rows.map(r => [
    r.locality,
    r.dateLabel,
    r.description,
    r.code,
    r.irrigation ?? ""
  ].map(csvCell).join(";")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lluvias_aplicaciones_filtrado.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function clearAll() {
  els.dataInput.value = "";
  els.status.textContent = "";
  els.resultTable.innerHTML = "";
  els.summary.innerHTML = "";
  els.charts.innerHTML = "";
  els.downloadCsvBtn.disabled = true;
  filteredRows = [];
  groupedResult = new Map();
}

function loadDemo() {
  els.dataInput.value = `Trial_mod\tactivity_date\tactivity_description\tactivity_timing_code\tAvg(irrigation_amount)\nCG01-Corralito\t45968\tRain\t(Empty)\t26\nCG01-Corralito\t45970\tApplication\tA\t\nCG01-Corralito\t45973\tRain\t(Empty)\t4\nCG01-Corralito\t45993\tAssessment\tA1\t\nCG01-Corralito\t46000\tAssessment\tA2\t\nCG01-Corralito\t46021\tApplication\tB\t\nCG01-Corralito\t46023\tRain\t(Empty)\t9\nCG02-Pergamino\t45970\tRain\t(Empty)\t12\nCG02-Pergamino\t45971\tApplication\tA\t\nCG02-Pergamino\t45978\tAssessment\tA1\t\nCG02-Pergamino\t45980\tApplication\tC\t\nCG02-Pergamino\t45985\tRain\t(Empty)\t18`;
  processInput();
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[c]));
}
function round(n, d = 0) { return Number(n).toFixed(d).replace(/\.0$/, ""); }
function safeFile(name) { return String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase(); }
