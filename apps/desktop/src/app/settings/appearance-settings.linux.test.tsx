// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: { glassSupported: false, translucencySupported: true, backgroundTransparencySupported: true }
  })
})

import { $translucency } from '@/store/translucency'

import { AppearanceSettings } from './appearance-settings'

afterEach(cleanup)

it('offers deliberate background-only transparency without native frost or text fade', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AppearanceSettings subpage="window-layout" />
    </QueryClientProvider>
  )
  const toggle = screen.getByRole('switch', { name: 'Background transparency' })
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  fireEvent.click(toggle)
  expect($translucency.get().mode).toBe('background')
  expect(screen.getByRole('slider', { name: 'Tint' })).toBeTruthy()
  expect(screen.queryByText('Frost')).toBeNull()
  expect(screen.queryByText('Fade')).toBeNull()
  expect(screen.getByText(/compositor/i)).toBeTruthy()
})
