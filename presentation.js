// =====================================================
// PRESENTACIÓN: miniaturas + visor a pantalla completa
// =====================================================
// Pon tus imágenes en la carpeta "slides/" y agrégalas aquí en orden:
const SLIDES = [
    "slides/01_datasheet.png",
    "slides/02_secuencia_electrica.png",
    "slides/03_comparacion_microcontroladores.png",
    "slides/04_caracterizacion.png",
    "slides/05_linealizacion.png",
    "slides/06_ajuste_ecuaciones.png",
    "slides/07_codigo_filtro_ema.png",
    "slides/08_subida_bajada.png",
    "slides/09_arquitectura.png",
];

export function initPresentation() {
    const grid = document.getElementById("slideGrid");
    const fileInput = document.getElementById("slideFiles");
    let current = 0;

    // ---------- Visor (se crea una sola vez) ----------
    const viewer = document.createElement("div");
    viewer.className = "slide-viewer";
    viewer.hidden = true;
    viewer.innerHTML = `
        <img alt="Diapositiva">
        <button class="sv-btn sv-close" aria-label="Cerrar">✕</button>
        <button class="sv-btn sv-prev" aria-label="Anterior">‹</button>
        <button class="sv-btn sv-next" aria-label="Siguiente">›</button>
        <div class="sv-count"></div>`;
    document.body.appendChild(viewer);

    const viewerImg = viewer.querySelector("img");
    const counter = viewer.querySelector(".sv-count");

    function show(i) {
        current = (i + SLIDES.length) % SLIDES.length;
        viewerImg.src = SLIDES[current];
        counter.textContent = `${current + 1} / ${SLIDES.length}`;
    }

    function open(i) {
        show(i);
        viewer.hidden = false;
        // Pantalla completa real del navegador (si lo permite)
        if (viewer.requestFullscreen) viewer.requestFullscreen().catch(() => {});
    }

    function close() {
        viewer.hidden = true;
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }

    viewer.querySelector(".sv-close").addEventListener("click", close);
    viewer.querySelector(".sv-prev").addEventListener("click", () => show(current - 1));
    viewer.querySelector(".sv-next").addEventListener("click", () => show(current + 1));

    // Si el usuario sale de pantalla completa con Esc, se cierra el visor
    document.addEventListener("fullscreenchange", () => {
        if (!document.fullscreenElement) viewer.hidden = true;
    });

    document.addEventListener("keydown", (e) => {
        if (viewer.hidden) return;
        if (e.key === "ArrowRight") show(current + 1);
        else if (e.key === "ArrowLeft") show(current - 1);
        else if (e.key === "Escape") close();
    });

    // ---------- Miniaturas ----------
    function render() {
        grid.innerHTML = "";

        if (SLIDES.length === 0) {
            grid.innerHTML = '<p class="slide-empty">No hay diapositivas todavía. Agrega imágenes en la lista SLIDES de presentation.js o usa "Agregar imágenes".</p>';
            return;
        }

        SLIDES.forEach((src, i) => {
            const card = document.createElement("button");
            card.className = "slide-card";
            card.innerHTML = `<img src="${src}" alt="Diapositiva ${i + 1}" loading="lazy"><span>Diapositiva ${i + 1}</span>`;
            card.addEventListener("click", () => open(i));
            grid.appendChild(card);
        });
    }

    // ---------- Agregar imágenes desde el computador (solo para esta sesión) ----------
    fileInput.addEventListener("change", () => {
        [...fileInput.files].forEach((f) => SLIDES.push(URL.createObjectURL(f)));
        fileInput.value = "";
        render();
    });

    render();
}
