// Shared CSS sprite-sheet playback for presentation-only game animations.
(function () {
    'use strict';

    const active = new WeakMap();

    function playSpriteAnim(targetEl, options = {}) {
        if (!targetEl) return { stop() {} };
        active.get(targetEl)?.stop();

        const frames = Math.max(1, Number(options.frames) || 1);
        const fps = Math.max(1, Number(options.fps) || 12);
        const width = Math.max(1, Number(options.width) || 128);
        const height = Math.max(1, Number(options.height) || width);
        const loop = options.loop !== false;
        const duration = frames / fps;
        let stopped = false;
        let root = null;
        let finishTimer = null;

        const controller = {
            stop() {
                if (stopped) return;
                stopped = true;
                clearTimeout(finishTimer);
                root?.remove();
                targetEl.classList.remove('sprite-anim-active');
                if (active.get(targetEl) === controller) active.delete(targetEl);
            }
        };
        active.set(targetEl, controller);

        const image = new Image();
        image.onload = () => {
            if (stopped) return;
            root = document.createElement('div');
            root.className = 'sprite-anim-root';
            root.style.width = `${width}px`;
            root.style.height = `${height}px`;

            const layerConfigs = options.layers?.length ? options.layers : [{}];
            layerConfigs.forEach((layer, index) => {
                const el = document.createElement('i');
                el.className = `sprite-anim-layer ${layer.className || ''}`.trim();
                el.style.backgroundImage = `url("${options.sheetUrl}")`;
                el.style.backgroundSize = `${frames * width}px ${height}px`;
                el.style.animationDuration = `${duration}s`;
                el.style.animationTimingFunction = `steps(${frames}, end)`;
                el.style.animationIterationCount = loop ? 'infinite' : '1';
                el.style.setProperty('--sprite-travel', `${-(frames * width)}px`);
                el.style.transform = layer.transform || '';
                el.style.opacity = layer.opacity ?? '1';
                el.style.filter = layer.filter || '';
                el.style.zIndex = String(layer.zIndex ?? index);
                root.appendChild(el);
            });

            targetEl.classList.add('sprite-anim-active');
            targetEl.appendChild(root);
            if (!loop) {
                finishTimer = setTimeout(() => {
                    controller.stop();
                    if (typeof options.onDone === 'function') options.onDone();
                }, duration * 1000);
            }
        };
        // Missing sheets are intentionally silent and leave the original UI intact.
        image.onerror = () => controller.stop();
        image.src = options.sheetUrl || '';
        return controller;
    }

    window.playSpriteAnim = playSpriteAnim;
})();
