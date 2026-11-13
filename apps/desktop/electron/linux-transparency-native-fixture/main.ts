import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { app, BrowserWindow, ipcMain } from 'electron'

import {
  applyChatWindowBacking,
  defaultTranslucencyState,
  nativeOpacityFor,
  opacityNeedsSetting,
  windowBackingOptions,
  windowOpacityOptions
} from '../translucency'

const root = process.env.SMOKE_ROOT!
const output = process.env.SMOKE_OUTPUT!
app.setPath('userData', path.join(root, 'user-data'))
app.disableHardwareAcceleration()
const observations: unknown[] = []
const windows: BrowserWindow[] = []
ipcMain.on('smoke:translucency', (_event, state) => {
  for (const win of windows) {
    applyChatWindowBacking(win, state, '#181818', process.platform)
    const opacity = nativeOpacityFor(state, false)

    if (opacityNeedsSetting(opacity, win.getOpacity())) {
      win.setOpacity(opacity)
    }
  }
})

const waitFor = async (win: BrowserWindow, expression: string) => {
  const deadline = Date.now() + 10000

  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(expression)) {
      return
    }

    await new Promise(resolve => setTimeout(resolve, 25))
  }

  throw new Error(`Timed out: ${expression}`)
}

const evaluate = (win: BrowserWindow, script: string) => win.webContents.executeJavaScript(script)

const settle = (win: BrowserWindow) =>
  evaluate(win, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')

async function capture(win: BrowserWindow, label: string, expected: 'opaque' | 'clear' | 'mixed' | 'sidebar') {
  await settle(win)
  const image = await win.webContents.capturePage()
  writeFileSync(path.join(output, `${label}.png`), image.toPNG())
  const bitmap = image.toBitmap()
  const { width, height } = image.getSize()
  const pixel = (x: number, y: number) => Array.from(bitmap.subarray((y * width + x) * 4, (y * width + x) * 4 + 4))
  const rail = pixel(40, 220)
  const field = pixel(560, 220)
  let opaqueWhiteGlyphPixels = 0

  for (let y = 55; y < 140; y++) {
    for (let x = 235; x < 530; x++) {
      const [b, g, r, a] = pixel(x, y)

      if (r > 245 && g > 245 && b > 245 && a === 255) {
        opaqueWhiteGlyphPixels++
      }
    }
  }

  const metadata = await evaluate(
    win,
    `({state:smokeStore.$translucency.get(),background:document.documentElement.hasAttribute('data-hermes-background'),body:getComputedStyle(document.body).background,keep:document.documentElement.style.getPropertyValue('--translucency-glass-keep'),scope:document.documentElement.getAttribute('data-hermes-glass-scope')})`
  )

  let nativePixels = null

  if (!process.env.WAYLAND_DISPLAY) {
    const id = win.getNativeWindowHandle().readUInt32LE(0)
    nativePixels = JSON.parse(
      execFileSync(
        'python',
        [path.join(root, 'native-snapshot.py'), String(id), path.join(output, `${label}-native.png`)],
        { encoding: 'utf8' }
      )
    )
    assert.equal(nativePixels.railRGBA[3], rail[3], 'Native backing alpha must equal renderer alpha')
    assert.equal(nativePixels.fieldRGBA[3], field[3], 'Native field alpha must equal renderer alpha')
    assert.ok(nativePixels.opaqueWhiteGlyphPixels > 200, 'Native glyph interior must stay opaque')
  }

  const row = {
    label,
    expected,
    size: { width, height },
    railBGRA: rail,
    fieldBGRA: field,
    opaqueWhiteGlyphPixels,
    nativePixels,
    opacity: win.getOpacity(),
    backing: win.getBackgroundColor(),
    metadata
  }

  observations.push(row)
  console.log(JSON.stringify(row))
  assert.equal(win.getOpacity(), 1, 'Native opacity must remain one')
  // Electron's getter serializes RGB and drops constructor alpha on Linux.
  // Native alpha is established by the X visual / Wayland protocol plus captured pixels.
  assert.ok(['#00000000', '#000000'].includes(win.getBackgroundColor()))
  assert.ok(opaqueWhiteGlyphPixels > 200, 'Interior glyph pixels must be fully opaque')

  if (expected === 'opaque') {
    assert.equal(rail[3], 255)
    assert.equal(field[3], 255)
  }

  if (expected === 'clear') {
    assert.equal(rail[3], 0)
    assert.equal(field[3], 0)
  }

  if (expected === 'mixed') {
    assert.ok(rail[3] > 30 && rail[3] < 225)
    assert.equal(field[3], rail[3])
  }

  if (expected === 'sidebar') {
    assert.equal(rail[3], 0)
    assert.equal(field[3], 255)
  }
}

async function create(kind: string) {
  const state = defaultTranslucencyState('dark', false, false)

  const options = {
    width: 640,
    height: 360,
    frame: false,
    show: true,
    ...windowBackingOptions(state, '#181818', process.platform),
    ...windowOpacityOptions(state, false),
    webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false }
  }

  const win = new BrowserWindow(options)
  windows.push(win)
  await win.loadFile(path.join(root, 'index.html'), { search: kind === 'secondary' ? '?win=secondary' : '' })
  await waitFor(win, '!!window.smokeStore')

  if (!process.env.WAYLAND_DISPLAY) {
    const id = win.getNativeWindowHandle().readUInt32LE(0)
    const native = execFileSync('xwininfo', ['-id', String(id)], { encoding: 'utf8' })
    writeFileSync(path.join(output, `${kind}-xwininfo.txt`), native)
    assert.match(native, /Depth: 32/, 'Real X11 window must have 32-bit alpha visual')
    console.log(`${kind}: native X11 depth=32, handle=${id}`)
  }

  return win
}

