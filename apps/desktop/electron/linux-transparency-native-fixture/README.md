# Native Linux transparency smoke

This fixture is separate from Vitest and browser CSS tests. It bundles **production**
`electron/translucency.ts`, `src/store/translucency.ts`, and the compiled production
`src/styles.css` into a scratch-only Electron app. No desktop build or gateway is started.
The minimal HTML and preload IPC bridge are explicit test seams, not the app shell.

## Run

Prerequisites: installed workspace dependencies, Node 26, Python + Pillow + libX11,
Xvfb, xwininfo, and a compositing manager (or Weston for Wayland). Use the installed
workspace Electron binary at `node_modules/electron/dist/electron`; an explicitly
version-verified extracted binary also works. Neither installation is modified.

From `apps/desktop`:

```sh
SMOKE_XCOMPMGR=/absolute/path/to/xcompmgr \
  /home/firesquid/.hermes/tools/node-26.12.1-linux-x64/bin/node \
  scripts/smoke-linux-transparency.mjs /absolute/path/to/electron /absolute/proof-dir
```

The runner creates a private X server, HOME, HERMES_HOME, HERMES_RUNTIME_DIR,
Electron userData, and caches; it strips inherited Hermes and credential variables.
It waits for the compositor selection before launching Electron. Both child display
processes are stopped and awaited after execution, including startup failures;
cleanup escalates from SIGTERM to SIGKILL after two seconds. Readiness checks and
Electron execution are bounded. It never starts a gateway.

Assertions cover default-off, live-on, secondary creation while on, live half tint,
real localStorage sibling synchronization, sidebar-only scope, live-off, and stale
Clear/Fade being inert on Linux. All captures assert native `getOpacity() === 1`.
Real X11 windows must have a 32-bit visual. `native-snapshot.py` uses XGetImage on
those windows to save **native backing PNGs**, checks native background alpha against
Electron capturePage, and counts opaque white glyph-interior pixels independently.
Thus the native proof is not just Chromium's CSS screenshot.

`*-native.png` is a raw premultiplied native backing dump (RGB remains premultiplied;
alpha is exact). Plain `*.png` captures are Electron capturePage output. `results.json`
records both paths' samples and assertions. `*-xwininfo.txt` records real native visuals.

## Optional native Wayland diagnostic

```sh
SMOKE_BACKEND=wayland SMOKE_ELECTRON_FLAGS=--ozone-platform=wayland \
  node scripts/smoke-linux-transparency.mjs /absolute/electron /absolute/proof-dir
```

This starts private headless Weston/pixman and records WAYLAND_DEBUG protocol output.
`wl_shm_pool.create_buffer(..., 0)` uses ARGB8888; `set_opaque_region(nil)` and committed
buffers provide native alpha surface evidence. There is no XGetImage on this path.
Final workspace Electron **44.10.2** runs pass all ten scenarios and exit cleanly
on both composited X11 and native Weston Wayland. Historical Electron 40.10.2
passed the Wayland assertions but SIGSEGV'd on shutdown; that older run remains
a failure. The runner requires clean exit as well as successful assertions.
Evidence: `~/documents/hermes-linux-transparency/native-final44-{x11,wayland}/`.

These seams do not execute production main.ts constructors or preload, the React
settings controls, the full desktop app, Hyprland rules, blur, hardware rendering,
packaging, or installation. Those require their respective native acceptance runs.
