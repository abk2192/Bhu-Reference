// ============================================================================
// STEP 1 LOGIC: PDF / IMAGE UPLOAD, PRINTED SCALE CONFIG & PROJECT JSON I/O
// ============================================================================

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function dataUrlToUint8Array(dataUrl) {
    const parts = dataUrl.split(',');
    const base64 = parts.length > 1 ? parts[1] : parts[0];
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

async function handleFileUpload(file) {
    if (!file) return;
    const name = file.name.toLowerCase();
    try {
        clearPdfPoints(false);
        clearMapPoints(false);

        const dataUrl = await readFileAsDataUrl(file);
        AppState.rawFileDataUrl = dataUrl;
        AppState.rawFileName = file.name;
        AppState.rawFileMime = file.type || (name.endsWith('.pdf') ? 'application/pdf' : 'image/png');

        if (name.endsWith('.pdf') || file.type === 'application/pdf') {
            showToast(`Loading High-Definition PDF: <b>${file.name}</b>...`, 'info');
            const bytes = dataUrlToUint8Array(dataUrl);
            AppState.pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
            AppState.totalPages = AppState.pdfDoc.numPages;
            AppState.currentPage = 1;

            const pageCtrl = document.getElementById('pdf-page-controls');
            if (AppState.totalPages > 1) {
                pageCtrl.classList.remove('hidden');
                pageCtrl.classList.add('flex');
            } else {
                pageCtrl.classList.add('hidden');
            }
            await renderPdfPage(1, true);
            document.getElementById('loaded-file-label').textContent = `PDF: ${file.name} (${AppState.sourceCanvas.width}×${AppState.sourceCanvas.height}px)`;
            saveSessionToIndexedDB();
            showToast('Ultra-HD PDF rendered! Opening Step 2 to mark Point A.', 'success');
            openStep(2);
        } else {
            await loadRasterImageFromDataUrl(dataUrl, file.name, true);
            saveSessionToIndexedDB();
            showToast('Map image loaded! Opening Step 2 to mark Point A.', 'success');
            openStep(2);
        }
    } catch (e) {
        showToast('Error reading file. Please select a valid PDF or image.', 'warn');
    }
}

function loadRasterImageFromDataUrl(dataUrl, fileName, resetPoints = true) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            AppState.pdfDoc = null;
            AppState.pdfPageProxy = null;
            document.getElementById('pdf-page-controls').classList.add('hidden');
            AppState.sourceCanvas.width = img.width;
            AppState.sourceCanvas.height = img.height;
            const ctx = AppState.sourceCanvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0);
            document.getElementById('loaded-file-label').textContent = `Image: ${fileName} (${img.width}×${img.height}px)`;
            if (resetPoints) {
                clearPdfPoints(false);
            } else {
                syncPdfPointsToCurrentCanvasSize();
            }
            if (window.cadastralOverlayLayer) window.cadastralOverlayLayer.refreshSourceBuffer();
            solveAndRenderGeoreference();
            updateStepBadges();
            resolve();
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

async function renderPdfPage(pageNum, resetPoints = true) {
    if (!AppState.pdfDoc) return;
    const page = await AppState.pdfDoc.getPage(pageNum);
    AppState.pdfPageProxy = page;

    const unscaledVp = page.getViewport({ scale: 1.0 });
    const maxLongestSide = Math.max(unscaledVp.width, unscaledVp.height);
    const requestedScale = parseFloat(document.getElementById('pdf-render-quality').value) || 4.0;
    const safeMaxScale = Math.min(requestedScale, 5600 / maxLongestSide);
    AppState.pdfRenderScale = Math.max(1.5, safeMaxScale);

    const viewport = page.getViewport({ scale: AppState.pdfRenderScale });
    const effectiveDpi = Math.round(72 * AppState.pdfRenderScale);
    AppState.pdfDpi = effectiveDpi;
    document.getElementById('pdf-dpi').value = effectiveDpi;

    AppState.sourceCanvas.width = Math.round(viewport.width);
    AppState.sourceCanvas.height = Math.round(viewport.height);
    const ctx = AppState.sourceCanvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, AppState.sourceCanvas.width, AppState.sourceCanvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    document.getElementById('pdf-page-indicator').textContent = `${pageNum}/${AppState.totalPages}`;
    document.getElementById('loaded-file-label').textContent = `PDF: ${AppState.rawFileName} (${AppState.sourceCanvas.width}×${AppState.sourceCanvas.height}px)`;

    if (resetPoints) {
        clearPdfPoints(false);
    } else {
        syncPdfPointsToCurrentCanvasSize();
    }

    fitPdfToViewport();
    if (window.cadastralOverlayLayer) window.cadastralOverlayLayer.refreshSourceBuffer();
    solveAndRenderGeoreference();
    updateStepBadges();
}

