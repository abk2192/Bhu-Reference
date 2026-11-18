// ============================================================================
// STEP 2 LOGIC: INTERACTIVE PDF CANVAS VIEWPORT, PAN/ZOOM & POINT A/B PICKER
// ============================================================================

let pdfViewportEl = null;
let pdfCanvasEl = null;
let pdfCtx = null;

function resizePdfViewport() {
    if (!pdfViewportEl || !pdfCanvasEl) return;
    const rect = pdfViewportEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        pdfCanvasEl.width = rect.width;
        pdfCanvasEl.height = rect.height;
        renderPdfViewport();
    }
}

function fitPdfToViewport() {
    if (!pdfViewportEl) return;
    const rect = pdfViewportEl.getBoundingClientRect();
    if (!AppState.sourceCanvas.width || !rect.width) return;
    const scaleX = (rect.width - 30) / AppState.sourceCanvas.width;
    const scaleY = (rect.height - 30) / AppState.sourceCanvas.height;
    AppState.pdfCam.zoom = Math.min(scaleX, scaleY, 1.5);
    AppState.pdfCam.x = (rect.width - AppState.sourceCanvas.width * AppState.pdfCam.zoom) / 2;
    AppState.pdfCam.y = (rect.height - AppState.sourceCanvas.height * AppState.pdfCam.zoom) / 2;
    document.getElementById('pdf-zoom-readout').textContent = `${Math.round(AppState.pdfCam.zoom * 100)}%`;
    renderPdfViewport();
}

function screenToPdfCoords(clientX, clientY) {
    const rect = pdfCanvasEl.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
        u: (sx - AppState.pdfCam.x) / AppState.pdfCam.zoom,
        v: (sy - AppState.pdfCam.y) / AppState.pdfCam.zoom
    };
}

function renderPdfViewport() {
    if (!pdfCanvasEl || !pdfCtx) return;
    const W = pdfCanvasEl.width;
    const H = pdfCanvasEl.height;
    if (!W || !H) return;
    pdfCtx.clearRect(0, 0, W, H);

    if (!AppState.sourceCanvas.width) {
        pdfCtx.save();
        pdfCtx.fillStyle = '#64748b';
        pdfCtx.font = '600 14px "Inter", sans-serif';
        pdfCtx.textAlign = 'center';
        pdfCtx.fillText('Upload a Revenue PDF or Image in Step 1 (or click Demo) to view and mark Point A.', W / 2, H / 2);
        pdfCtx.restore();
        return;
    }

    pdfCtx.save();
    pdfCtx.translate(AppState.pdfCam.x, AppState.pdfCam.y);
    pdfCtx.scale(AppState.pdfCam.zoom, AppState.pdfCam.zoom);

    pdfCtx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    pdfCtx.shadowBlur = 16 / AppState.pdfCam.zoom;
    pdfCtx.drawImage(AppState.sourceCanvas, 0, 0);
    pdfCtx.shadowBlur = 0;

    if (AppState.pdfPtA && AppState.pdfPtB) {
        pdfCtx.strokeStyle = '#d97706';
        pdfCtx.lineWidth = 3 / AppState.pdfCam.zoom;
        pdfCtx.setLineDash([8 / AppState.pdfCam.zoom, 5 / AppState.pdfCam.zoom]);
        pdfCtx.beginPath();
        pdfCtx.moveTo(AppState.pdfPtA.u, AppState.pdfPtA.v);
        pdfCtx.lineTo(AppState.pdfPtB.u, AppState.pdfPtB.v);
        pdfCtx.stroke();
    }
    pdfCtx.restore();

    if (AppState.pdfPtA) {
        const sx = AppState.pdfCam.x + AppState.pdfPtA.u * AppState.pdfCam.zoom;
        const sy = AppState.pdfCam.y + AppState.pdfPtA.v * AppState.pdfCam.zoom;
        drawScreenPin(pdfCtx, sx, sy, 'A', '#dc2626');
    }
    if (AppState.pdfPtB) {
        const sx = AppState.pdfCam.x + AppState.pdfPtB.u * AppState.pdfCam.zoom;
        const sy = AppState.pdfCam.y + AppState.pdfPtB.v * AppState.pdfCam.zoom;
        drawScreenPin(pdfCtx, sx, sy, 'B', '#2563eb');
    }
}

