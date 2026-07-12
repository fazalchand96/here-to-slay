# CSS sprite-sheet animation instead of a canvas engine

The client is vanilla JS/CSS with no build step and no canvas/WebGL rendering
anywhere today. For the premium 2D/2.5D card and skill animations, we chose to
stay entirely inside that architecture: Codex generates sprite-sheet PNGs (same
pipeline shape as the existing card-art generation), played back with CSS
`steps()` stepped `background-position` animation, with "2.5D" depth faked via
layered, independently-animated absolutely-positioned DOM elements — the same
trick already used for the draw/discard pile depth.

We considered a canvas-based sprite engine (more flexible — e.g. dynamic
rotation toward a target) but rejected it: it would introduce a new rendering
subsystem and dependency this late in the project, for a payoff that isn't
needed given the animation scope is class/event-type-based (a bounded, small
asset count), not per-card.