function generateBiharMauzaSampleCanvas() {
    const W = 1400;
    const H = 1050;
    const canvas = AppState.sourceCanvas;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#fdfaf2';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    for (let x = 80; x < W - 80; x += 100) {
        ctx.beginPath(); ctx.moveTo(x, 80); ctx.lineTo(x, H - 80); ctx.stroke();
    }
    for (let y = 80; y < H - 80; y += 100) {
        ctx.beginPath(); ctx.moveTo(80, y); ctx.lineTo(W - 80, y); ctx.stroke();
    }

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4;
    ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(50, 50, W - 100, H - 100);

    ctx.save();
    ctx.translate(1280, 120);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 16px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N ↑', 0, 0);
    ctx.restore();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 22px "Inter", serif';
    ctx.textAlign = 'center';
    ctx.fillText('BIHAR REVENUE SURVEY MAP — MAUZA DEMO (PHULWARI SHARIF, PATNA)', W / 2, 88);
    ctx.font = '600 14px "JetBrains Mono", monospace';
    ctx.fillStyle = '#334155';
    ctx.fillText('THANA NO: 34  |  SHEET NO: 02  |  SCALE: 16 INCHES = 1 MILE (1 : 3,960)', W / 2, 112);

    ctx.save();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(140, 760);
    ctx.lineTo(540, 560);
    ctx.lineTo(960, 410);
    ctx.lineTo(1240, 310);
    ctx.lineTo(1250, 342);
    ctx.lineTo(972, 442);
    ctx.lineTo(552, 592);
    ctx.lineTo(152, 792);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(540, 180);
    ctx.lineTo(540, 560);
    ctx.lineTo(552, 592);
    ctx.lineTo(552, 870);
    ctx.lineTo(525, 870);
    ctx.lineTo(525, 592);
    ctx.lineTo(515, 560);
    ctx.lineTo(515, 180);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const plots = [
        { pts: [[180,200], [350,200], [350,360], [180,360]], khesra: '101', label: 'Dhanhar' },
        { pts: [[350,200], [515,200], [515,360], [350,360]], khesra: '102', label: '' },
        { pts: [[180,360], [330,360], [330,510], [180,540]], khesra: '103', label: 'Bhit' },
        { pts: [[330,360], [515,360], [515,560], [330,510]], khesra: '104', label: 'Chauraha W' },
        { pts: [[180,540], [330,510], [330,665], [160,750]], khesra: '105', label: '' },
        { pts: [[330,510], [515,560], [330,665]], khesra: '106', label: '' },
        { pts: [[540,200], [740,200], [740,340], [540,360]], khesra: '107', label: '' },
        { pts: [[740,200], [960,200], [960,410], [740,340]], khesra: '108', label: 'Pokhar', isPond: true },
        { pts: [[960,200], [1180,200], [1240,310], [960,410]], khesra: '109', label: 'Tri-Simana E' },
        { pts: [[540,360], [740,340], [740,488], [540,560]], khesra: '110', label: 'Abadi' },
        { pts: [[740,340], [960,410], [740,488]], khesra: '111', label: '' },
        { pts: [[170,785], [360,690], [360,860], [170,860]], khesra: '201', label: '' },
        { pts: [[360,690], [525,606], [525,740], [360,760]], khesra: '202', label: 'Bagicha' },
        { pts: [[360,760], [525,740], [525,860], [360,860]], khesra: '203', label: '' },
        { pts: [[552,592], [770,512], [770,690], [552,700]], khesra: '204', label: 'School' },
        { pts: [[770,512], [972,442], [972,660], [770,690]], khesra: '205', label: '' },
        { pts: [[972,442], [1220,354], [1220,630], [972,660]], khesra: '206', label: 'Kharif' },
        { pts: [[552,700], [770,690], [770,860], [552,860]], khesra: '207', label: '' },
        { pts: [[770,690], [972,660], [972,860], [770,860]], khesra: '208', label: '' },
        { pts: [[972,660], [1220,354], [1220,860], [972,860]], khesra: '209', label: '' }
    ];

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#0f172a';
    plots.forEach(p => {
        ctx.beginPath();
        p.pts.forEach((pt, idx) => idx === 0 ? ctx.moveTo(pt[0], pt[1]) : ctx.lineTo(pt[0], pt[1]));
        ctx.closePath();
        if (p.isPond) {
            ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
            ctx.fill();
        }
        ctx.stroke();

        let cx = 0, cy = 0;
        p.pts.forEach(pt => { cx += pt[0]; cy += pt[1]; });
        cx /= p.pts.length; cy /= p.pts.length;

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 17px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(p.khesra, cx, cy);
        if (p.label) {
            ctx.fillStyle = '#334155';
            ctx.font = 'italic 12px "Inter", sans-serif';
            ctx.fillText(p.label, cx, cy + 18);
        }
    });

    const drawBM = (x, y, label) => {
        ctx.save();
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#991b1b';
        ctx.font = 'bold 12px "JetBrains Mono", monospace';
        ctx.fillText(label, x + 60, y - 12);
        ctx.restore();
    };
    drawBM(540, 560, 'Landmark A (Chauraha)');
    drawBM(960, 410, 'Landmark B (Mustakil)');
}

