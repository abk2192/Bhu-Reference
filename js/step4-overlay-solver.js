// ============================================================================
// STEP 4 LOGIC: CADASTRAL OVERLAY LAYER, LIVE VECTOR PATCH & GEODETIC SOLVER
// ============================================================================

function applyCadastralImageFilters(ctx, width, height) {
    if (!AppState.blendMultiply && !AppState.invertColors && !AppState.inkBoost) return;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i + 1], b = data[i + 2];
        let luma = 0.299 * r + 0.587 * g + 0.114 * b;

        if (AppState.inkBoost && luma < 242) {
            const darkened = Math.max(0, (luma - 90) * 0.35);
            const ratio = luma > 1 ? (darkened / luma) : 0;
            r = Math.round(r * ratio);
            g = Math.round(g * ratio);
            b = Math.round(b * ratio);
            luma = darkened;
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
        }

        if (AppState.blendMultiply) {
            if (luma > 245) {
                data[i + 3] = 0;
            } else if (luma > 225) {
                data[i + 3] = Math.min(data[i + 3], Math.round(((245 - luma) / 20) * 255));
            } else {
                data[i + 3] = 255;
            }
        }

        if (AppState.invertColors && data[i + 3] > 15) {
            data[i] = Math.min(255, 255 - r);
            data[i + 1] = Math.min(255, (255 - g) + 35);
            data[i + 2] = Math.min(255, (255 - b) + 50);
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

window.CadastralOverlayLayer = L.Layer.extend({
    onAdd: function (leafletMap) {
        this._map = leafletMap;
        this._container = L.DomUtil.create('div', 'leaflet-layer leaflet-zoom-hide');
        this._container.style.position = 'absolute';
        this._container.style.pointerEvents = 'none';
        this._container.style.zIndex = '450';

        this._canvas = document.createElement('canvas');
        this._canvas.style.position = 'absolute';
        this._canvas.style.left = '0px';
        this._canvas.style.top = '0px';
        this._canvas.style.transformOrigin = '0 0';
        this._canvas.style.pointerEvents = 'none';
        this._container.appendChild(this._canvas);

        this._vectorCanvas = document.createElement('canvas');
        this._vectorCanvas.style.position = 'absolute';
        this._vectorCanvas.style.left = '0px';
        this._vectorCanvas.style.top = '0px';
        this._vectorCanvas.style.transformOrigin = '0 0';
        this._vectorCanvas.style.pointerEvents = 'none';
        this._vectorCanvas.style.display = 'none';
        this._container.appendChild(this._vectorCanvas);

        this._bufferRatio = 1.0;
        this._vectorRenderTimer = null;
        this._activeRenderTask = null;

        leafletMap.getPanes().overlayPane.appendChild(this._container);
        leafletMap.on('zoom viewreset move', this._updateTransform, this);
        leafletMap.on('moveend zoomend', this._scheduleVectorPatchRender, this);

        this.refreshSourceBuffer();
        this._updateTransform();
    },

    onRemove: function (leafletMap) {
        L.DomUtil.remove(this._container);
        leafletMap.off('zoom viewreset move', this._updateTransform, this);
        leafletMap.off('moveend zoomend', this._scheduleVectorPatchRender, this);
    },

    refreshSourceBuffer: function () {
        if (!this._canvas || !AppState.sourceCanvas.width) return;

        const srcW = AppState.sourceCanvas.width;
        const srcH = AppState.sourceCanvas.height;
        const maxGpuSide = 3072;
        this._bufferRatio = Math.min(1.0, maxGpuSide / Math.max(srcW, srcH));

        this._canvas.width = Math.round(srcW * this._bufferRatio);
        this._canvas.height = Math.round(srcH * this._bufferRatio);

        const ctx = this._canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        ctx.drawImage(AppState.sourceCanvas, 0, 0, this._canvas.width, this._canvas.height);

        applyCadastralImageFilters(ctx, this._canvas.width, this._canvas.height);

        this._updateFilters();
        this._updateTransform();
        this._scheduleVectorPatchRender();
    },

    _updateFilters: function () {
        if (!this._canvas) return;
        const op = AppState.activeStep === 3
            ? Math.min(AppState.overlayOpacity, 0.45)
            : AppState.overlayOpacity;
        this._canvas.style.opacity = op;
        if (this._vectorCanvas) {
            this._vectorCanvas.style.opacity = op;
        }
    },

    _updateTransform: function () {
        if (!this._map || !this._canvas) return;
        const sol = AppState.solution;
        if (!sol.valid || !AppState.pdfPtA || !AppState.mapPtA) {
            this._canvas.style.display = 'none';
            if (this._vectorCanvas) this._vectorCanvas.style.display = 'none';
            return;
        }

        const ratio = this._bufferRatio || 1.0;
        const anchorLayerPt = this._map.latLngToLayerPoint(AppState.mapPtA);
        const latRad = AppState.mapPtA.lat * Math.PI / 180;
        const zoom = this._map.getZoom();
        const mapMetersPerScreenPixel = (156543.03392804097 * Math.cos(latRad)) / Math.pow(2, zoom);
        const cssScale = sol.metersPerPixel / mapMetersPerScreenPixel;
        const effectiveScale = cssScale / ratio;

        this._canvas.style.display = 'block';
        this._canvas.style.transform =
            `translate3d(${anchorLayerPt.x}px, ${anchorLayerPt.y}px, 0px) ` +
            `rotate(${sol.rotationRad}rad) ` +
            `scale(${effectiveScale}) ` +
            `translate3d(${-AppState.pdfPtA.u * ratio}px, ${-AppState.pdfPtA.v * ratio}px, 0px)`;

        if (this._vectorPatchMeta && this._vectorCanvas.style.display === 'block') {
            const meta = this._vectorPatchMeta;
            const patchScale = cssScale * (AppState.pdfRenderScale / meta.renderScale);
            this._vectorCanvas.style.transform =
                `translate3d(${anchorLayerPt.x}px, ${anchorLayerPt.y}px, 0px) ` +
                `rotate(${sol.rotationRad}rad) ` +
                `scale(${patchScale}) ` +
                `translate3d(${-AppState.pdfPtA.u * (meta.renderScale / AppState.pdfRenderScale) + meta.offsetX}px, ${-AppState.pdfPtA.v * (meta.renderScale / AppState.pdfRenderScale) + meta.offsetY}px, 0px)`;
        }
    },

    _scheduleVectorPatchRender: function () {
        if (this._vectorRenderTimer) clearTimeout(this._vectorRenderTimer);
        const badge = document.getElementById('vector-zoom-badge');

        if (!AppState.crispVectorZoom || !AppState.pdfPageProxy || !AppState.solution.valid) {
            if (this._vectorCanvas) this._vectorCanvas.style.display = 'none';
            if (badge) badge.classList.add('hidden');
            return;
        }

        this._vectorRenderTimer = setTimeout(() => {
            this._renderViewportVectorPatch();
        }, 180);
    },

    _renderViewportVectorPatch: async function () {
        if (!this._map || !AppState.pdfPageProxy || !AppState.solution.valid || !AppState.pdfPtA || !AppState.mapPtA) return;
        const badge = document.getElementById('vector-zoom-badge');

        const sol = AppState.solution;
        const latRad = AppState.mapPtA.lat * Math.PI / 180;
        const zoom = this._map.getZoom();
        const mapMetersPerScreenPixel = (156543.03392804097 * Math.cos(latRad)) / Math.pow(2, zoom);

        const cssScale = sol.metersPerPixel / mapMetersPerScreenPixel;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const desiredPdfScale = Math.min(AppState.pdfRenderScale * cssScale * dpr, 28.0);

        if (desiredPdfScale <= AppState.pdfRenderScale * 1.15) {
            this._vectorCanvas.style.display = 'none';
            if (badge) badge.classList.add('hidden');
            return;
        }

        try {
            if (this._activeRenderTask) {
                this._activeRenderTask.cancel();
                this._activeRenderTask = null;
            }

            const mapSize = this._map.getSize();
            const anchorContainerPt = this._map.latLngToContainerPoint(AppState.mapPtA);
            const cosR = Math.cos(-sol.rotationRad);
            const sinR = Math.sin(-sol.rotationRad);
            const scaleRatio = desiredPdfScale / AppState.pdfRenderScale;

            const screenCorners = [
                { x: -mapSize.x * 0.15, y: -mapSize.y * 0.15 },
                { x: mapSize.x * 1.15, y: -mapSize.y * 0.15 },
                { x: mapSize.x * 1.15, y: mapSize.y * 1.15 },
                { x: -mapSize.x * 0.15, y: mapSize.y * 1.15 }
            ];

            let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
            screenCorners.forEach(sc => {
                const dx = sc.x - anchorContainerPt.x;
                const dy = sc.y - anchorContainerPt.y;
                const rotX = (dx * cosR - dy * sinR) / cssScale;
                const rotY = (dx * sinR + dy * cosR) / cssScale;
                const uTarget = (rotX + AppState.pdfPtA.u) * scaleRatio;
                const vTarget = (rotY + AppState.pdfPtA.v) * scaleRatio;
                if (uTarget < minU) minU = uTarget;
                if (vTarget < minV) minV = vTarget;
                if (uTarget > maxU) maxU = uTarget;
                if (vTarget > maxV) maxV = vTarget;
            });

            const fullViewport = AppState.pdfPageProxy.getViewport({ scale: desiredPdfScale });
            const clipX = Math.max(0, Math.floor(minU));
            const clipY = Math.max(0, Math.floor(minV));
            const clipRight = Math.min(Math.ceil(fullViewport.width), Math.ceil(maxU));
            const clipBottom = Math.min(Math.ceil(fullViewport.height), Math.ceil(maxV));
            const clipW = clipRight - clipX;
            const clipH = clipBottom - clipY;

            if (clipW <= 20 || clipH <= 20) {
                this._vectorCanvas.style.display = 'none';
                return;
            }

            const maxPatchSide = 2600;
            let finalScale = desiredPdfScale;
            let finalClipX = clipX, finalClipY = clipY, finalClipW = clipW, finalClipH = clipH;
            if (clipW > maxPatchSide || clipH > maxPatchSide) {
                const shrink = maxPatchSide / Math.max(clipW, clipH);
                finalScale = desiredPdfScale * shrink;
                finalClipX = Math.floor(clipX * shrink);
                finalClipY = Math.floor(clipY * shrink);
                finalClipW = Math.floor(clipW * shrink);
                finalClipH = Math.floor(clipH * shrink);
            }

            const patchViewport = AppState.pdfPageProxy.getViewport({
                scale: finalScale,
                offsetX: -finalClipX,
                offsetY: -finalClipY
            });

            const offCanvas = document.createElement('canvas');
            offCanvas.width = finalClipW;
            offCanvas.height = finalClipH;
            const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

            this._activeRenderTask = AppState.pdfPageProxy.render({
                canvasContext: offCtx,
                viewport: patchViewport
            });
            await this._activeRenderTask.promise;
            this._activeRenderTask = null;

            applyCadastralImageFilters(offCtx, finalClipW, finalClipH);

            this._vectorCanvas.width = finalClipW;
            this._vectorCanvas.height = finalClipH;
            const vCtx = this._vectorCanvas.getContext('2d');
            vCtx.clearRect(0, 0, finalClipW, finalClipH);
            vCtx.drawImage(offCanvas, 0, 0);

            this._vectorPatchMeta = {
                renderScale: finalScale,
                offsetX: finalClipX,
                offsetY: finalClipY
            };
            this._vectorCanvas.style.display = 'block';
            this._updateFilters();
            this._updateTransform();

            if (badge) {
                badge.textContent = `⚡ Vector Crisp (${finalScale.toFixed(1)}x)`;
                badge.classList.remove('hidden');
            }
        } catch (err) {}
    }
});

function solveAndRenderGeoreference() {
    const sol = AppState.solution;

    if (!AppState.pdfPtA || !AppState.mapPtA) {
        sol.valid = false;
        if (window.cadastralOverlayLayer) window.cadastralOverlayLayer._updateTransform();
        return;
    }

    const effectiveDpi = AppState.pdfDoc ? (72 * AppState.pdfRenderScale) : AppState.pdfDpi;
    const printedMetersPerPixel = (0.0254 * AppState.printedScaleDenominator) / effectiveDpi;

    let activeMetersPerPixel = printedMetersPerPixel;
    let activeRotationRad = 0;
    let pdfDistPx = 0;
    let groundDistMeters = 0;
    let impliedScaleDenominator = AppState.printedScaleDenominator;
    let scaleDriftPercent = 0;

    const hasSecondPoint = Boolean(AppState.pdfPtB && AppState.mapPtB);
    if (hasSecondPoint) {
        const du = AppState.pdfPtB.u - AppState.pdfPtA.u;
        const dv = AppState.pdfPtB.v - AppState.pdfPtA.v;
        pdfDistPx = Math.hypot(du, dv);

        if (pdfDistPx > 1e-3) {
            const anglePdfRad = Math.atan2(dv, du);
            groundDistMeters = window.map.distance(AppState.mapPtA, AppState.mapPtB);

            const pA = window.map.project(AppState.mapPtA, 18);
            const pB = window.map.project(AppState.mapPtB, 18);
            const angleMapRad = Math.atan2(pB.y - pA.y, pB.x - pA.x);

            const twoPointMetersPerPixel = groundDistMeters / pdfDistPx;
            impliedScaleDenominator = (twoPointMetersPerPixel * effectiveDpi) / 0.0254;
            scaleDriftPercent = ((impliedScaleDenominator - AppState.printedScaleDenominator) / AppState.printedScaleDenominator) * 100;

            if (AppState.solverMode === 'helmert2p') {
                activeMetersPerPixel = twoPointMetersPerPixel;
                activeRotationRad = angleMapRad - anglePdfRad;
            } else if (AppState.solverMode === 'locked_scale_rot') {
                activeMetersPerPixel = printedMetersPerPixel;
                activeRotationRad = angleMapRad - anglePdfRad;
            } else {
                activeMetersPerPixel = printedMetersPerPixel;
                activeRotationRad = 0;
            }
        }
    }

    if (AppState.solverMode === 'manual_nudge') {
        activeMetersPerPixel = printedMetersPerPixel * AppState.manualScaleMultiplier;
        activeRotationRad += (AppState.manualRotationOffsetDeg * Math.PI / 180);
    }

    let rotDeg = (activeRotationRad * 180 / Math.PI) % 360;
    if (rotDeg > 180) rotDeg -= 360;
    if (rotDeg < -180) rotDeg += 360;

    sol.valid = true;
    sol.metersPerPixel = activeMetersPerPixel;
    sol.rotationRad = activeRotationRad;
    sol.rotationDeg = rotDeg;
    sol.pdfDistPx = pdfDistPx;
    sol.groundDistMeters = groundDistMeters;
    sol.impliedScaleDenominator = impliedScaleDenominator;
    sol.scaleDriftPercent = scaleDriftPercent;

    if (window.cadastralOverlayLayer) {
        window.cadastralOverlayLayer._updateFilters();
        window.cadastralOverlayLayer._updateTransform();
        window.cadastralOverlayLayer._scheduleVectorPatchRender();
    }

    if (AppState.solverMode === 'locked_scale') {
        document.getElementById('diag-ground-dist').textContent = '1-Pt Locked';
        document.getElementById('diag-ground-karis').textContent = '(North-Up)';
        document.getElementById('diag-scale-drift').textContent = 'Exact 1:X Scale';
    } else if (hasSecondPoint && groundDistMeters > 0) {
        document.getElementById('diag-ground-dist').textContent = `${groundDistMeters.toFixed(1)} m`;
        const jaribs = groundDistMeters / 20.1168;
        document.getElementById('diag-ground-karis').textContent = `(${jaribs.toFixed(2)} Jarib)`;
        document.getElementById('diag-scale-drift').textContent = `${scaleDriftPercent >= 0 ? '+' : ''}${scaleDriftPercent.toFixed(1)}% drift`;
    }
    document.getElementById('diag-rotation').textContent = `${rotDeg >= 0 ? '+' : ''}${rotDeg.toFixed(1)}°`;
    document.getElementById('diag-implied-scale').textContent = `1 : ${Math.round((activeMetersPerPixel * effectiveDpi) / 0.0254).toLocaleString()}`;
}

function setQuickOpacity(pct) {
    AppState.overlayOpacity = pct / 100;
    document.getElementById('opacity-slider').value = pct;
    document.getElementById('fullscreen-opacity-slider').value = pct;
    document.getElementById('opacity-readout').textContent = `${pct}%`;
    document.getElementById('fullscreen-opacity-val').textContent = `${pct}%`;
    if (window.cadastralOverlayLayer) window.cadastralOverlayLayer._updateFilters();
}

function initStep4Events() {
    document.getElementById('opacity-slider').addEventListener('input', (e) => setQuickOpacity(parseInt(e.target.value, 10)));
    document.getElementById('fullscreen-opacity-slider').addEventListener('input', (e) => setQuickOpacity(parseInt(e.target.value, 10)));

    const btnMult = document.getElementById('btn-blend-multiply');
    btnMult.addEventListener('click', () => {
        AppState.blendMultiply = !AppState.blendMultiply;
        btnMult.className = AppState.blendMultiply
            ? 'px-2.5 py-1.5 rounded-lg bg-sky-600 text-white font-semibold transition shadow-sm'
            : 'px-2.5 py-1.5 rounded-lg theme-card border font-medium transition';
        btnMult.textContent = AppState.blendMultiply ? '✓ Clear White Paper Bg' : 'Clear White Paper Bg';
        if (window.cadastralOverlayLayer) window.cadastralOverlayLayer.refreshSourceBuffer();
        saveSessionToIndexedDB();
    });

    const btnInk = document.getElementById('btn-ink-boost');
    btnInk.addEventListener('click', () => {
        AppState.inkBoost = !AppState.inkBoost;
        btnInk.className = AppState.inkBoost
            ? 'px-2.5 py-1.5 rounded-lg bg-sky-600 text-white font-semibold transition shadow-sm'
            : 'px-2.5 py-1.5 rounded-lg theme-card border font-medium transition';
        btnInk.textContent = AppState.inkBoost ? '✓ Bold Ink Boost' : 'Bold Ink Boost';
        if (window.cadastralOverlayLayer) window.cadastralOverlayLayer.refreshSourceBuffer();
        saveSessionToIndexedDB();
    });

    const btnCrisp = document.getElementById('btn-crisp-vector');
    btnCrisp.addEventListener('click', () => {
        AppState.crispVectorZoom = !AppState.crispVectorZoom;
        btnCrisp.className = AppState.crispVectorZoom
            ? 'px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold transition shadow-sm'
            : 'px-2.5 py-1.5 rounded-lg theme-card border font-medium transition';
        btnCrisp.textContent = AppState.crispVectorZoom ? '⚡ Live Vector Zoom: ON' : '⚡ Live Vector Zoom: OFF';
        if (window.cadastralOverlayLayer) window.cadastralOverlayLayer._scheduleVectorPatchRender();
    });

    const btnInv = document.getElementById('btn-invert-colors');
    btnInv.addEventListener('click', () => {
        AppState.invertColors = !AppState.invertColors;
        btnInv.className = AppState.invertColors
            ? 'px-2.5 py-1.5 rounded-lg bg-sky-600 text-white font-semibold transition shadow-sm'
            : 'px-2.5 py-1.5 rounded-lg theme-card border font-medium transition';
        if (window.cadastralOverlayLayer) window.cadastralOverlayLayer.refreshSourceBuffer();
        saveSessionToIndexedDB();
    });

    const btnPins = document.getElementById('btn-toggle-pins');
    btnPins.addEventListener('click', () => {
        AppState.showMapPins = !AppState.showMapPins;
        const opacity = AppState.showMapPins ? 1 : 0;
        if (window.markerMapA) window.markerMapA.setOpacity(opacity);
        if (window.markerMapB) window.markerMapB.setOpacity(opacity);
        if (window.vectorLineMap) window.vectorLineMap.setStyle({ opacity });
        btnPins.textContent = AppState.showMapPins ? "Hide Pins A'/B'" : "Show Pins A'/B'";
    });

    document.getElementById('solver-mode').addEventListener('change', (e) => {
        AppState.solverMode = e.target.value;
        document.getElementById('manual-tune-bar').classList.toggle('hidden', AppState.solverMode !== 'manual_nudge');
        solveAndRenderGeoreference();
    });

    document.getElementById('manual-scale-mult').addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        AppState.manualScaleMultiplier = v / 100;
        document.getElementById('manual-scale-val').textContent = `${v.toFixed(1)}%`;
        solveAndRenderGeoreference();
    });

    document.getElementById('manual-rot-offset').addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        AppState.manualRotationOffsetDeg = v;
        document.getElementById('manual-rot-val').textContent = `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`;
        solveAndRenderGeoreference();
    });

    document.getElementById('btn-reset-manual').addEventListener('click', () => {
        AppState.manualScaleMultiplier = 1.0;
        AppState.manualRotationOffsetDeg = 0.0;
        document.getElementById('manual-scale-mult').value = 100;
        document.getElementById('manual-rot-offset').value = 0;
        document.getElementById('manual-scale-val').textContent = '100.0%';
        document.getElementById('manual-rot-val').textContent = '0.0°';
        solveAndRenderGeoreference();
    });

    document.getElementById('base-layer-select').addEventListener('change', (e) => {
        Object.values(window.baseLayers).forEach(l => window.map.removeLayer(l));
        if (window.baseLayers[e.target.value]) window.baseLayers[e.target.value].addTo(window.map);
    });

    document.getElementById('btn-fullscreen-map').addEventListener('click', () => {
        AppState.isFullScreen = !AppState.isFullScreen;
        const wrap = document.getElementById('shared-map-wrapper');
        const hud = document.getElementById('fullscreen-hud');
        const lbl = document.getElementById('fullscreen-label');

        if (AppState.isFullScreen) {
            wrap.classList.add('fullscreen-map-active');
            hud.classList.remove('hidden');
            lbl.textContent = 'Exit Full';
        } else {
            wrap.classList.remove('fullscreen-map-active');
            hud.classList.add('hidden');
            lbl.textContent = 'Full Screen';
        }
        setTimeout(() => window.map.invalidateSize(), 150);
    });

    document.getElementById('btn-center-overlay').addEventListener('click', () => {
        if (AppState.mapPtA && AppState.mapPtB) {
            window.map.fitBounds(L.latLngBounds([AppState.mapPtA, AppState.mapPtB]).pad(0.45));
        } else if (AppState.mapPtA) {
            window.map.setView(AppState.mapPtA, 17);
        }
    });

    document.getElementById('btn-export-geojson').addEventListener('click', exportFullProjectJson);
}
