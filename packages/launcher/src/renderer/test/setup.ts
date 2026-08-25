import "@testing-library/jest-dom/vitest"
import "../i18n"
import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

/**
 * Node 26 ships its own global `localStorage`, and it is `undefined` unless the
 * process was started with `--localstorage-file`. That global wins over jsdom's,
 * so every test that so much as calls `localStorage.clear()` in a `beforeEach`
 * died on "Cannot read properties of undefined". Give the suite a real one.
 *
 * Per test file, like jsdom's own — the setup file runs once per environment.
 */
function installStorage(name: "localStorage" | "sessionStorage"): void {
  if ((globalThis as Record<string, unknown>)[name]) return
  const store = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => [...store.keys()][i] ?? null,
    removeItem: (k) => {
      store.delete(k)
    },
    setItem: (k, v) => {
      store.set(String(k), String(v))
    },
  }
  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
    writable: true,
  })
}
installStorage("localStorage")
installStorage("sessionStorage")

afterEach(() => {
  cleanup()
})