function loadBiharMauzaDemo(setSamplePoints = true) {
    clearPdfPoints(false);
    clearMapPoints(false);

    generateBiharMauzaSampleCanvas();
    AppState.pdfDoc = null;
    AppState.pdfPageProxy = null;
    AppState.rawFileDataUrl = null;
    AppState.rawFileName = 'Bihar_Mauza_Demo.png';
    AppState.printedScaleDenominator = 3960;
    AppState.pdfDpi = 150;
    AppState.solverMode = 'locked_scale';
    document.getElementById('solver-mode').value = 'locked_scale';
    document.getElementById('scale-preset').value = '3960';
    document.getElementById('scale-denominator').value = '3960';
    document.getElementById('pdf-dpi').value = '150';
    document.getElementById('loaded-file-label').textContent = 'Loaded: Bihar Mauza Demo (16"=1 Mile)';

    if (setSamplePoints) {
        const W = AppState.sourceCanvas.width;
        const H = AppState.sourceCanvas.height;
        AppState.pdfPtA = { u: 540, v: 560, uNorm: 540 / W, vNorm: 560 / H };
        document.getElementById('pdf-pt-a-status').textContent = 'A: (540, 560)';
        document.getElementById('pdf-pt-b-status').textContent = 'B: Optional';

        window.map.setView([25.6182, 85.0760], 17);
        placeMapPointA({ lat: 25.61780, lng: 85.07460 });
    }

    if (window.cadastralOverlayLayer) window.cadastralOverlayLayer.refreshSourceBuffer();
    solveAndRenderGeoreference();
    updateStepBadges();
}

