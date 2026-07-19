const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('free Monster target actions use the inspector action container', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const freeAttackBranch = appSource.match(
        /if \(context\.location === 'monsters' && myTargetMode[\s\S]*?else if \(context\.location === 'monsters' && !isTargetMode\)/
    );

    assert.ok(freeAttackBranch, 'Expected the free Monster attack inspector branch to exist');
    assert.match(freeAttackBranch[0], /modalActions\.appendChild\(btn\)/);
    assert.doesNotMatch(freeAttackBranch[0], /(^|[^A-Za-z])actions\.appendChild\(btn\)/);
});
