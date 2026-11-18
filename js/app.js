// ============================================================================
// MAIN APPLICATION BOOTSTRAPPER & PWA SERVICE WORKER REGISTRATION
// ============================================================================

let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const installBtn = document.getElementById('btn-install-pwa');
    if (installBtn) {
        installBtn.classList.remove('hidden');
        installBtn.classList.add('flex');
    }
});

window.onload = function () {
    setAppTheme('light');
    initLeafletMap();
    initStep1Events();
    initStep2Events();
    initStep3Events();
    initStep4Events();

    // Global Reset All Points & Storage Button in Navbar
    document.getElementById('btn-reset-all-points').addEventListener('click', () => {
        resetAllPointsAndStorage(true);
    });

    // Install PWA Button
    const installBtn = document.getElementById('btn-install-pwa');
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;
            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            installBtn.classList.add('hidden');
        });
    }

    window.addEventListener('resize', () => {
        if (AppState.activeStep === 2) resizePdfViewport();
        if (window.map) window.map.invalidateSize();
    });

    // Start with a clean slate (no default coordinates or demo map pre-loaded)
    updateStepBadges();
    openStep(1);
    checkSavedSessionInIndexedDB();

    // Register Offline Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
};
