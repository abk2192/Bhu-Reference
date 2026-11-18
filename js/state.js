// ============================================================================
// SHARED GLOBAL STATE, INDEXED-DB ENGINE, ACCORDION NAVIGATION & UI HELPERS
// ============================================================================

if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

window.AppState = {
    activeStep: 1,
    theme: 'light',
    sourceCanvas: document.createElement('canvas'),
    pdfDoc: null,
    pdfPageProxy: null,
    currentPage: 1,
    totalPages: 1,
    pdfRenderScale: 4.0,

    rawFileDataUrl: null,
    rawFileName: null,
    rawFileMime: null,

    pdfCam: {
        x: 20,
        y: 20,
        zoom: 0.45,
        isDragging: false,
        dragStartX: 0,
        dragStartY: 0,
        pinchStartDist: 0,
        pinchStartZoom: 1
    },

    pdfTool: 'pickA', // 'pickA' | 'pickB' | 'pan'
    mapTool: 'pickA', // 'pickA' | 'pickB' | 'pan'

    // Clean slate: No default coordinates on startup
    pdfPtA: null,
    pdfPtB: null,
    mapPtA: null,
    mapPtB: null,

    printedScaleDenominator: 3960,
    pdfDpi: 150,
    solverMode: 'locked_scale',
    manualScaleMultiplier: 1.0,
    manualRotationOffsetDeg: 0.0,

    overlayOpacity: 0.85,
    blendMultiply: true,
    inkBoost: true,
    crispVectorZoom: true,
    invertColors: false,
    showMapPins: true,
    isFullScreen: false,

    solution: {
        valid: false,
        metersPerPixel: 0,
        rotationRad: 0,
        rotationDeg: 0,
        pdfDistPx: 0,
        groundDistMeters: 0,
        impliedScaleDenominator: 0,
        scaleDriftPercent: 0
    }
};

// Global Map & Layer References
window.map = null;
window.baseLayers = {};
window.markerMapA = null;
window.markerMapB = null;
window.vectorLineMap = null;
window.cadastralOverlayLayer = null;

// IndexedDB Session Persistence Constants
const IDB_NAME = 'BhuAlignSessionDB';
const IDB_STORE = 'projects';
const IDB_KEY = 'latest_village_session';

function openSessionDB() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('IndexedDB unsupported'));
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveSessionToIndexedDB() {
    if (!AppState.rawFileDataUrl) return;
    try {
        const payload = buildProjectBundleObject();
        const db = await openSessionDB();
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(payload, IDB_KEY);
    } catch (err) {}
}

async function checkSavedSessionInIndexedDB() {
    try {
        const db = await openSessionDB();
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = () => {
            const data = req.result;
            if (data && data.fileDataUrl && data.fileName) {
                const banner = document.getElementById('session-restore-banner');
                const label = document.getElementById('session-restore-label');
                label.textContent = `${data.fileName} (Page ${data.currentPage || 1})`;
                banner.classList.remove('hidden');
                banner._savedData = data;
            }
        };
    } catch (err) {}
}

async function clearSavedSessionInIndexedDB(silent = false) {
    try {
        const db = await openSessionDB();
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(IDB_KEY);
        const banner = document.getElementById('session-restore-banner');
        banner.classList.add('hidden');
        banner._savedData = null;
        if (!silent) {
            showToast('Deleted saved session from browser IndexedDB storage.', 'info');
        }
    } catch (err) {}
}

async function resetAllPointsAndStorage(wipeIndexedDB = true) {
    if (typeof clearPdfPoints === 'function') clearPdfPoints(false);
    if (typeof clearMapPoints === 'function') clearMapPoints(false);
    if (wipeIndexedDB) {
        await clearSavedSessionInIndexedDB(true);
    }
    if (typeof solveAndRenderGeoreference === 'function') solveAndRenderGeoreference();
    updateStepBadges();
    showToast("🗑️ All points (A, B, A', B') and saved browser cache have been reset!", 'success');
}

function setAppTheme(themeName) {
    AppState.theme = themeName;
    document.documentElement.setAttribute('data-theme', themeName);

    const btns = {
        light: document.getElementById('theme-btn-light'),
        sepia: document.getElementById('theme-btn-sepia'),
        dark: document.getElementById('theme-btn-dark')
    };

    Object.keys(btns).forEach(k => {
        if (!btns[k]) return;
        if (k === themeName) {
            btns[k].className = 'px-2.5 py-1 rounded-md font-semibold transition flex items-center gap-1 bg-sky-600 text-white shadow-sm';
        } else {
            btns[k].className = 'px-2.5 py-1 rounded-md font-medium transition flex items-center gap-1 theme-text-muted hover:opacity-80';
        }
    });

    if (typeof renderPdfViewport === 'function') renderPdfViewport();
}

