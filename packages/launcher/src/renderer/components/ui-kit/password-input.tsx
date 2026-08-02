import * as React from "react"
import { Eye, EyeOff } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@renderer/components/shadcn/input-group"

export type PasswordInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  /** Applied to the wrapper, so callers can size the whole control. */
  wrapperClassName?: string
}

/** Password field with a reveal toggle. Secrets stay masked until asked for. */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, wrapperClassName, ...props }, ref) => {
    const { t } = useTranslation()
    const [visible, setVisible] = React.useState(false)
    const Icon = visible ? EyeOff : Eye

    return (
      <InputGroup className={wrapperClassName}>
        <InputGroupInput
          ref={ref}
          type={visible ? "text" : "password"}
          className={className}
          {...props}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            // Keep the toggle out of the tab order: it is a convenience, and
            // stopping on it every time would slow down keyboard form entry.
            tabIndex={-1}
            onClick={() => setVisible((v) => !v)}
            aria-label={
              visible
                ? t("ui.passwordInput.hideValue")
                : t("ui.passwordInput.showValue")
            }
            title={visible ? t("ui.passwordInput.hide") : t("ui.passwordInput.show")}
          >
            <Icon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    )
  },
)
PasswordInput.displayName = "PasswordInput"
