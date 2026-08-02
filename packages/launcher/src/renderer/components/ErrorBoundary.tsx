import React from "react"
import { withTranslation, type WithTranslation } from "react-i18next"

interface State {
  error: Error | null
}

type ErrorBoundaryProps = { children: React.ReactNode } & WithTranslation

// Error boundaries must be class components, so we can't call the
// `useTranslation` hook here. `withTranslation` injects a `t` prop instead and
// keeps the fallback UI reactive to language changes.
class ErrorBoundaryInner extends React.Component<ErrorBoundaryProps, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("Renderer error:", error, info?.componentStack)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    const { error } = this.state
    const { t } = this.props
    if (!error) return this.props.children
    return (
      <div className="p-8 min-h-screen overflow-auto font-sans text-(--text-primary) bg-(--bg-primary)">
        <h1 className="text-lg mb-3">
          {t("ui.errorBoundary.title")}
        </h1>
        <pre className="p-3 rounded-lg text-xs max-h-120 overflow-auto whitespace-pre-wrap wrap-break-word bg-(--bg-card) border border-(--border)">
          {error.stack || error.message}
        </pre>
        <button
          type="button"
          onClick={this.reset}
          className="mt-3 px-3.5 py-1.5 rounded-md text-[13px] cursor-pointer border-0 bg-(--accent) text-(--accent-text)"
        >
          {t("ui.errorBoundary.tryAgain")}
        </button>
      </div>
    )
  }
}

// The annotation is required, not cosmetic: without it the inferred type of the
// `withTranslation()` HOC reaches into react-i18next's internal `helpers` module,
// which tsc cannot name portably in a composite project (TS2742).
export const ErrorBoundary: React.ComponentType<{ children: React.ReactNode }> =
  withTranslation()(ErrorBoundaryInner)
