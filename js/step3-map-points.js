// ============================================================================
// STEP 3 LOGIC: GOOGLE SATELLITE MAP, SMART URL/DMS/GPS PARSER & PINS A' / B'
// ============================================================================

function initLeafletMap() {
    document.getElementById('step-3-map-slot').appendChild(document.getElementById('shared-map-wrapper'));

    window.map = L.map('leaflet-map', {
        center: [25.6185, 85.0762],
        zoom: 16,
        maxZoom: 22,
        zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(window.map);

    window.baseLayers = {
        hybrid: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxNativeZoom: 20, maxZoom: 22 }),
        sat: L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxNativeZoom: 20, maxZoom: 22 }),
        streets: L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxNativeZoom: 20, maxZoom: 22 }),
        osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 22 })
    };
    window.baseLayers.hybrid.addTo(window.map);

    window.cadastralOverlayLayer = new CadastralOverlayLayer();
    window.cadastralOverlayLayer.addTo(window.map);

    window.map.on('click', (e) => {
        if (AppState.activeStep !== 3 || AppState.mapTool === 'pan') return;
        if (AppState.mapTool === 'pickA') {
            placeMapPointA(e.latlng);
            showToast("Point <b>A'</b> placed! Overlay is aligned at 1:X scale. Tap 'Generate Overlay & Open Step 4'!", 'success');
        } else if (AppState.mapTool === 'pickB') {
            placeMapPointB(e.latlng);
            showToast("Point <b>B'</b> placed! Tap 'Generate Overlay & Open Step 4'.", 'success');
        }
    });
}

function createPinIcon(label, hexColor) {
    return L.divIcon({
        className: 'custom-gis-pin',
        html: `
            <div style="position:relative; width:32px; height:32px; transform:translate(-16px, -16px);">
                <svg width="32" height="32" viewBox="0 0 32 32">
                    <circle cx="16" cy="16" r="12" fill="none" stroke="${hexColor}" stroke-width="2.5"/>
                    <line x1="2" y1="16" x2="30" y2="16" stroke="${hexColor}" stroke-width="2"/>
                    <line x1="16" y1="2" x2="16" y2="30" stroke="${hexColor}" stroke-width="2"/>
                    <circle cx="16" cy="16" r="3.5" fill="#ffffff" stroke="#090d16" stroke-width="1.5"/>
                </svg>
                <div style="position:absolute; top:-10px; left:22px; background:${hexColor}; color:#fff; font-family:'JetBrains Mono',monospace; font-weight:700; font-size:11px; padding:1px 6px; border-radius:4px; border:1.5px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,0.4);">
                    ${label}
                </div>
            </div>
        `,
        iconSize: [0, 0]
    });
}

function placeMapPointA(latlng) {
    AppState.mapPtA = L.latLng(latlng.lat, latlng.lng);
    if (!window.markerMapA) {
        window.markerMapA = L.marker(AppState.mapPtA, { draggable: true, icon: createPinIcon("A'", '#dc2626') }).addTo(window.map);
        window.markerMapA.on('drag', (e) => {
            AppState.mapPtA = e.target.getLatLng();
            updateMapPointReadouts();
            solveAndRenderGeoreference();
        });
        window.markerMapA.on('dragend', () => saveSessionToIndexedDB());
    } else {
        window.markerMapA.setLatLng(AppState.mapPtA);
    }
    updateMapPointReadouts();
    solveAndRenderGeoreference();
    updateStepBadges();
    saveSessionToIndexedDB();
}

function placeMapPointB(latlng) {
    AppState.mapPtB = L.latLng(latlng.lat, latlng.lng);
    if (!window.markerMapB) {
        window.markerMapB = L.marker(AppState.mapPtB, { draggable: true, icon: createPinIcon("B'", '#2563eb') }).addTo(window.map);
        window.markerMapB.on('drag', (e) => {
            AppState.mapPtB = e.target.getLatLng();
            updateMapPointReadouts();
            solveAndRenderGeoreference();
        });
        window.markerMapB.on('dragend', () => saveSessionToIndexedDB());
    } else {
        window.markerMapB.setLatLng(AppState.mapPtB);
    }
    updateMapPointReadouts();
    solveAndRenderGeoreference();
    updateStepBadges();
    saveSessionToIndexedDB();
}