function buildProjectBundleObject() {
    const embeddedDataUrl = AppState.rawFileDataUrl || (AppState.sourceCanvas.width ? AppState.sourceCanvas.toDataURL('image/png') : null);
    const W = AppState.sourceCanvas.width || 1;
    const H = AppState.sourceCanvas.height || 1;

    return {
        app: 'Bhu-Align Pro PWA',
        version: '3.0',
        savedAt: new Date().toISOString(),
        fileName: AppState.rawFileName || 'village_map.pdf',
        fileMime: AppState.rawFileMime || 'application/pdf',
        currentPage: AppState.currentPage || 1,
        pdfRenderScale: parseFloat(document.getElementById('pdf-render-quality').value) || AppState.pdfRenderScale,
        printedScaleDenominator: AppState.printedScaleDenominator,
        pdfDpi: AppState.pdfDpi,
        solverMode: AppState.solverMode,
        manualScaleMultiplier: AppState.manualScaleMultiplier,
        manualRotationOffsetDeg: AppState.manualRotationOffsetDeg,
        visuals: {
            overlayOpacity: AppState.overlayOpacity,
            blendMultiply: AppState.blendMultiply,
            inkBoost: AppState.inkBoost,
            crispVectorZoom: AppState.crispVectorZoom,
            invertColors: AppState.invertColors
        },
        controlPoints: {
            pdfA: AppState.pdfPtA ? {
                u: AppState.pdfPtA.u,
                v: AppState.pdfPtA.v,
                uNorm: typeof AppState.pdfPtA.uNorm === 'number' ? AppState.pdfPtA.uNorm : (AppState.pdfPtA.u / W),
                vNorm: typeof AppState.pdfPtA.vNorm === 'number' ? AppState.pdfPtA.vNorm : (AppState.pdfPtA.v / H)
            } : null,
            pdfB: AppState.pdfPtB ? {
                u: AppState.pdfPtB.u,
                v: AppState.pdfPtB.v,
                uNorm: typeof AppState.pdfPtB.uNorm === 'number' ? AppState.pdfPtB.uNorm : (AppState.pdfPtB.u / W),
                vNorm: typeof AppState.pdfPtB.vNorm === 'number' ? AppState.pdfPtB.vNorm : (AppState.pdfPtB.v / H)
            } : null,
            mapA: AppState.mapPtA ? { lat: AppState.mapPtA.lat, lng: AppState.mapPtA.lng } : null,
            mapB: AppState.mapPtB ? { lat: AppState.mapPtB.lat, lng: AppState.mapPtB.lng } : null
        },
        solutionSummary: AppState.solution,
        fileDataUrl: embeddedDataUrl
    };
}

