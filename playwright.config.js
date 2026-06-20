'use strict';

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './test/e2e',
    timeout: 30_000,
    expect: { timeout: 8_000 },
    fullyParallel: false, // tests share one server instance; sequential is safer
    workers: 1,           // single global gameState on the server — parallel workers collide in one lobby
    retries: 1,
    reporter: 'list',

    use: {
        baseURL: 'http://localhost:3000',
        // Landscape viewport — bypasses the rotation-lock overlay
        viewport: { width: 1280, height: 800 },
        // Block the PWA service worker so it can't serve a stale app.js during tests
        serviceWorkers: 'block',
        // Neutralize looping CSS animations (pulsing start button, target glows,
        // spinning dice) via the existing prefers-reduced-motion rules — otherwise
        // animated elements never satisfy Playwright's "stable" actionability check.
        reducedMotion: 'reduce',
        // Capture screenshots/traces only on failure
        screenshot: 'only-on-failure',
        trace: 'on-first-retry',
    },

    // This is a landscape-only mobile PWA, so we only test the mobile perspective.
    // (A desktop 'chromium' project can be re-added here if ever needed.)
    projects: [
        {
            name: 'mobile-chrome',
            use: {
                ...devices['Pixel 7 landscape'],
                serviceWorkers: 'block',
            },
        },
        // Portrait pass for the dual-orientation overhaul (spec §7.8). Tests that
        // pin their own viewport (e.g. startMobileGame's landscape MOBILE_VIEWPORT)
        // stay as-is; tests that use the default context viewport run in portrait.
        {
            name: 'mobile-portrait',
            use: {
                ...devices['Pixel 7'],
                viewport: { width: 390, height: 844 },
                serviceWorkers: 'block',
            },
        },
    ],

    // Auto-start the server before tests; skip if something is already on port 3000
    webServer: {
        command: 'node server.js',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 10_000,
    },
});