app.whenReady().then(async () => {
  try {
    console.log(
      JSON.stringify({
        versions: process.versions,
        platform: process.platform,
        session: process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11'
      })
    )
    const primary = await create('primary')
    await capture(primary, '01-primary-default-off', 'opaque')
    await evaluate(
      primary,
      "smokeStore.setTranslucencyMode('background');smokeStore.setTranslucencyScope('window');smokeStore.setTranslucency(100)"
    )
    await capture(primary, '02-primary-live-on', 'clear')
    const secondary = await create('secondary')
    await waitFor(secondary, 'smokeStore.$translucency.get().intensity === 100')
    await capture(secondary, '03-secondary-created-on', 'clear')
    await evaluate(primary, 'smokeStore.setTranslucency(50)')
    await waitFor(secondary, 'smokeStore.$translucency.get().intensity === 50')
    await capture(primary, '04-primary-half', 'mixed')
    await capture(secondary, '05-secondary-storage-sync-half', 'mixed')
    await evaluate(primary, "smokeStore.setTranslucency(100);smokeStore.setTranslucencyScope('sidebar')")
    await waitFor(
      secondary,
      "smokeStore.$translucency.get().scope === 'sidebar' && smokeStore.$translucency.get().intensity === 100"
    )
    await capture(primary, '06-primary-sidebar', 'sidebar')
    await capture(secondary, '07-secondary-sidebar', 'sidebar')
    await evaluate(primary, 'smokeStore.setTranslucency(0)')
    await waitFor(secondary, 'smokeStore.$translucency.get().intensity === 0')
    await capture(primary, '08-primary-live-off', 'opaque')
    await capture(secondary, '09-secondary-live-off', 'opaque')
    await evaluate(
      primary,
      "smokeStore.setTranslucencyMode('clear');smokeStore.setTranslucency(100);smokeStore.setTranslucencyFade(100)"
    )
    await waitFor(secondary, "smokeStore.$translucencyBook.get().mode === 'clear'")
    await capture(primary, '10-imported-clear-no-fade', 'opaque')
    writeFileSync(path.join(output, 'results.json'), JSON.stringify({ status: 'passed', observations }, null, 2))

    for (const win of windows) {
      win.destroy()
    }

    app.quit()
  } catch (error) {
    writeFileSync(
      path.join(output, 'results.json'),
      JSON.stringify({ status: 'failed', error: String(error), observations }, null, 2)
    )
    console.error(error)
    app.exit(1)
  }
})
