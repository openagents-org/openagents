import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (details: Record<string, unknown>, callback: (response: Record<string, unknown>) => void) => void

const listeners = vi.hoisted(() => ({} as Record<string, Listener>))
vi.mock('electron', () => {
  const on = (name: string) => (_filter: unknown, listener: Listener) => { listeners[name] = listener }
  return {
    app: { getAppPath: () => '' },
    protocol: {},
    session: {
      fromPartition: () => ({
        webRequest: {
          onBeforeSendHeaders: on('beforeSend'),
          onHeadersReceived: on('headersReceived'),
          onErrorOccurred: on('error'),
        },
      }),
    },
  }
})
vi.mock('./bootstrap/startup-log', () => ({ slog: vi.fn() }))
import { allowBundleApiAccess } from './workspace-bundle'

const API = 'https://workspace-endpoint.openagents.org'
const WEB = 'https://workspace.openagents.org'

function send(id: number, requestHeaders: Record<string, string>) {
  let result: Record<string, unknown> = {}
  listeners.beforeSend({ id, url: `${API}/v1/account/workspaces`, requestHeaders }, (r) => { result = r })
  return result
}
function receive(id: number, responseHeaders: Record<string, string[]>) {
  let result: Record<string, unknown> = {}
  listeners.headersReceived({ id, responseHeaders }, (r) => { result = r })
  return result
}

beforeEach(() => allowBundleApiAccess(API, WEB))

describe('bundle API bridge', () => {
  it('presents the web origin for the bundle and names the bundle in the reply', () => {
    expect(send(1, { Origin: 'openagents://workspace' })).toEqual({ requestHeaders: { Origin: WEB } })
    expect(receive(1, { 'Access-Control-Allow-Origin': [WEB] })).toEqual({
      responseHeaders: {
        'access-control-allow-origin': ['openagents://workspace'],
        'access-control-allow-credentials': ['true'],
      },
    })
  })

  it('leaves the hosted web app fallback untouched in the same partition', () => {
    expect(send(2, { Origin: WEB })).toEqual({ requestHeaders: { Origin: WEB } })
    expect(receive(2, { 'Access-Control-Allow-Origin': [WEB] })).toEqual({})
  })

  it('does not add an Origin to requests that had none', () => {
    expect(send(3, {})).toEqual({ requestHeaders: {} })
    expect(receive(3, {})).toEqual({})
  })

  it('forgets a bridged request that failed before a reply', () => {
    send(4, { origin: 'openagents://workspace' })
    listeners.error({ id: 4 }, () => {})
    expect(receive(4, {})).toEqual({})
  })
})
