import * as React from "react"
import { Check } from "lucide-react"
import { cn } from "../../lib/utils"

export interface CheckboxProps {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  id?: string
  disabled?: boolean
  className?: string
}

const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ checked, onCheckedChange, id, disabled, className }, ref) => (
    <button
      ref={ref}
      id={id}
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      className={cn(
        "shrink-0 inline-flex items-center justify-center",
        "w-4 h-4 rounded-[4px] border transition-colors duration-150 outline-none cursor-pointer p-0",
        checked
          ? "bg-(--accent) border-(--accent) text-white"
          : "bg-transparent border-(--border) hover:border-(--border-hover)",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      {checked && <Check className="w-3 h-3" strokeWidth={3} />}
    </button>
  ),
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
