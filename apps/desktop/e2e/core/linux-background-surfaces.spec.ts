import { type Browser, chromium, expect, test } from '@playwright/test'
import { createServer } from 'vite'

// The core E2E lane explicitly provisions Chromium; ordinary Electron unit jobs do not.
// Exercise its compositor-facing CSS, not jsdom's incomplete color-mix
// implementation. Real renderer store + stylesheet + Button; no gateway needed.
test('renders translucent background without attenuating nested text and controls in either chat kind', async () => {
  const html = `<!doctype html><html><head><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root"></div>
    <script type="module">
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { Button } from '/src/components/ui/button.tsx';
      import { setTranslucencyMode, setTranslucency, setTranslucencyScope } from '/src/store/translucency.ts';
      const e = React.createElement;
      createRoot(document.getElementById('root')).render(e('div', { 'data-contrib-shell': '', style: { background: 'var(--ui-bg-chrome)' } },
        e('section', { style: { background: 'var(--ui-chat-surface-background)' } },
          e('p', { id: 'text' }, 'Full contrast text'), e(Button, { id: 'control' }, 'Send'))));
      window.setBackground = intensity => { setTranslucencyMode('background'); setTranslucencyScope('window'); setTranslucency(intensity); };
    </script></body></html>`

  const server = await createServer({
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
        name: 'transparency-test-page',
        configureServer(vite) {
          vite.middlewares.use('/__background.html', async (_req, res) => {
            res.setHeader('Content-Type', 'text/html')
            res.end(await vite.transformIndexHtml('/__background.html', html))
          })
        }
      }
    ]
  })

  await server.listen()
  let browser: Browser | undefined

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.HERMES_E2E_CHROMIUM || undefined
    })

    for (const search of ['', '?win=secondary']) {
      const page = await browser.newPage()
      await page.addInitScript(() => {
        localStorage.setItem(
          'hermes.desktop.translucency.v2',
          JSON.stringify({
            mode: 'background',
            base: { intensity: 60, scope: 'window' },
            light: {},
            dark: {}
          })
        )
        Object.defineProperty(window, 'hermesDesktop', {
          value: {
            glassSupported: false,
            translucencySupported: true,
            backgroundTransparencySupported: true
          }
        })
      })
      await page.goto(`${server.resolvedUrls!.local[0]}__background.html${search}`)
      await page.locator('#control').waitFor()
      // The saved choice must reach the very first rendered surface, before
      // any user interaction or runtime toggle.
      expect(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toMatch(
        /(?:\/ 0\.4|, 0\.4\))/
      )
      await page.evaluate(() => (window as unknown as { setBackground: (n: number) => void }).setBackground(0))

      const before = await page
        .locator('#control')
        .evaluate(el => ({ color: getComputedStyle(el).color, opacity: getComputedStyle(el).opacity }))

      await page.evaluate(() => (window as unknown as { setBackground: (n: number) => void }).setBackground(60))

      const paint = await page.evaluate(() => {
        const css = (el: Element) => getComputedStyle(el)

        return {
          background: css(document.body).backgroundColor,
          root: css(document.documentElement).backgroundColor,
          shell: css(document.querySelector('[data-contrib-shell]')!).backgroundColor,
          field: css(document.querySelector('section')!).backgroundColor,
          opacity: [
            ...document.querySelectorAll('html, body, #root, [data-contrib-shell], section, #text, #control')
          ].map(el => css(el).opacity),
          control: {
            color: css(document.querySelector('#control')!).color,
            opacity: css(document.querySelector('#control')!).opacity
          }
        }
      })

      expect(paint.background).toMatch(/(?:\/ 0\.4|, 0\.4\))/)
      expect(paint.root).toBe('rgba(0, 0, 0, 0)')
      expect(paint.shell).toBe('rgba(0, 0, 0, 0)')
      expect(paint.field).toBe('rgba(0, 0, 0, 0)')
      expect(paint.opacity.every(value => value === '1')).toBe(true)
      expect(paint.control).toEqual(before)
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})