function exportFullProjectJson() {
    try {
        showToast('Packaging PDF map & alignment points into portable JSON...', 'info');
        const bundle = buildProjectBundleObject();
        const jsonString = JSON.stringify(bundle, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const cleanBaseName = (AppState.rawFileName || 'bihar-village-map').replace(/\.[^/.]+$/, '');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${cleanBaseName}.bhualign.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        showToast('Exported full project <b>.bhualign.json</b> (includes embedded PDF & points)!', 'success');
    } catch (err) {
        showToast('Error exporting project JSON.', 'warn');
    }
}

async function importFullProjectJsonFile(file) {
    if (!file) return;
    try {
        showToast(`Importing saved project <b>${file.name}</b>...`, 'info');
        const text = await file.text();
        const bundle = JSON.parse(text);
        await restoreProjectFromBundleObject(bundle);
    } catch (err) {
        showToast('Invalid JSON project file. Please select a valid .bhualign.json export.', 'warn');
    }
}

async function restoreProjectFromBundleObject(bundle) {
    if (!bundle || !bundle.controlPoints) {
        showToast('JSON file is missing control points data.', 'warn');
        return;
    }

    clearPdfPoints(false);
    clearMapPoints(false);

    if (bundle.printedScaleDenominator) {
        AppState.printedScaleDenominator = parseFloat(bundle.printedScaleDenominator);
        document.getElementById('scale-denominator').value = AppState.printedScaleDenominator;
        const presetEl = document.getElementById('scale-preset');
        const matchOpt = Array.from(presetEl.options).some(o => o.value === String(AppState.printedScaleDenominator));
        presetEl.value = matchOpt ? String(AppState.printedScaleDenominator) : 'custom';
    }

    if (bundle.pdfRenderScale) {
        const qSelect = document.getElementById('pdf-render-quality');
        if ([2, 4, 6].includes(Math.round(bundle.pdfRenderScale))) {
            qSelect.value = String(Math.round(bundle.pdfRenderScale));
        }
    }

    if (bundle.solverMode) {
        AppState.solverMode = bundle.solverMode;
        document.getElementById('solver-mode').value = bundle.solverMode;
        document.getElementById('manual-tune-bar').classList.toggle('hidden', AppState.solverMode !== 'manual_nudge');
    }
    if (typeof bundle.manualScaleMultiplier === 'number') {
        AppState.manualScaleMultiplier = bundle.manualScaleMultiplier;
        document.getElementById('manual-scale-mult').value = (bundle.manualScaleMultiplier * 100).toFixed(1);
        document.getElementById('manual-scale-val').textContent = `${(bundle.manualScaleMultiplier * 100).toFixed(1)}%`;
    }
    if (typeof bundle.manualRotationOffsetDeg === 'number') {
        AppState.manualRotationOffsetDeg = bundle.manualRotationOffsetDeg;
        document.getElementById('manual-rot-offset').value = bundle.manualRotationOffsetDeg;
        document.getElementById('manual-rot-val').textContent = `${bundle.manualRotationOffsetDeg.toFixed(1)}°`;
    }

    if (bundle.visuals) {
        if (typeof bundle.visuals.overlayOpacity === 'number') {
            setQuickOpacity(Math.round(bundle.visuals.overlayOpacity * 100));
        }
        if (typeof bundle.visuals.blendMultiply === 'boolean') {
            AppState.blendMultiply = bundle.visuals.blendMultiply;
            const btnMult = document.getElementById('btn-blend-multiply');
            btnMult.className = AppState.blendMultiply
                ? 'px-2.5 py-1.5 rounded-lg bg-sky-600 text-white font-semibold transition shadow-sm'
                : 'px-2.5 py-1.5 rounded-lg theme-card border font-medium transition';
            btnMult.textContent = AppState.blendMultiply ? '✓ Clear White Paper Bg' : 'Clear White Paper Bg';
        }
        if (typeof bundle.visuals.inkBoost === 'boolean') {
            AppState.inkBoost = bundle.visuals.inkBoost;
            const btnInk = document.getElementById('btn-ink-boost');
            btnInk.className = AppState.inkBoost
                ? 'px-2.5 py-1.5 rounded-lg bg-sky-600 text-white font-semibold transition shadow-sm'
                : 'px-2.5 py-1.5 rounded-lg theme-card border font-medium transition';
            btnInk.textContent = AppState.inkBoost ? '✓ Bold Ink Boost' : 'Bold Ink Boost';
        }
    }

    if (bundle.fileDataUrl) {
        AppState.rawFileDataUrl = bundle.fileDataUrl;
        AppState.rawFileName = bundle.fileName || 'Restored_Map.pdf';
        AppState.rawFileMime = bundle.fileMime || 'application/pdf';
        const isPdf = AppState.rawFileMime === 'application/pdf' || AppState.rawFileName.toLowerCase().endsWith('.pdf') || bundle.fileDataUrl.startsWith('data:application/pdf');

        if (isPdf) {
            const bytes = dataUrlToUint8Array(bundle.fileDataUrl);
            AppState.pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
            AppState.totalPages = AppState.pdfDoc.numPages;
            AppState.currentPage = Math.min(bundle.currentPage || 1, AppState.totalPages);
            const pageCtrl = document.getElementById('pdf-page-controls');
            if (AppState.totalPages > 1) {
                pageCtrl.classList.remove('hidden');
                pageCtrl.classList.add('flex');
            } else {
                pageCtrl.classList.add('hidden');
            }
            await renderPdfPage(AppState.currentPage, false);
        } else {
            await loadRasterImageFromDataUrl(bundle.fileDataUrl, AppState.rawFileName, false);
        }
    }

    const W = AppState.sourceCanvas.width || 1;
    const H = AppState.sourceCanvas.height || 1;
    const cp = bundle.controlPoints;

    if (cp.pdfA) {
        const u = typeof cp.pdfA.uNorm === 'number' ? cp.pdfA.uNorm * W : cp.pdfA.u;
        const v = typeof cp.pdfA.vNorm === 'number' ? cp.pdfA.vNorm * H : cp.pdfA.v;
        AppState.pdfPtA = { u, v, uNorm: u / W, vNorm: v / H };
        document.getElementById('pdf-pt-a-status').textContent = `A: (${Math.round(u)}, ${Math.round(v)})`;
    }
    if (cp.pdfB) {
        const u = typeof cp.pdfB.uNorm === 'number' ? cp.pdfB.uNorm * W : cp.pdfB.u;
        const v = typeof cp.pdfB.vNorm === 'number' ? cp.pdfB.vNorm * H : cp.pdfB.v;
        AppState.pdfPtB = { u, v, uNorm: u / W, vNorm: v / H };
        document.getElementById('pdf-pt-b-status').textContent = `B: (${Math.round(u)}, ${Math.round(v)})`;
    }

    if (cp.mapA) placeMapPointA(cp.mapA);
    if (cp.mapB) placeMapPointB(cp.mapB);

    if (window.cadastralOverlayLayer) window.cadastralOverlayLayer.refreshSourceBuffer();
    renderPdfViewport();
    solveAndRenderGeoreference();
    updateStepBadges();
    saveSessionToIndexedDB();

    if (AppState.pdfPtA && AppState.mapPtA) {
        openStep(4);
        showToast(`Restored <b>${AppState.rawFileName}</b> & jumped straight to Step 4 Overlay!`, 'success');
    } else {
        openStep(2);
        showToast(`Restored <b>${AppState.rawFileName}</b>!`, 'success');
    }
}

function initStep1Events() {
    document.getElementById('file-upload').addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handleFileUpload(e.target.files[0]);
            e.target.value = '';
        }
    });

    ['header-import-json', 'step1-import-json', 'step4-import-json'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    importFullProjectJsonFile(e.target.files[0]);
                    e.target.value = '';
                }
            });
        }
    });

    document.getElementById('btn-restore-idb').addEventListener('click', async () => {
        const banner = document.getElementById('session-restore-banner');
        if (banner._savedData) {
            banner.classList.add('hidden');
            await restoreProjectFromBundleObject(banner._savedData);
        }
    });
    document.getElementById('btn-clear-idb').addEventListener('click', () => clearSavedSessionInIndexedDB(false));

    document.getElementById('pdf-render-quality').addEventListener('change', async () => {
        if (AppState.pdfDoc) {
            showToast('Re-rasterizing PDF at updated HD resolution...', 'info');
            await renderPdfPage(AppState.currentPage, false);
            saveSessionToIndexedDB();
            showToast(`Updated PDF clarity to ${AppState.sourceCanvas.width}×${AppState.sourceCanvas.height}px!`, 'success');
        }
    });

    document.getElementById('btn-load-demo').addEventListener('click', () => {
        loadBiharMauzaDemo(true);
        openStep(4);
        showToast('Loaded 1-Point Locked Scale Bihar Mauza Demo! Use the Opacity Slider in Step 4.', 'success');
    });

    const scalePreset = document.getElementById('scale-preset');
    const scaleDenom = document.getElementById('scale-denominator');
    scalePreset.addEventListener('change', (e) => {
        if (e.target.value !== 'custom') {
            scaleDenom.value = e.target.value;
            AppState.printedScaleDenominator = parseFloat(e.target.value);
            solveAndRenderGeoreference();
            updateStepBadges();
        }
    });
    scaleDenom.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        if (v > 0) {
            AppState.printedScaleDenominator = v;
            scalePreset.value = 'custom';
            solveAndRenderGeoreference();
            updateStepBadges();
        }
    });
    document.getElementById('pdf-dpi').addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        if (v > 10) {
            AppState.pdfDpi = v;
            solveAndRenderGeoreference();
        }
    });

    document.getElementById('btn-prev-page').addEventListener('click', () => {
        if (AppState.pdfDoc && AppState.currentPage > 1) renderPdfPage(--AppState.currentPage);
    });
    document.getElementById('btn-next-page').addEventListener('click', () => {
        if (AppState.pdfDoc && AppState.currentPage < AppState.totalPages) renderPdfPage(++AppState.currentPage);
    });
}