function updateMapPointReadouts() {
    if (AppState.mapPtA) {
        const formattedA = `${AppState.mapPtA.lat.toFixed(6)}, ${AppState.mapPtA.lng.toFixed(6)}`;
        document.getElementById('map-pt-a-status').textContent = `A': ${AppState.mapPtA.lat.toFixed(5)}, ${AppState.mapPtA.lng.toFixed(5)}`;
        document.getElementById('parsed-readout-a').textContent = formattedA;
        const inputA = document.getElementById('input-raw-a');
        if (document.activeElement !== inputA) {
            inputA.value = formattedA;
        }
        const badgeA = document.getElementById('badge-parse-a');
        badgeA.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold';
        badgeA.textContent = '✓ Synced';
        document.getElementById('shorturl-help-a').classList.add('hidden');
    }
    if (AppState.mapPtB) {
        const formattedB = `${AppState.mapPtB.lat.toFixed(6)}, ${AppState.mapPtB.lng.toFixed(6)}`;
        document.getElementById('map-pt-b-status').textContent = `B': ${AppState.mapPtB.lat.toFixed(5)}, ${AppState.mapPtB.lng.toFixed(5)}`;
        document.getElementById('parsed-readout-b').textContent = formattedB;
        const inputB = document.getElementById('input-raw-b');
        if (document.activeElement !== inputB) {
            inputB.value = formattedB;
        }
        const badgeB = document.getElementById('badge-parse-b');
        badgeB.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold';
        badgeB.textContent = '✓ Synced';
        document.getElementById('shorturl-help-b').classList.add('hidden');
    }
    if (AppState.mapPtA && AppState.mapPtB) {
        if (!window.vectorLineMap) {
            window.vectorLineMap = L.polyline([AppState.mapPtA, AppState.mapPtB], { color: '#f59e0b', weight: 2.5, dashArray: '7, 5' }).addTo(window.map);
        } else {
            window.vectorLineMap.setLatLngs([AppState.mapPtA, AppState.mapPtB]);
        }
    }
}

function clearMapPointA(notify = true) {
    AppState.mapPtA = null;
    if (window.markerMapA && window.map) {
        window.map.removeLayer(window.markerMapA);
        window.markerMapA = null;
    }
    if (window.vectorLineMap && window.map) {
        window.map.removeLayer(window.vectorLineMap);
        window.vectorLineMap = null;
    }
    document.getElementById('map-pt-a-status').textContent = "A': Not Set";
    document.getElementById('parsed-readout-a').textContent = 'Not set';
    document.getElementById('input-raw-a').value = '';
    const badgeA = document.getElementById('badge-parse-a');
    badgeA.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600';
    badgeA.textContent = 'Waiting';
    document.getElementById('shorturl-help-a').classList.add('hidden');
    setMapTool('pickA');
    solveAndRenderGeoreference();
    updateStepBadges();
    saveSessionToIndexedDB();
    if (notify) showToast("Cleared Point <b>A'</b> from Google Map.", 'info');
}

function clearMapPointB(notify = true) {
    AppState.mapPtB = null;
    if (window.markerMapB && window.map) {
        window.map.removeLayer(window.markerMapB);
        window.markerMapB = null;
    }
    if (window.vectorLineMap && window.map) {
        window.map.removeLayer(window.vectorLineMap);
        window.vectorLineMap = null;
    }
    document.getElementById('map-pt-b-status').textContent = "B': Optional";
    document.getElementById('parsed-readout-b').textContent = 'Optional';
    document.getElementById('input-raw-b').value = '';
    const badgeB = document.getElementById('badge-parse-b');
    badgeB.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600';
    badgeB.textContent = 'Optional';
    document.getElementById('shorturl-help-b').classList.add('hidden');
    solveAndRenderGeoreference();
    updateStepBadges();
    saveSessionToIndexedDB();
    if (notify) showToast("Cleared optional Point <b>B'</b> from Google Map.", 'info');
}

function clearMapPoints(notify = true) {
    clearMapPointA(false);
    clearMapPointB(false);
    if (notify) showToast("Reset Google Map Points <b>A' & B'</b>.", 'info');
}