function drawScreenPin(ctx, x, y, label, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 18, y); ctx.lineTo(x + 18, y);
    ctx.moveTo(x, y - 18); ctx.lineTo(x, y + 18);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x + 8, y - 28, 26, 20, 5);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 21, y - 18);
    ctx.restore();
}

function recordPdfPoint(u, v) {
    if (!AppState.sourceCanvas.width) {
        showToast('Please upload a PDF or image in Step 1 first.', 'warn');
        return;
    }
    const W = AppState.sourceCanvas.width || 1;
    const H = AppState.sourceCanvas.height || 1;
    const clampedU = Math.max(0, Math.min(W, u));
    const clampedV = Math.max(0, Math.min(H, v));

    if (AppState.pdfTool === 'pickA') {
        AppState.pdfPtA = { u: clampedU, v: clampedV, uNorm: clampedU / W, vNorm: clampedV / H };
        document.getElementById('pdf-pt-a-status').textContent = `A: (${Math.round(clampedU)}, ${Math.round(clampedV)})`;
        showToast('Point <b>A</b> set on PDF! You can proceed directly to Step 3 (or optionally tap Point B).', 'success');
    } else {
        AppState.pdfPtB = { u: clampedU, v: clampedV, uNorm: clampedU / W, vNorm: clampedV / H };
        document.getElementById('pdf-pt-b-status').textContent = `B: (${Math.round(clampedU)}, ${Math.round(clampedV)})`;
        showToast('PDF Points <b>A & B</b> set! Tap "Continue to Step 3".', 'success');
    }
    renderPdfViewport();
    solveAndRenderGeoreference();
    updateStepBadges();
    saveSessionToIndexedDB();
}

function syncPdfPointsToCurrentCanvasSize() {
    const W = AppState.sourceCanvas.width;
    const H = AppState.sourceCanvas.height;
    if (!W || !H) return;
    if (AppState.pdfPtA && typeof AppState.pdfPtA.uNorm === 'number') {
        AppState.pdfPtA.u = AppState.pdfPtA.uNorm * W;
        AppState.pdfPtA.v = AppState.pdfPtA.vNorm * H;
        document.getElementById('pdf-pt-a-status').textContent = `A: (${Math.round(AppState.pdfPtA.u)}, ${Math.round(AppState.pdfPtA.v)})`;
    }
    if (AppState.pdfPtB && typeof AppState.pdfPtB.uNorm === 'number') {
        AppState.pdfPtB.u = AppState.pdfPtB.uNorm * W;
        AppState.pdfPtB.v = AppState.pdfPtB.vNorm * H;
        document.getElementById('pdf-pt-b-status').textContent = `B: (${Math.round(AppState.pdfPtB.u)}, ${Math.round(AppState.pdfPtB.v)})`;
    }
}

function clearPdfPointB(notify = true) {
    AppState.pdfPtB = null;
    document.getElementById('pdf-pt-b-status').textContent = 'B: Optional';
    renderPdfViewport();
    solveAndRenderGeoreference();
    updateStepBadges();
    saveSessionToIndexedDB();
    if (notify) showToast('Cleared optional Point <b>B</b> on PDF.', 'info');
}

function clearPdfPoints(notify = true) {
    AppState.pdfPtA = null;
    AppState.pdfPtB = null;
    document.getElementById('pdf-pt-a-status').textContent = 'A: Not Set';
    document.getElementById('pdf-pt-b-status').textContent = 'B: Optional';
    setPdfTool('pickA');
    renderPdfViewport();
    solveAndRenderGeoreference();
    updateStepBadges();
    saveSessionToIndexedDB();
    if (notify) showToast('Reset PDF Points <b>A & B</b>. Tap on the PDF to mark Point A.', 'info');
}

function setPdfTool(tool) {
    AppState.pdfTool = tool;
    const bA = document.getElementById('btn-pick-pdf-a');
    const bB = document.getElementById('btn-pick-pdf-b');
    const bP = document.getElementById('btn-pdf-pan');

    bA.className = tool === 'pickA'
        ? 'px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-red-600 text-white shadow-sm transition'
        : 'px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 theme-card border transition';
    bB.className = tool === 'pickB'
        ? 'px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-blue-600 text-white shadow-sm transition'
        : 'px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 theme-card border transition';
    bP.className = tool === 'pan'
        ? 'px-2.5 py-1.5 rounded-lg text-xs font-bold bg-sky-600 text-white shadow-sm transition'
        : 'px-2.5 py-1.5 rounded-lg text-xs font-semibold theme-card border transition';
}