function showToast(htmlMsg, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    const bgMap = {
        info: 'bg-slate-900 text-white border-sky-400',
        success: 'bg-emerald-900 text-white border-emerald-400',
        warn: 'bg-amber-900 text-white border-amber-400'
    };
    el.className = `px-4 py-2.5 rounded-xl border shadow-lg text-xs font-medium text-center transition-all duration-300 ${bgMap[type] || bgMap.info}`;
    el.innerHTML = htmlMsg;
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 250);
    }, 3200);
}

function toggleStep(stepNum) {
    openStep(stepNum);
}

function openStep(stepNum) {
    AppState.activeStep = stepNum;

    for (let i = 1; i <= 4; i++) {
        const body = document.getElementById(`step-body-${i}`);
        const chevron = document.getElementById(`step-chevron-${i}`);
        const card = document.getElementById(`step-card-${i}`);

        if (i === stepNum) {
            body.classList.add('open');
            chevron.classList.add('rotate-180');
            card.classList.add('ring-2', 'ring-sky-500/40');
        } else {
            body.classList.remove('open');
            chevron.classList.remove('rotate-180');
            card.classList.remove('ring-2', 'ring-sky-500/40');
        }
    }

    const mapWrapper = document.getElementById('shared-map-wrapper');
    const reticle = document.getElementById('map-center-reticle');

    if (stepNum === 3) {
        document.getElementById('step-3-map-slot').appendChild(mapWrapper);
        reticle.classList.remove('hidden');
        if (window.cadastralOverlayLayer) window.cadastralOverlayLayer._updateFilters();
    } else if (stepNum === 4) {
        document.getElementById('step-4-map-slot').appendChild(mapWrapper);
        reticle.classList.add('hidden');
        if (typeof setMapTool === 'function') setMapTool('pan');
        if (typeof solveAndRenderGeoreference === 'function') solveAndRenderGeoreference();
    }

    setTimeout(() => {
        if (stepNum === 2 && typeof resizePdfViewport === 'function') {
            resizePdfViewport();
            fitPdfToViewport();
        }
        if ((stepNum === 3 || stepNum === 4) && window.map) {
            window.map.invalidateSize();
            if (stepNum === 4 && AppState.mapPtA && AppState.mapPtB) {
                const bounds = L.latLngBounds([AppState.mapPtA, AppState.mapPtB]).pad(0.45);
                window.map.fitBounds(bounds);
            } else if (stepNum === 4 && AppState.mapPtA) {
                window.map.setView(AppState.mapPtA, 17);
            }
        }
        document.getElementById(`step-card-${stepNum}`).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);

    updateStepBadges();
}

function updateStepBadges() {
    const hasPdf = AppState.sourceCanvas.width > 0;
    const hasPdfPts = Boolean(AppState.pdfPtA);
    const hasMapPts = Boolean(AppState.mapPtA);
    const isAligned = AppState.solution.valid;

    const setBadgeState = (step, done, statusText) => {
        const badge = document.getElementById(`step-badge-${step}`);
        const status = document.getElementById(`step-status-${step}`);
        const pill = document.getElementById(`pill-${step}`);

        if (done) {
            badge.className = 'w-8 h-8 rounded-full bg-emerald-600 text-white font-bold text-sm flex items-center justify-center shrink-0 shadow-sm';
            badge.innerHTML = '✓';
            status.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300';
            status.textContent = statusText;
            pill.className = 'px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold';
        } else if (AppState.activeStep === step) {
            badge.className = 'w-8 h-8 rounded-full bg-sky-600 text-white font-bold text-sm flex items-center justify-center shrink-0 shadow-sm';
            badge.textContent = step;
            status.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-100 text-sky-800 border border-sky-300';
            status.textContent = 'In Progress';
            pill.className = 'px-2 py-0.5 rounded bg-sky-600 text-white font-semibold';
        } else {
            badge.className = 'w-8 h-8 rounded-full bg-slate-400 text-white font-bold text-sm flex items-center justify-center shrink-0';
            badge.textContent = step;
            status.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-300';
            status.textContent = statusText;
            pill.className = 'px-2 py-0.5 rounded theme-subtle theme-text-muted';
        }
    };

    setBadgeState(1, hasPdf, hasPdf ? `1:${AppState.printedScaleDenominator}` : 'Upload PDF');
    setBadgeState(2, hasPdfPts, AppState.pdfPtB ? 'A & B Set' : (hasPdfPts ? 'Pt A Set' : 'Pick Pt A'));
    setBadgeState(3, hasMapPts, AppState.mapPtB ? "A' & B' Set" : (hasMapPts ? "Pt A' Set" : "Pick Pt A'"));
    setBadgeState(4, isAligned, isAligned ? 'Overlay Active' : 'Waiting');
}
