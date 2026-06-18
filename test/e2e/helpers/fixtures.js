'use strict';

// Shared `test`/`expect` for the card e2e specs.
//
// All specs run against a single authoritative server with one global gameState,
// and the server adds every connecting socket to playerOrder. If a test fails
// before reaching its manual ctx.close(), those sockets leak: they stay in the
// lobby/playerOrder, so the next test's host is wrong and start_game is rejected,
// cascading timeouts across the rest of the suite.
//
// This auto fixture closes every context created via startGame() on teardown
// (pass or fail), which disconnects the sockets and lets the server reset to a
// clean LOBBY before the next test. Specs only need to import `test`/`expect`
// from here instead of '@playwright/test'.

const base = require('@playwright/test');
const { closeTrackedContexts } = require('./gameSetup');

const test = base.test.extend({
    _autoCleanup: [async ({}, use) => {
        await use();
        await closeTrackedContexts();
    }, { auto: true }],
});

module.exports = { test, expect: base.expect };
