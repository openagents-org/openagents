import * as React from "react"
import { Search, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@renderer/components/shadcn/input-group"

export interface SearchInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** When provided and the field is non-empty, renders a clear button. */
  onClear?: () => void
  /** Applied to the wrapper, so callers can size the whole control. */
  wrapperClassName?: string
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, wrapperClassName, value, onClear, ...props }, ref) => {
    const { t } = useTranslation()

    return (
      <InputGroup className={wrapperClassName}>
        <InputGroupAddon align="inline-start">
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          ref={ref}
          // Deliberately `text`, not `search`: WebKit paints its own cancel
          // button on search inputs, which would sit next to ours.
          type="text"
          value={value}
          className={className}
          {...props}
        />
        {value && onClear && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              tabIndex={-1}
              onClick={onClear}
              aria-label={t("ui.searchInput.clear")}
            >
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
    )
  },
)
SearchInput.displayName = "SearchInput"