function setMapTool(tool) {
    AppState.mapTool = tool;
    const bA = document.getElementById('btn-pick-map-a');
    const bB = document.getElementById('btn-pick-map-b');
    const bP = document.getElementById('btn-map-pan');

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

function parseSmartGeoInput(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') {
        return { ok: false, reason: 'empty' };
    }
    const str = decodeURIComponent(rawInput.trim());

    const bangMatch = str.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/i);
    if (bangMatch) {
        const lat = parseFloat(bangMatch[1]);
        const lng = parseFloat(bangMatch[2]);
        if (isValidLatLng(lat, lng)) return { ok: true, lat, lng, source: 'Google Maps Pin (!3d!4d)' };
    }

    const atMatch = str.match(/@(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (atMatch) {
        const lat = parseFloat(atMatch[1]);
        const lng = parseFloat(atMatch[2]);
        if (isValidLatLng(lat, lng)) return { ok: true, lat, lng, source: 'Google Maps URL (@lat,lng)' };
    }

    const paramMatch = str.match(/(?:q|ll|center|destination|query)=(?:loc:)?(-?\d+\.\d+)\s*(?:,|\+|\s)\s*(-?\d+\.\d+)/i);
    if (paramMatch) {
        const lat = parseFloat(paramMatch[1]);
        const lng = parseFloat(paramMatch[2]);
        if (isValidLatLng(lat, lng)) return { ok: true, lat, lng, source: 'Google Maps Query Link' };
    }

    const dmsRegex = /(\d{1,3})\s*[°d:\s]\s*(\d{1,2})\s*['′m:\s]\s*(\d{1,2}(?:\.\d+)?)\s*["″s]?\s*([NSns])[\s,;]+(\d{1,3})\s*[°d:\s]\s*(\d{1,2})\s*['′m:\s]\s*(\d{1,2}(?:\.\d+)?)\s*["″s]?\s*([EWew])/;
    const dmsMatch = str.match(dmsRegex);
    if (dmsMatch) {
        let lat = parseFloat(dmsMatch[1]) + parseFloat(dmsMatch[2]) / 60 + parseFloat(dmsMatch[3]) / 3600;
        if (dmsMatch[4].toUpperCase() === 'S') lat = -lat;
        let lng = parseFloat(dmsMatch[5]) + parseFloat(dmsMatch[6]) / 60 + parseFloat(dmsMatch[7]) / 3600;
        if (dmsMatch[8].toUpperCase() === 'W') lng = -lng;
        if (isValidLatLng(lat, lng)) return { ok: true, lat, lng, source: 'DMS Coordinates' };
    }

    const cardDecRegex = /(-?\d{1,2}\.\d+)\s*°?\s*([NSns])?[\s,;]+(-?\d{1,3}\.\d+)\s*°?\s*([EWew])?/;
    const cardMatch = str.match(cardDecRegex);
    if (cardMatch) {
        let lat = parseFloat(cardMatch[1]);
        if (cardMatch[2] && cardMatch[2].toUpperCase() === 'S') lat = -Math.abs(lat);
        let lng = parseFloat(cardMatch[3]);
        if (cardMatch[4] && cardMatch[4].toUpperCase() === 'W') lng = -Math.abs(lng);
        if (isValidLatLng(lat, lng)) return { ok: true, lat, lng, source: 'Decimal Coordinates' };
    }

    const shortUrlMatch = str.match(/https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/[^\s]+/i);
    if (shortUrlMatch) {
        return { ok: false, reason: 'short_url', url: shortUrlMatch[0] };
    }

    return { ok: false, reason: 'unrecognized' };
}

function isValidLatLng(lat, lng) {
    return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

async function applyRawInputForPoint(whichPoint, rawText, panMap = true) {
    const isA = whichPoint === 'A';
    const badge = document.getElementById(isA ? 'badge-parse-a' : 'badge-parse-b');
    const helpBox = document.getElementById(isA ? 'shorturl-help-a' : 'shorturl-help-b');
    const helpLink = document.getElementById(isA ? 'shorturl-link-a' : 'shorturl-link-b');

    helpBox.classList.add('hidden');
    const parsed = parseSmartGeoInput(rawText);

    if (parsed.ok) {
        if (isA) {
            placeMapPointA({ lat: parsed.lat, lng: parsed.lng });
        } else {
            placeMapPointB({ lat: parsed.lat, lng: parsed.lng });
        }
        badge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold';
        badge.textContent = `✓ ${parsed.source}`;

        if (panMap && window.map) {
            if (AppState.mapPtA && AppState.mapPtB) {
                window.map.fitBounds(L.latLngBounds([AppState.mapPtA, AppState.mapPtB]).pad(0.35));
            } else {
                window.map.setView([parsed.lat, parsed.lng], 17);
            }
        }
        showToast(`Set Point <b>${isA ? "A'" : "B'"}</b> to <code class="font-mono">${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)}</code>`, 'success');
        return true;
    }

    if (parsed.reason === 'short_url') {
        badge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold';
        badge.textContent = 'Short Link';
        helpLink.href = parsed.url;
        helpBox.classList.remove('hidden');
        showToast('Shortened Google Maps link detected. Tap "Open Link in New Tab" to copy full URL.', 'warn');
        return false;
    }

    badge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-semibold';
    badge.textContent = 'Invalid Format';
    return false;
}

function copyTextToClipboard(text, label) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        showToast(`Copied <b>${label}</b> (<code class="font-mono">${text}</code>) to clipboard!`, 'info');
    } catch (err) {
        showToast('Could not copy automatically. Please select and copy the text.', 'warn');
    }
    document.body.removeChild(ta);
}

function initStep3Events() {
    document.getElementById('btn-pick-map-a').addEventListener('click', () => setMapTool('pickA'));
    document.getElementById('btn-pick-map-b').addEventListener('click', () => setMapTool('pickB'));
    document.getElementById('btn-map-pan').addEventListener('click', () => setMapTool('pan'));

    document.getElementById('btn-clear-map-a').addEventListener('click', () => clearMapPointA(true));
    document.getElementById('btn-clear-map-b').addEventListener('click', () => clearMapPointB(true));
    document.getElementById('btn-clear-map-pts').addEventListener('click', () => clearMapPoints(true));

    document.getElementById('btn-drop-map-crosshair').addEventListener('click', () => {
        const centerLatLng = window.map.getCenter();
        if (AppState.mapTool === 'pickB') {
            placeMapPointB(centerLatLng);
            showToast("Dropped Point <b>B'</b> at Map Center! Ready for Step 4.", 'success');
        } else {
            placeMapPointA(centerLatLng);
            showToast("Dropped Point <b>A'</b> at Map Center! Ready to open Step 4.", 'success');
        }
    });

    ['a', 'b'].forEach(letter => {
        const upper = letter.toUpperCase();
        const inputEl = document.getElementById(`input-raw-${letter}`);
        const btnSet = document.getElementById(`btn-apply-raw-${letter}`);
        const btnPaste = document.getElementById(`btn-paste-${letter}`);
        const btnGps = document.getElementById(`btn-gps-${letter}`);
        const btnCopy = document.getElementById(`btn-copy-${letter}`);

        btnSet.addEventListener('click', () => {
            applyRawInputForPoint(upper, inputEl.value, true);
        });

        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyRawInputForPoint(upper, inputEl.value, true);
            }
        });

        inputEl.addEventListener('paste', () => {
            setTimeout(() => {
                applyRawInputForPoint(upper, inputEl.value, true);
            }, 40);
        });

        btnPaste.addEventListener('click', async () => {
            try {
                if (navigator.clipboard && navigator.clipboard.readText) {
                    const clipText = await navigator.clipboard.readText();
                    if (clipText) {
                        inputEl.value = clipText;
                        applyRawInputForPoint(upper, clipText, true);
                        return;
                    }
                }
                inputEl.focus();
                showToast(`Long-press inside the Point ${upper}' box and tap <b>Paste</b>.`, 'info');
            } catch (err) {
                inputEl.focus();
                showToast(`Long-press inside the Point ${upper}' box and tap <b>Paste</b>.`, 'info');
            }
        });

        btnGps.addEventListener('click', () => {
            if (!navigator.geolocation) {
                showToast('GPS Geolocation is not supported on this device/browser.', 'warn');
                return;
            }
            showToast(`Acquiring high-accuracy satellite GPS for Point <b>${upper}'</b>...`, 'info');
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const lat = pos.coords.latitude;
                    const lng = pos.coords.longitude;
                    const acc = Math.round(pos.coords.accuracy || 0);
                    inputEl.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
                    applyRawInputForPoint(upper, inputEl.value, true);
                    showToast(`📍 GPS locked for Point <b>${upper}'</b> (±${acc}m accuracy)!`, 'success');
                },
                (err) => {
                    showToast(`Could not read GPS (${err.message}). Please check location permissions.`, 'warn');
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        });

        btnCopy.addEventListener('click', () => {
            const pt = upper === 'A' ? AppState.mapPtA : AppState.mapPtB;
            if (!pt) {
                showToast(`Point ${upper}' is not set yet.`, 'warn');
                return;
            }
            copyTextToClipboard(`${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}`, `Point ${upper}'`);
        });
    });

    document.getElementById('bihar-quick-jump').addEventListener('change', (e) => {
        const [lat, lng, z] = e.target.value.split(',').map(Number);
        window.map.setView([lat, lng], z);
    });

    const runSearch = async () => {
        const q = document.getElementById('coord-search-input').value.trim();
        if (!q) return;
        const m = q.match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
        if (m) {
            window.map.setView([parseFloat(m[1]), parseFloat(m[3])], 17);
            return;
        }
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q + ', Bihar, India')}&limit=1`);
            const data = await res.json();
            if (data && data.length) {
                window.map.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 16);
                showToast(`Found: <b>${data[0].display_name.split(',')[0]}</b>`, 'info');
            } else {
                showToast('Village not found. Try District dropdown or Lat,Lng.', 'warn');
            }
        } catch (err) {
            showToast('Search unavailable. Enter coordinates as Lat,Lng.', 'warn');
        }
    };
    document.getElementById('btn-coord-search').addEventListener('click', runSearch);
    document.getElementById('coord-search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
}