function initStep2Events() {
    pdfViewportEl = document.getElementById('pdf-viewport');
    pdfCanvasEl = document.getElementById('pdf-interactive-canvas');
    pdfCtx = pdfCanvasEl.getContext('2d');

    let pointerStart = { x: 0, y: 0 };

    pdfViewportEl.addEventListener('pointerdown', (e) => {
        pdfViewportEl.setPointerCapture(e.pointerId);
        pointerStart = { x: e.clientX, y: e.clientY };
        AppState.pdfCam.isDragging = true;
        AppState.pdfCam.dragStartX = e.clientX - AppState.pdfCam.x;
        AppState.pdfCam.dragStartY = e.clientY - AppState.pdfCam.y;
    });

    pdfViewportEl.addEventListener('pointermove', (e) => {
        if (!AppState.pdfCam.isDragging) return;
        AppState.pdfCam.x = e.clientX - AppState.pdfCam.dragStartX;
        AppState.pdfCam.y = e.clientY - AppState.pdfCam.dragStartY;
        renderPdfViewport();
    });

    pdfViewportEl.addEventListener('pointerup', (e) => {
        if (!AppState.pdfCam.isDragging) return;
        AppState.pdfCam.isDragging = false;
        const moved = Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y);
        if (moved < 6 && AppState.pdfTool !== 'pan') {
            const pt = screenToPdfCoords(e.clientX, e.clientY);
            recordPdfPoint(pt.u, pt.v);
        }
    });

    pdfViewportEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 0.87;
        const newZoom = Math.min(Math.max(AppState.pdfCam.zoom * factor, 0.12), 6.0);
        const rect = pdfCanvasEl.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        AppState.pdfCam.x = mx - (mx - AppState.pdfCam.x) * (newZoom / AppState.pdfCam.zoom);
        AppState.pdfCam.y = my - (my - AppState.pdfCam.y) * (newZoom / AppState.pdfCam.zoom);
        AppState.pdfCam.zoom = newZoom;
        document.getElementById('pdf-zoom-readout').textContent = `${Math.round(newZoom * 100)}%`;
        renderPdfViewport();
    }, { passive: false });

    document.getElementById('btn-pick-pdf-a').addEventListener('click', () => setPdfTool('pickA'));
    document.getElementById('btn-pick-pdf-b').addEventListener('click', () => setPdfTool('pickB'));
    document.getElementById('btn-pdf-pan').addEventListener('click', () => setPdfTool('pan'));

    document.getElementById('btn-clear-pdf-b').addEventListener('click', () => clearPdfPointB(true));
    document.getElementById('btn-clear-pdf-pts').addEventListener('click', () => clearPdfPoints(true));

    document.getElementById('btn-drop-pdf-crosshair').addEventListener('click', () => {
        const rect = pdfCanvasEl.getBoundingClientRect();
        const centerPt = screenToPdfCoords(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (AppState.pdfTool === 'pan') setPdfTool('pickA');
        recordPdfPoint(centerPt.u, centerPt.v);
    });

    document.getElementById('btn-pdf-zoom-in').addEventListener('click', () => {
        AppState.pdfCam.zoom = Math.min(AppState.pdfCam.zoom * 1.25, 6.0);
        document.getElementById('pdf-zoom-readout').textContent = `${Math.round(AppState.pdfCam.zoom * 100)}%`;
        renderPdfViewport();
    });
    document.getElementById('btn-pdf-zoom-out').addEventListener('click', () => {
        AppState.pdfCam.zoom = Math.max(AppState.pdfCam.zoom * 0.8, 0.12);
        document.getElementById('pdf-zoom-readout').textContent = `${Math.round(AppState.pdfCam.zoom * 100)}%`;
        renderPdfViewport();
    });
    document.getElementById('btn-pdf-fit').addEventListener('click', fitPdfToViewport);
}
