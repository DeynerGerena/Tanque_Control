// =====================================================
// SEÑAL DE CONTROL
// Traducción a JS plano de SenalControl.jsx + useControl.js
// (sin React, sin Tailwind, sin recharts, sin lucide: usa el Chart.js
//  que ya carga index.html y el mismo Firebase de app.js)
//
//  Firebase (todo en la raíz, junto a las variables que ya existían):
//    Lee:     Altura, SetPoint, Control, PWM, Modo, Kp, Ki, Kd, Seguridad, ts
//             (las escribe nodo_tanque.py a partir de lo que imprime el Arduino)
//    Escribe: Comandos/{sp, kp, ki, kd, modo, uManual, ts}
//             (nodo_tanque.py los reenvía al Arduino por serial)
//
//  Para ver la interfaz sin hardware: abre la página con  ?sim=1
// =====================================================
import { ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

export const H_MAX = 50;    // cm  (Hmax del Arduino)
export const H_SEG = 47;    // cm  (corte de seguridad del Arduino)
export const VALVE_V = 24;  // V   (alimentación de la bobina)

const PATH_LIVE = "/";            // la raíz, igual que app.js
const PATH_CMD = "Comandos";
const MAX_POINTS = 900;     // ~4.5 min a 0.3 s por muestra

// ---------- Iconos (lucide, en SVG) ----------
const ICON = {
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
};
const svg = (name, size = 14) =>
    `<svg class="ctl-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

// ---------- Utilidades ----------
const f = (v, d = 1) => (v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(d));

// Métricas del transitorio desde el último cambio de setpoint
function calcMetrics(hist, step) {
    if (!step || hist.length < 5 || hist[0].t > step.t + 1) return null;
    const pts = hist.filter((p) => p.t >= step.t);
    const A = Math.abs(step.sp - step.h0);
    if (pts.length < 5 || A < 2) return null;
    const s = Math.sign(step.sp - step.h0);
    const frac = (p) => ((p.h - step.h0) * s) / A;
    const cruce = (x) => pts.find((p) => frac(p) >= x);
    const t10 = cruce(0.1);
    const t90 = cruce(0.9);
    const band = Math.max(0.02 * A, 0.3); // ±2 % del escalón (mínimo 0.3 cm por ruido)
    const fuera = pts.filter((p) => Math.abs(p.h - step.sp) > band);
    const last = pts[pts.length - 1];
    const tFuera = fuera.length ? fuera[fuera.length - 1].t : step.t;
    const asentado = Math.abs(last.h - step.sp) <= band && last.t - tFuera > 5;
    const fin = pts.slice(-10);
    let iae = 0;
    for (let i = 1; i < pts.length; i++) iae += Math.abs(step.sp - pts[i].h) * (pts[i].t - pts[i - 1].t);
    return {
        overshoot: Math.max(0, (Math.max(...pts.map(frac)) - 1) * 100),
        tr: t10 && t90 ? t90.t - t10.t : null,
        ts: asentado ? tFuera - step.t : null,
        ess: step.sp - fin.reduce((a, p) => a + p.h, 0) / fin.length,
        iae,
    };
}

// =====================================================
// INICIO
// =====================================================
export function initControl(database) {
    const view = document.getElementById("view-control");
    if (!view) return;

    // Sin base de datos (o con ?sim=1) la pantalla corre con una simulación
    const MOCK = !database || new URLSearchParams(location.search).get("sim") === "1";

    // ---------- Estado (lo que en React eran useState / useRef) ----------
    let live = { h: 0, sp: 0, u: 0, pwm: 0, modo: 0, kp: 0, ki: 0, kd: 0, seg: 0 };
    const hist = [];                 // [{t, h, sp, u}]
    let online = false;
    let metrics = null;
    let step = null;
    let lastRx = 0;
    const t0 = Date.now();
    const cfg = { sp: 25, kp: 2, ki: 0.05, kd: 0, modo: 0, uManual: 0 };   // solo simulación
    const sim = { h: 5, I: 0, dF: 0, hPrev: 5 };
    const draft = {};                // valores que el usuario está editando
    let uMan = 0;

    // =====================================================
    // DOM
    // =====================================================
    const title = (text, icon) => `<h3 class="ctl-title">${icon ? svg(icon) : ""}${text}</h3>`;
    const num = (k, label, unit, stepV) => `
        <label class="ctl-num">
            <span>${label} <em>[${unit}]</em></span>
            <input class="ctl-in" data-k="${k}" type="number" min="0" step="${stepV}">
        </label>`;
    const metric = (id, label, unit) => `
        <div class="ctl-metric">
            <div class="ctl-metric-l">${label}</div>
            <div class="ctl-metric-v"><span id="c-m-${id}">—</span><span class="ctl-unit sm">${unit}</span></div>
        </div>`;

    view.innerHTML = `
    <div class="ctl">
        <header class="ctl-head">
            <div>
                <h1>Señal de control</h1>
                <p>Lazo PID de nivel · el controlador corre en el Arduino</p>
            </div>
            <div class="ctl-badges" id="c-badges"></div>
        </header>

        <div class="ctl-kpis">
            <section class="card">
                ${title("Setpoint", "target")}
                <div class="ctl-kpi-val c-green"><span id="c-sp">—</span><span class="ctl-unit">cm</span></div>
                <div class="ctl-sub">Referencia activa en el Arduino</div>
                <div class="ctl-row">
                    <input class="ctl-in" id="c-spIn" type="number" step="0.5" min="0" max="${H_SEG - 1}" placeholder="nuevo SP">
                    <button class="ctl-btn" id="c-spBtn">Fijar</button>
                </div>
            </section>

            <section class="card">
                ${title("Variable de proceso", "gauge")}
                <div class="ctl-kpi-val c-cyan"><span id="c-h">—</span><span class="ctl-unit">cm</span></div>
                <div class="ctl-sub" id="c-hPct"></div>
            </section>

            <section class="card">
                ${title("Error e = SP − PV", "activity")}
                <div class="ctl-kpi-val" id="c-eBox"><span id="c-e">—</span><span class="ctl-unit">cm</span></div>
                <div class="ctl-sub" id="c-eSub"></div>
            </section>

            <section class="card">
                ${title("Señal de control u", "sliders")}
                <div class="ctl-kpi-val c-amber"><span id="c-u">—</span><span class="ctl-unit">%</span></div>
                <div class="ctl-sub">Apertura comandada de la válvula</div>
                <div class="ctl-bar"><div id="c-uBar"></div></div>
            </section>

            <section class="card">
                ${title("Salida eléctrica", "zap")}
                <div class="ctl-kpi-val"><span id="c-v">—</span><span class="ctl-unit">V prom.</span></div>
                <div class="ctl-sub" id="c-pwm"></div>
            </section>
        </div>

        <div class="ctl-main">
            <div class="ctl-col wide">
                <section class="card">
                    ${title("Respuesta del tanque · altura vs. tiempo", "activity")}
                    <div class="ctl-chart tall"><canvas id="c-lineChart"></canvas></div>
                </section>
                <section class="card">
                    ${title("Señal de control · hacia la válvula", "zap")}
                    <div class="ctl-chart short"><canvas id="c-areaChart"></canvas></div>
                </section>
            </div>

            <div class="ctl-col">
                <section class="card">
                    ${title("Controlador PID", "sliders")}
                    <div class="ctl-modes">
                        <button data-modo="0">${svg("hand", 15)}Manual</button>
                        <button data-modo="1">${svg("bot", 15)}Automático</button>
                    </div>
                    <div class="ctl-nums">
                        ${num("kp", "Kp", "%/cm", "0.1")}
                        ${num("ki", "Ki", "%/cm·s", "0.01")}
                        ${num("kd", "Kd", "%·s/cm", "0.1")}
                    </div>
                    <p class="ctl-note" id="c-tiTd"></p>
                    <button class="ctl-btn full" id="c-apply">Aplicar ganancias</button>
                    <div class="ctl-manual" id="c-manual">
                        <div class="ctl-manual-h"><span>Salida manual</span><span id="c-uManVal">0 %</span></div>
                        <input id="c-uMan" type="range" min="0" max="100" value="0">
                    </div>
                </section>

                <section class="card">
                    ${title("Métricas del transitorio", "timer")}
                    <div class="ctl-metrics">
                        ${metric("overshoot", "Sobrepaso", "%")}
                        ${metric("tr", "T. subida 10–90 %", "s")}
                        ${metric("ts", "T. establ. ±2 %", "s")}
                        ${metric("ess", "Error estacionario", "cm")}
                        ${metric("iae", "IAE", "cm·s")}
                        <div class="ctl-metric cut">${svg("shield", 16)}Corte a ${H_SEG} cm</div>
                    </div>
                    <p class="ctl-note">Calculadas desde el último cambio de setpoint (escalón ≥ 2 cm).</p>
                </section>
            </div>
        </div>
    </div>`;

    const $ = (id) => view.querySelector("#" + id);
    const el = {
        badges: $("c-badges"), sp: $("c-sp"), spIn: $("c-spIn"), spBtn: $("c-spBtn"),
        h: $("c-h"), hPct: $("c-hPct"), eBox: $("c-eBox"), e: $("c-e"), eSub: $("c-eSub"),
        u: $("c-u"), uBar: $("c-uBar"), v: $("c-v"), pwm: $("c-pwm"),
        tiTd: $("c-tiTd"), apply: $("c-apply"), manual: $("c-manual"),
        uMan: $("c-uMan"), uManVal: $("c-uManVal"),
        modeBtns: [...view.querySelectorAll("[data-modo]")],
        gainIns: [...view.querySelectorAll("[data-k]")],
        m: {
            overshoot: $("c-m-overshoot"), tr: $("c-m-tr"), ts: $("c-m-ts"),
            ess: $("c-m-ess"), iae: $("c-m-iae"),
        },
    };

    // =====================================================
    // GRÁFICAS (Chart.js, el mismo que ya carga index.html)
    // =====================================================
    const AXIS_TICK = "#94a3b8", AXIS_LINE = "#475569", GRID = "#1e293b";

    const xScale = () => ({
        type: "linear",
        bounds: "data",
        ticks: { color: AXIS_TICK, font: { size: 11 }, callback: (t) => `${Math.round(t)}s`, maxTicksLimit: 8 },
        grid: { color: GRID },
        border: { color: AXIS_LINE, dash: [3, 3] },
    });
    const yScale = (max, unit) => ({
        min: 0, max,
        ticks: { color: AXIS_TICK, font: { size: 11 }, callback: (v) => `${v}${unit}` },
        grid: { color: GRID },
        border: { color: AXIS_LINE, dash: [3, 3] },
    });
    const tooltipBase = {
        mode: "index", intersect: false,
        backgroundColor: "#050d1f", borderColor: "rgba(34,211,238,.2)", borderWidth: 1, cornerRadius: 8,
        titleFont: { size: 12 }, bodyFont: { size: 12 },
        callbacks: { title: (items) => `t = ${Number(items[0].parsed.x).toFixed(1)} s` },
    };

    // Línea de referencia del corte de seguridad (ReferenceLine de recharts)
    const refLine = {
        id: "refLine",
        afterDatasetsDraw(chart) {
            const y = chart.scales.y;
            if (!y) return;
            const a = chart.chartArea;
            const py = y.getPixelForValue(H_SEG);
            const ctx = chart.ctx;
            ctx.save();
            ctx.strokeStyle = "#f87171";
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(a.left, py);
            ctx.lineTo(a.right, py);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#f87171";
            ctx.font = "10px sans-serif";
            ctx.textAlign = "right";
            ctx.textBaseline = "top";
            ctx.fillText(`Corte ${H_SEG} cm`, a.right - 4, py + 3);
            ctx.restore();
        },
    };

    // Tooltip sincronizado entre las dos gráficas (syncId="ctrl" en recharts)
    let lineChart, areaChart;
    function syncTooltip(target, els) {
        if (!target) return;
        if (!els.length) {
            target.tooltip.setActiveElements([], { x: 0, y: 0 });
            target.setActiveElements([]);
            target.update("none");
            return;
        }
        const idx = els[0].index;
        const pt = target.getDatasetMeta(0).data[idx];
        if (!pt) return;
        const active = target.data.datasets.map((_, di) => ({ datasetIndex: di, index: idx }));
        target.tooltip.setActiveElements(active, { x: pt.x, y: pt.y });
        target.setActiveElements(active);
        target.update("none");
    }

    const key = (k) => ({ xAxisKey: "t", yAxisKey: k });

    lineChart = new Chart($("c-lineChart"), {
        type: "line",
        plugins: [refLine],
        data: {
            datasets: [
                {
                    label: "Setpoint", data: hist, parsing: key("sp"),
                    borderColor: "#34d399", borderWidth: 2, borderDash: [6, 4],
                    pointRadius: 0, pointHoverRadius: 4, stepped: "after",
                },
                {
                    label: "Altura (PV)", data: hist, parsing: key("h"),
                    borderColor: "#22d3ee", borderWidth: 2.5,
                    pointRadius: 0, pointHoverRadius: 4,
                },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: "index", intersect: false, axis: "x" },
            onHover: (_e, els) => syncTooltip(areaChart, els),
            plugins: {
                legend: { labels: { color: AXIS_TICK, font: { size: 12 } } },
                tooltip: {
                    ...tooltipBase,
                    callbacks: {
                        ...tooltipBase.callbacks,
                        label: (c) => `${c.dataset.label}: ${Number(c.parsed.y).toFixed(2)} cm`,
                    },
                },
            },
            scales: { x: xScale(), y: yScale(H_MAX, " cm") },
        },
    });

    areaChart = new Chart($("c-areaChart"), {
        type: "line",
        data: {
            datasets: [
                {
                    label: "Señal de control", data: hist, parsing: key("u"),
                    borderColor: "#fbbf24", borderWidth: 2, stepped: "after",
                    pointRadius: 0, pointHoverRadius: 4, fill: true,
                    backgroundColor: (ctx) => {
                        const chart = ctx.chart, a = chart.chartArea;
                        if (!a) return "rgba(251,191,36,.3)";
                        const g = chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
                        g.addColorStop(0, "rgba(251,191,36,.5)");
                        g.addColorStop(1, "rgba(251,191,36,0)");
                        return g;
                    },
                },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: "index", intersect: false, axis: "x" },
            onHover: (_e, els) => syncTooltip(lineChart, els),
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...tooltipBase,
                    callbacks: {
                        ...tooltipBase.callbacks,
                        label: (c) =>
                            `${c.dataset.label}: ${Number(c.parsed.y).toFixed(1)} % · ${((c.parsed.y * VALVE_V) / 100).toFixed(1)} V prom.`,
                    },
                },
            },
            scales: { x: xScale(), y: yScale(100, " %") },
        },
    });

    const viewActive = () => view.classList.contains("active");
    const updateCharts = () => {
        lineChart.update("none");
        areaChart.update("none");
    };

    // La pestaña arranca oculta: al mostrarla hay que recalcular tamaño y redibujar
    const navBtn = document.querySelector('.nav-btn[data-view="control"]');
    if (navBtn) {
        navBtn.addEventListener("click", () =>
            requestAnimationFrame(() => {
                lineChart.resize();
                areaChart.resize();
                updateCharts();
            })
        );
    }

    // =====================================================
    // RENDER (lo que React hacía al volver a pintar)
    // =====================================================
    const badge = (cls, text) => `<span class="ctl-badge ${cls}"><i></i>${text}</span>`;

    function renderBadges() {
        const auto = live.modo === 1;
        el.badges.innerHTML =
            (MOCK ? badge("warn", "Simulación") : "") +
            badge(online ? "ok" : "bad", online ? "Enlace en línea" : "Sin datos") +
            badge(auto ? "ok" : "warn", auto ? "Modo automático" : "Modo manual") +
            badge(!live.seg ? "ok" : "bad", live.seg ? "Desborde · válvula cerrada" : "Seguridad OK");
    }

    // Inputs de ganancias y setpoint: muestran lo que se está editando, o el valor activo
    function syncInputs() {
        if (document.activeElement !== el.spIn) {
            const s = draft.sp ?? "";
            if (el.spIn.value !== String(s)) el.spIn.value = s;
        }
        el.gainIns.forEach((inp) => {
            if (document.activeElement === inp) return;   // no pisar lo que se está escribiendo
            const v = draft[inp.dataset.k] ?? live[inp.dataset.k];
            const s = v == null ? "" : String(v);
            if (inp.value !== s) inp.value = s;
        });
    }

    function render() {
        const e = live.sp - live.h;
        const auto = live.modo === 1;
        const ti = live.ki > 0 ? live.kp / live.ki : null;
        const td = live.kp > 0 ? live.kd / live.kp : 0;

        renderBadges();

        el.sp.textContent = f(live.sp);
        el.h.textContent = f(live.h);
        el.hPct.textContent = `${f((live.h / H_MAX) * 100)} % del tanque`;

        el.e.textContent = `${e > 0 ? "+" : ""}${f(e, 2)}`;
        el.eSub.textContent = Math.abs(e) <= 0.5 ? "Dentro de ±0.5 cm" : "Fuera de banda";
        el.eBox.className =
            "ctl-kpi-val " + (Math.abs(e) <= 0.5 ? "c-green" : Math.abs(e) <= 3 ? "c-amber" : "c-rose");

        el.u.textContent = f(live.u);
        el.uBar.style.width = `${Math.min(100, Math.max(0, Number(live.u) || 0))}%`;

        el.v.textContent = f((live.pwm / 255) * VALVE_V);
        el.pwm.textContent = `PWM ${live.pwm}/255 · duty ${f(live.pwm / 2.55, 0)} %`;

        el.modeBtns.forEach((b) => b.classList.toggle("active", live.modo === Number(b.dataset.modo)));
        el.tiTd.textContent = `Activo: Ti = Kp/Ki = ${ti ? `${f(ti)} s` : "∞"} · Td = Kd/Kp = ${f(td)} s`;

        el.manual.classList.toggle("is-auto", auto);
        el.uMan.disabled = auto;

        el.m.overshoot.textContent = f(metrics?.overshoot);
        el.m.tr.textContent = f(metrics?.tr);
        el.m.ts.textContent = f(metrics?.ts);
        el.m.ess.textContent = f(metrics?.ess, 2);
        el.m.iae.textContent = f(metrics?.iae, 0);

        syncInputs();
        if (viewActive()) updateCharts();
    }

    // =====================================================
    // DATOS
    // =====================================================
    function push(d) {
        const t = (Date.now() - t0) / 1000;
        lastRx = Date.now();
        if (!step || Math.abs(d.sp - step.sp) > 0.05) step = { t, h0: d.h, sp: d.sp };
        live = d;
        hist.push({ t, h: d.h, sp: d.sp, u: d.u });
        if (hist.length > MAX_POINTS) hist.shift();
        metrics = calcMetrics(hist, step);
        render();
    }

    // cmd admite: sp, kp, ki, kd, modo (0/1), uManual (%)
    function send(cmd) {
        if (MOCK) Object.assign(cfg, cmd);
        else update(ref(database, PATH_CMD), { ...cmd, ts: Date.now() });
    }

    // ---- Datos reales: Firebase RTDB ----
    if (!MOCK) {
        let lastTs = null;
        onValue(ref(database, PATH_LIVE), (snap) => {
            const d = snap.val();
            if (!d || d.Altura == null || d.Control == null) return;   // aún no hay datos del lazo PID
            if (d.ts != null) {                // ignora cambios que no son telemetría (p. ej. un comando)
                if (d.ts === lastTs) return;
                lastTs = d.ts;
            }
            push({
                h: Number(d.Altura), sp: Number(d.SetPoint), u: Number(d.Control), pwm: Number(d.PWM),
                modo: Number(d.Modo), kp: Number(d.Kp), ki: Number(d.Ki), kd: Number(d.Kd),
                seg: Number(d.Seguridad),
            });
        });
    }

    // ---- Simulación (solo para ver la interfaz sin hardware). Espeja el PID del firmware ----
    if (MOCK) {
        const dt = 0.3;
        setInterval(() => {
            const s = sim;
            const c = cfg;
            const e = c.sp - s.h;
            const seg = s.h >= H_SEG ? 1 : 0;
            s.dF += (dt / (1 + dt)) * (-(s.h - s.hPrev) / dt - s.dF);
            s.hPrev = s.h;
            let u;
            if (seg) {
                u = 0;
                s.I = 0;
            } else if (!c.modo) {
                u = c.uManual;
                s.I = u - c.kp * e;
            } else {
                const uPre = c.kp * e + s.I + c.kd * s.dF;
                if (!((uPre >= 100 && e > 0) || (uPre <= 0 && e < 0))) s.I += c.ki * e * dt;
                s.I = Math.min(100, Math.max(0, s.I));
                u = c.kp * e + s.I + c.kd * s.dF;
            }
            u = Math.min(100, Math.max(0, u));
            s.h = Math.min(H_MAX, Math.max(0, s.h + dt * ((2 * u) / 100 - 1.2 * Math.sqrt(s.h / 50))));
            push({
                h: s.h + (Math.random() - 0.5) * 0.2,
                sp: c.sp, u, pwm: Math.round(u * 2.55), modo: c.modo, kp: c.kp, ki: c.ki, kd: c.kd, seg,
            });
        }, dt * 1000);
    }

    // ---- Estado del enlace ----
    setInterval(() => {
        const o = Date.now() - lastRx < 3000;
        if (o !== online) {
            online = o;
            renderBadges();
        }
    }, 1000);

    // =====================================================
    // EVENTOS
    // =====================================================
    function apply(keys) {
        const cmd = {};
        keys.forEach((k) => {
            const n = parseFloat(draft[k]);
            if (!Number.isNaN(n)) cmd[k] = n;
        });
        if (Object.keys(cmd).length) send(cmd);
        keys.forEach((k) => delete draft[k]);
        syncInputs();
    }

    el.spIn.addEventListener("input", () => { draft.sp = el.spIn.value; });
    el.spBtn.addEventListener("click", () => apply(["sp"]));

    el.gainIns.forEach((inp) =>
        inp.addEventListener("input", () => { draft[inp.dataset.k] = inp.value; })
    );
    el.apply.addEventListener("click", () => apply(["kp", "ki", "kd"]));

    el.modeBtns.forEach((b) =>
        b.addEventListener("click", () => send({ modo: Number(b.dataset.modo) }))
    );

    el.uMan.addEventListener("input", () => {
        uMan = +el.uMan.value;
        el.uManVal.textContent = `${uMan} %`;
    });
    el.uMan.addEventListener("pointerup", () => send({ uManual: uMan }));
    el.uMan.addEventListener("keyup", () => send({ uManual: uMan }));

    render();
}
