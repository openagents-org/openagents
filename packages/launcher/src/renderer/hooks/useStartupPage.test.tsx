import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useStartupPage } from './useStartupPage'
import { useUiStore } from '../store/ui'

beforeEach(() => {
  localStorage.clear()
  useUiStore.setState({ currentTab: 'dashboard' })
})

it('reads the previous local tab before asynchronous settings can overwrite it', async () => {
  localStorage.setItem('launcher:last-tab', 'logs')
  let resolve!: (value: unknown) => void
  window.api = { getSetting: vi.fn(() => new Promise(r => { resolve = r })) } as unknown as typeof window.api
  renderHook(useStartupPage)
  expect(localStorage.getItem('launcher:last-tab')).toBe('logs')
  await act(async () => resolve('last'))
  await waitFor(() => expect(useUiStore.getState().currentTab).toBe('logs'))
})

it('does not replace a navigation the user made while settings loaded', async () => {
  let resolve!: (value: unknown) => void
  window.api = { getSetting: vi.fn(() => new Promise(r => { resolve = r })) } as unknown as typeof window.api
  renderHook(useStartupPage)
  act(() => useUiStore.getState().setCurrentTab('install'))
  await act(async () => resolve('logs'))
  expect(useUiStore.getState().currentTab).toBe('install')
})

it('opens This Computer when a saved page no longer exists', async () => {
  localStorage.setItem('launcher:last-tab', 'removed-page')
  window.api = { getSetting: vi.fn().mockResolvedValue('last') } as unknown as typeof window.api
  renderHook(useStartupPage)
  await waitFor(() => expect(useUiStore.getState().currentTab).toBe('dashboard'))
})

it('sends the retired Agents page to This Computer, where the agents are', async () => {
  localStorage.setItem('launcher:last-tab', 'agents')
  window.api = { getSetting: vi.fn().mockResolvedValue('last') } as unknown as typeof window.api
  renderHook(useStartupPage)
  await waitFor(() => expect(useUiStore.getState().currentTab).toBe('dashboard'))
  act(() => useUiStore.getState().setCurrentTab('agents'))
  expect(useUiStore.getState().currentTab).toBe('dashboard')
})
