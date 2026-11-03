import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { showGlobalToast } from '@renderer/hooks/useToast'
import Markdown from './Markdown'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/hooks/useToast', () => ({ showGlobalToast: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => true) })
})
it('copies a code block with the available fallback', async () => {
  render(<Markdown source={'```text\ntest text\n```'} />)
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('chat.markdown.copied'))
  expect(document.execCommand).toHaveBeenCalledWith('copy')
})
it('shows a failure instead of silently discarding it', async () => {
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) })
  render(<Markdown source={'```text\ntest text\n```'} />)
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(showGlobalToast).toHaveBeenCalledWith(expect.any(String), 'error'))
  expect(screen.getByRole('button')).toHaveTextContent('chat.markdown.copy')
})
it('clears earlier success when a subsequent copy fails', async () => {
  render(<Markdown source={'```text\ntest text\n```'} />)
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('chat.markdown.copied'))
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) })
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(showGlobalToast).toHaveBeenCalledWith(expect.any(String), 'error'))
  expect(screen.getByRole('button')).toHaveTextContent('chat.markdown.copy')
})
