// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

const sent = vi.hoisted(() => {
  const calls: unknown[] = []

  Object.defineProperty(globalThis.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
  Object.defineProperty(globalThis.window, 'hermesDesktop', {
    configurable: true,
    value: {
      glassSupported: false,
      backgroundTransparencySupported: true,
      translucencySupported: true,
      setTranslucency: (state: unknown) => calls.push(state)
    }
  })

  return calls
})

import { type TranslucencyState, windowOpacityFor } from '@hermes/shared/translucency'

import { readJson, writeJson } from '@/lib/storage'

import {
  $translucency,
  setTranslucency,
  setTranslucencyFade,
  setTranslucencyMode,
  TRANSLUCENCY_SUPPORTED
} from './translucency'

const initial = $translucency.get()
const key = 'hermes.desktop.translucency.v2'

describe('Linux background transparency', () => {
  it('requires explicit opt-in and paints only the background, persisting the choice', () => {
    vi.useFakeTimers()

    try {
      expect(TRANSLUCENCY_SUPPORTED).toBe(true)
      expect(initial.intensity).toBe(0)
      setTranslucency(60)
      expect($translucency.get().intensity).toBe(0)
      setTranslucencyMode('background')
      setTranslucencyFade(90)
      expect($translucency.get()).toMatchObject({ mode: 'background', intensity: 60, fade: 0 })
      expect(document.documentElement.hasAttribute('data-hermes-background')).toBe(true)
      expect(document.documentElement.hasAttribute('data-hermes-glass')).toBe(true)
      expect(document.documentElement.hasAttribute('data-hermes-glass-on')).toBe(false)
      expect(document.documentElement.hasAttribute('data-hermes-clear')).toBe(false)
      expect(document.documentElement.style.getPropertyValue('--translucency-glass-keep')).toBe('40%')
      vi.advanceTimersByTime(200)
      expect(readJson(key)).toMatchObject({ mode: 'background', dark: { intensity: 60 } })

      for (const state of sent as TranslucencyState[]) {expect(windowOpacityFor(state)).toBe(1)}
      writeJson(key, { mode: 'background', dark: { intensity: 42, fade: 100, scope: 'window' } })
      window.dispatchEvent(new StorageEvent('storage', { key }))
      expect($translucency.get()).toMatchObject({ mode: 'background', intensity: 42, fade: 0, scope: 'window' })
      expect(document.documentElement.style.getPropertyValue('--translucency-glass-keep')).toBe('58%')
      setTranslucencyMode('clear')
      expect($translucency.get().intensity).toBe(0)
      expect(document.documentElement.hasAttribute('data-hermes-glass')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
