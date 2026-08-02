import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "../ui/input"

interface MarketplaceSearchProps {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  debounceMs?: number
}

/**
 * Debounced search input — keeps keystrokes off the heavy filter/sort
 * pipeline that scans the entire catalog. 180ms is the legacy renderer's
 * effective rate (it filtered directly in the input handler but with a
 * tiny catalog; debounce here mirrors that perceptually).
 */
export function MarketplaceSearch({
  value,
  onChange,
  placeholder,
  debounceMs = 180,
}: MarketplaceSearchProps): React.JSX.Element {
  const { t } = useTranslation()
  const [local, setLocal] = useState(value)

  // Reset local when the parent re-syncs (e.g. clearing search externally).
  useEffect(() => { setLocal(value) }, [value])

  useEffect(() => {
    if (local === value) return
    const id = window.setTimeout(() => onChange(local), debounceMs)
    return () => window.clearTimeout(id)
  }, [local, debounceMs, value, onChange])

  return (
    <Input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      placeholder={placeholder ?? t("install.search.placeholder")}
    />
  )
}
