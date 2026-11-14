import { describe, expect, it } from 'vitest'

import { applyChatWindowBacking, normalizeState, windowBackingOptions, windowOpacityOptions } from './translucency'

describe('Linux chat window backing', () => {
  it('keeps the live backing transparent on disable, theme changes, and stale imported clear settings', () => {
    const painted: string[] = []
    const win = { setBackgroundColor: (color: string) => painted.push(color) }

    for (const payload of [{ mode: 'background', intensity: 60 }, { mode: 'clear', intensity: 80 }, null]) {
      applyChatWindowBacking(win, normalizeState(payload, false, true), '#fefefe', 'linux')
    }

    expect(painted).toEqual(['#00000000', '#00000000', '#00000000'])
  })
  it('constructs alpha-backed primary and secondary chat surfaces even before opt-in, without fading content', () => {
    for (const saved of [
      null,
      { mode: 'clear', intensity: 80 },
      { mode: 'glass', intensity: 60, fade: 100 },
      { mode: 'background', intensity: 60, fade: 100 }
    ]) {
      const state = normalizeState(saved, false, true)
      const options = { ...windowOpacityOptions(state, false), ...windowBackingOptions(state, '#101014', 'linux') }
      expect(options).toEqual({ transparent: true, backgroundColor: '#00000000', opacity: 1 })
      expect(state.fade).toBe(0)
      expect(state.intensity).toBe(saved?.mode === 'background' ? 60 : 0)
    }
  })
})
