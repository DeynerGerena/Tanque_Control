// =====================================================
// FIREBASE
// =====================================================
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { initPresentation } from "./presentation.js";
initPresentation();


const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// Se lee la raíz de la base. Estructura actual en Firebase:
//   Voltaje: 2.73
//   Altura: 58.4
//   SetPoint: 60
//   Temperatura: 22.3
const tankRef = ref(database, "/");   // los datos están en la raíz de tu base

// =====================================================
// CONFIGURACIÓN DEL SENSOR
// =====================================================
const MAX_HEIGHT = 50;    // cm (rango real del tanque)
const H_MIN = 5;          // la línea empieza en 5 cm

// Linealización calculada en el microcontrolador: h = SLOPE·V + OFFSET
const SLOPE = 10.17;
const OFFSET = -1.36;

// Rango de voltaje mostrado en el eje X de la gráfica
const V_AXIS_MIN = 0;
const V_AXIS_MAX = 5;

// Voltaje al que la recta cruza 0 cm y MAX_HEIGHT (para dibujar la recta teórica)
const voltageFromHeight = (h) => (h - OFFSET) / SLOPE;
const heightFromVoltage = (v) => SLOPE * v + OFFSET;

document.getElementById("equation").textContent =
    `h = ${SLOPE} · V ${OFFSET < 0 ? "−" : "+"} ${Math.abs(OFFSET)}`;

// =====================================================
// NAVEGACIÓN ENTRE VISTAS
// =====================================================
document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("view-" + btn.dataset.view).classList.add("active");
    });
});

// =====================================================
// GRÁFICO: voltaje (x) vs altura linealizada (y)
// =====================================================
const measuredPoints = [];   // {x: voltaje, y: altura}
const currentPoint = [];     // un solo punto

const chart = new Chart(document.getElementById("characterizationChart"), {
    type: "scatter",
    data: {
        datasets: [
            {
                label: "Curva de caracterización",
                data: [
                    { x: voltageFromHeight(H_MIN), y: H_MIN },          // 0.625 V, 5 cm
                    { x: voltageFromHeight(MAX_HEIGHT), y: MAX_HEIGHT }
                ],
                showLine: true,
                borderColor: "#3b82f6",
                borderWidth: 2,
                pointRadius: 0
            },
            {
                label: "Mediciones",
                data: measuredPoints,
                backgroundColor: "#60a5fa",
                pointRadius: 3
            },
            {
                label: "Punto actual",
                data: currentPoint,
                backgroundColor: "#ffffff",
                borderColor: "#3b82f6",
                borderWidth: 3,
                pointRadius: 7
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
            legend: { labels: { color: "#8a9bbd" } },
            tooltip: {
                callbacks: {
                    label: (c) => `V: ${c.parsed.x.toFixed(2)} V  |  H: ${c.parsed.y.toFixed(1)} cm`
                }
            }
        },
        scales: {
            x: {
                min: V_AXIS_MIN, max: V_AXIS_MAX,
                title: { display: true, text: "Voltaje (V)", color: "#e6edf9" },
                ticks: { color: "#8a9bbd" },
                grid: { color: "#14213f" }
            },
            y: {
                min: 0, max: MAX_HEIGHT,
                title: { display: true, text: "Altura linealizada (cm)", color: "#e6edf9" },
                ticks: { color: "#8a9bbd" },
                grid: { color: "#14213f" }
            }
        }
    }
});

// =====================================================
// ACTUALIZAR INTERFAZ
// =====================================================
const $ = (id) => document.getElementById(id);

function updateUI({ voltage, height, setpoint, temperature }) {

    const h = Math.max(0, Math.min(height, MAX_HEIGHT));
    const pct = (h / MAX_HEIGHT) * 100;

    // Tanque
    $("water").style.height = pct + "%";
    $("heightValue").textContent = h.toFixed(1);
    $("percentageValue").textContent = pct.toFixed(1);

    // Cards
    $("kVoltage").textContent = voltage.toFixed(2);
    $("kHeight").textContent = h.toFixed(1);

    if (setpoint !== null) {
        const err = setpoint - h;
        $("kSetpoint").textContent = setpoint.toFixed(1);
        $("kError").textContent =
            `Error: ${err.toFixed(1)} cm (${((Math.abs(err) / MAX_HEIGHT) * 100).toFixed(1)}%)`;
    }
    if (temperature !== null) {
        $("kTemp").textContent = temperature.toFixed(2);
    }

    // Gráfico
    measuredPoints.push({ x: voltage, y: h });
    if (measuredPoints.length > 300) measuredPoints.shift();

    currentPoint.length = 0;
    currentPoint.push({ x: voltage, y: h });

    chart.update();
}

// =====================================================
// LEER FIREBASE EN TIEMPO REAL
// =====================================================
const toNum = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

onValue(
    tankRef,
    (snapshot) => {
        const d = snapshot.val();
        if (!d) return;

        $("statusDot").classList.add("online");
        $("statusText").textContent = "En línea";

        let voltage = toNum(d.Voltaje);
        let height = toNum(d.Altura);

        // La linealización ya viene hecha desde el microcontrolador.
        // Solo si falta la altura se calcula aquí con la misma recta.
        if (height === null && voltage !== null) height = heightFromVoltage(voltage);
        if (voltage === null || height === null) return;

        updateUI({
            voltage,
            height,
            setpoint: toNum(d.SetPoint),
            temperature: toNum(d.Voltaje_original)
        });
    },
    () => {
        $("statusDot").classList.remove("online");
        $("statusText").textContent = "Sin conexión";
    }
);

// =====================================================
// BOTONES
// =====================================================
$("btnReset").addEventListener("click", () => {
    measuredPoints.length = 0;
    chart.update();
});

$("btnDownload").addEventListener("click", () => {
    const rows = ["voltaje_V,altura_cm",
        ...measuredPoints.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(2)}`)];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "caracterizacion_sensor.csv";
    a.click();
    URL.revokeObjectURL(a.href);
});