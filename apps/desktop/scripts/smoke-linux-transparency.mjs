// Native-only smoke: isolated fixture, production surface helpers/store/stylesheet.
// Usage: node scripts/smoke-linux-transparency.mjs /absolute/electron /absolute/proof-dir
import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [electron, output] = process.argv.slice(2)
if (process.platform !== 'linux' || !path.isAbsolute(electron || '') || !path.isAbsolute(output || '')) {
  throw new Error('Usage (Linux): node scripts/smoke-linux-transparency.mjs /absolute/electron /absolute/proof-dir')
}
await mkdir(output, { recursive: true })
const scratch = await mkdtemp(path.join(process.env.TMPDIR || output, 'native-transparency-'))
const home = path.join(scratch, 'home')
await mkdir(home)
const compiled = await compile(await readFile(path.join(root, 'src/styles.css'), 'utf8'), {
  base: path.join(root, 'src'),
  onDependency() {}
})
await writeFile(path.join(scratch, 'production.css'), compiled.build([]))
await writeFile(
  path.join(scratch, 'renderer.ts'),
  `import * as store from ${JSON.stringify(path.join(root, 'src/store/translucency.ts'))}; window.smokeStore = store;`
)
await build({
  entryPoints: [path.join(scratch, 'renderer.ts')],
  outfile: path.join(scratch, 'renderer.js'),
  bundle: true,
  platform: 'browser',
  alias: { '@': path.join(root, 'src'), '@hermes/shared': path.join(root, '../shared/src') },
  nodePaths: [path.join(root, 'node_modules')]
})
await build({
  entryPoints: [path.join(root, 'electron/linux-transparency-native-fixture/main.ts')],
  outfile: path.join(scratch, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron']
})
await writeFile(
  path.join(scratch, 'native-snapshot.py'),
  await readFile(path.join(root, 'electron/linux-transparency-native-fixture/native-snapshot.py'))
)
await writeFile(
  path.join(scratch, 'preload.cjs'),
  `const {contextBridge,ipcRenderer}=require('electron'); contextBridge.exposeInMainWorld('hermesDesktop',{glassSupported:false,translucencySupported:true,backgroundTransparencySupported:true,setTranslucency:state=>ipcRenderer.send('smoke:translucency',state)});`
)
await writeFile(
  path.join(scratch, 'index.html'),
  `<!doctype html><html class="dark" style="background:#181818"><head><link rel="stylesheet" href="production.css"></head><body><div data-contrib-shell style="height:100vh;background:var(--ui-bg-chrome)"><div data-slot="sidebar-wrapper" style="height:100%;background:var(--ui-bg-chrome)"><aside data-slot="sidebar" style="position:absolute;left:0;top:0;width:160px;height:100%;background:var(--ui-sidebar-surface-background)"></aside><main style="position:absolute;left:160px;right:0;top:0;height:100%;background:var(--ui-chat-surface-background)"><span id="glyph" style="position:absolute;left:80px;top:50px;color:#fff;font:bold 72px monospace">HERMES</span></main></div></div><script src="renderer.js"></script></body></html>`
)
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith('HERMES_') && !/TOKEN|SECRET|PASSWORD|API_KEY/.test(key)
  )
)
Object.assign(env, {
  HOME: home,
  XDG_CONFIG_HOME: path.join(home, '.config'),
  XDG_CACHE_HOME: path.join(home, '.cache'),
  HERMES_HOME: path.join(home, 'hermes'),
  HERMES_RUNTIME_DIR: path.join(home, 'runtime'),
  SMOKE_ROOT: scratch,
  SMOKE_OUTPUT: output
})
delete env.ELECTRON_RUN_AS_NODE
let display
let xvfb
let compositor
let electronTimer
const children = []
const startupErrors = new WeakMap()
function start(command, args, options) {
  const child = spawn(command, args, options)
  children.push(child)
  child.on('error', error => {
    startupErrors.set(child, error)
  })
  return child
}
function assertRunning(child, label) {
  if (startupErrors.has(child)) throw startupErrors.get(child)
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`${label} exited before readiness: ${child.exitCode ?? child.signalCode}`)
  }
}
async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  const closed = once(child, 'close').catch(() => {})
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
  try {
    await closed
  } finally {
    clearTimeout(timer)
  }
}
try {
  if (process.env.SMOKE_BACKEND === 'wayland') {
    const runtime = path.join(scratch, 'wayland-runtime')
    await mkdir(runtime, { mode: 0o700 })
    env.XDG_RUNTIME_DIR = runtime
    env.WAYLAND_DISPLAY = 'smoke-wayland'
    env.WAYLAND_DEBUG = '1'
    delete env.DISPLAY
    xvfb = start(
      'weston',
      [
        '--backend=headless',
        '--renderer=pixman',
        '--no-config',
        '--socket=smoke-wayland',
        '--idle-time=0',
        `--log=${path.join(output, 'weston.log')}`
      ],
      { env, stdio: 'ignore' }
    )
    const { access } = await import('node:fs/promises')
    const deadline = Date.now() + 10000
    while (true) {
      assertRunning(xvfb, 'Weston')
      try {
        await access(path.join(runtime, 'smoke-wayland'))
        break
      } catch {
        if (Date.now() > deadline) throw new Error('Weston socket not ready')
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
  } else if (!process.env.SMOKE_USE_EXISTING_DISPLAY) {
    xvfb = start(
      'Xvfb',
      ['-displayfd', '1', '-screen', '0', '1280x900x24', '-nolisten', 'tcp', '+extension', 'Composite'],
      { env, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    xvfb.stderr.on('data', chunk => process.stderr.write(chunk))
    display = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Xvfb display not ready')), 10000)
      xvfb.stdout.once('data', chunk => {
        clearTimeout(timeout)
        resolve(`:${String(chunk).trim()}`)
      })
      xvfb.once('error', error => {
        clearTimeout(timeout)
        reject(error)
      })
      xvfb.once('exit', code => {
        clearTimeout(timeout)
        reject(new Error(`Xvfb exited ${code}`))
      })
    })
    env.DISPLAY = display
    delete env.WAYLAND_DISPLAY
    if (process.env.SMOKE_XCOMPMGR) {
      compositor = start(process.env.SMOKE_XCOMPMGR, ['-n'], { env, stdio: 'inherit' })
      const probe = `import ctypes as c; x=c.CDLL('libX11.so.6'); x.XOpenDisplay.restype=c.c_void_p; x.XInternAtom.argtypes=[c.c_void_p,c.c_char_p,c.c_int]; x.XInternAtom.restype=c.c_ulong; x.XGetSelectionOwner.argtypes=[c.c_void_p,c.c_ulong]; x.XGetSelectionOwner.restype=c.c_ulong; d=x.XOpenDisplay(None); print(x.XGetSelectionOwner(d,x.XInternAtom(d,b'_NET_WM_CM_S0',0)))`
      const deadline = Date.now() + 10000
      while (true) {
        assertRunning(compositor, 'xcompmgr')
        assertRunning(xvfb, 'Xvfb')
        const result = spawnSync('python', ['-c', probe], { env, encoding: 'utf8', timeout: 2000 })
        if (result.error || result.status !== 0)
          throw new Error(`X compositor probe failed: ${result.error || result.stderr}`)
        const owner = result.stdout.trim()
        if (!/^\d+$/.test(owner)) throw new Error(`Invalid compositor selection: ${owner}`)
        if (owner !== '0') break
        if (Date.now() > deadline) throw new Error('X compositor selection not acquired')
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
  }
  console.log(
    JSON.stringify({
      node: process.version,
      electron,
      scratch,
      output,
      display: env.DISPLAY,
      wayland: env.WAYLAND_DISPLAY,
      productionImports: ['electron/translucency.ts', 'src/store/translucency.ts', 'src/styles.css']
    })
  )
  const args = [
    path.join(scratch, 'main.cjs'),
    '--no-sandbox',
    '--disable-gpu',
    '--force-device-scale-factor=1',
    ...(process.env.SMOKE_ELECTRON_FLAGS || '--ozone-platform=x11').split(' ')
  ]
  const child = start(electron, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', chunk => {
      log += chunk
      process.stdout.write(chunk)
    })
  electronTimer = setTimeout(() => child.kill('SIGKILL'), 60000)
  const [code, signal] = await once(child, 'close')
  clearTimeout(electronTimer)
  await writeFile(path.join(output, 'electron.log'), log)
  await writeFile(
    path.join(output, 'execution.json'),
    JSON.stringify(
      {
        code,
        signal,
        cleanExit: code === 0,
        electron,
        node: process.version,
        scratch,
        backend: env.WAYLAND_DISPLAY ? 'wayland' : 'x11'
      },
      null,
      2
    )
  )
  if (code !== 0) throw new Error(`Electron failed: code=${code}, signal=${signal}`)
  console.log(`PASS native transparency; evidence: ${output}`)
} finally {
  clearTimeout(electronTimer)
  for (const child of children.toReversed()) await stop(child)
}
