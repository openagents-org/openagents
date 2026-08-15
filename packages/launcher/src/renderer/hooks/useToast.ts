import { useCallback } from 'react'
import { toast } from 'sonner'
import { useUiStore } from '../store/ui'

export type ToastType = 'info' | 'success' | 'error' | 'warning'

// Errors and warnings tend to carry detail worth reading (a wrapped npm
// failure, a reason a connection was refused); four seconds is not enough to
// finish one. Successes are acknowledgements and can leave quickly.
const DURATION_MS: Record<ToastType, number> = {
  success: 4000,
  info: 4000,
  warning: 8000,
  error: 10000,
}

function fireToast(message: string, type: ToastType): void {
  toast[type](message, { duration: DURATION_MS[type] })
}

export function showGlobalToast(message: string, type: ToastType = 'info'): void {
  fireToast(message, type)
  useUiStore.getState().addActivity(message)
}

export function useToasts(): { showToast: (message: string, type?: ToastType) => void } {
  const addActivity = useUiStore((s) => s.addActivity)

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      fireToast(message, type)
      addActivity(message)
    },
    [addActivity],
  )

  return { showToast }
}
