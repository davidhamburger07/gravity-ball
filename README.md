# Gravity Ball

A physics puzzle game where you never move the ball — you change which way gravity
points, and the ball's momentum does the rest. 10 chapters, 184 levels, one new
mechanic per chapter.

Play it here: https://gravity-ball-azure.vercel.app

## Running it locally

Needs Node 18+.

    npm install
    npm run dev

then open http://localhost:3000. It has to run over http (not file://) or the browser
blocks the ES modules. `npm run build` makes a production bundle in dist/ with esbuild.

## Controls

Arrow keys or WASD shift gravity up / down / left / right. Swipe on mobile. R restarts
the level.

## The level editor

Open /editor.html (it's also linked from the main menu). Every mechanic in the game is
placeable — walls, spikes, trampolines, keys and doors, portals, colour switches,
lasers, black holes and so on. You can playtest a level in the real game straight from
the editor, and export or import it as JSON in the same shape as src/data/levels.json.

All the levels live in src/data/levels.json, arrayed by chapter. Nothing is hardcoded.

There's also a checker, verify-levels.mjs, which loads the game headless and plays each
level's stored solution to make sure nothing unsolvable ships. All 184 levels pass.

## How the code is laid out

Phaser 3 with Matter.js for the physics, plain ES modules, no framework.

- src/systems/GravityController.js — the heart of it: owns which way "down" is and
  applies it to the Matter world while keeping every body's velocity, so speed carries
  through each flip.
- src/systems/InputManager.js — keyboard and swipes turned into gravity requests. No
  physics in here.
- src/scenes/ — boot, preload, menu, level select, and the game itself.
- src/editor/ — the level editor.
- src/sdk/CrazyGamesSDK.js — wrapper for the platform SDK that mocks itself on
  localhost so the game runs the same everywhere.

## Status

Playable start to finish, but still in progress — the art and audio are placeholders,
chapter 1 needs filling out to a full 20 levels, and I'm still tuning difficulty. Plan
is a proper art pass, then submitting it to a web games portal.

MIT, David Hamburger.
