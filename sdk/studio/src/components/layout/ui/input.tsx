import * as React from "react"
import { cn } from "@/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"

// Define input size variants
const inputVariants = cva(
  `
    flex w-full bg-white dark:bg-zinc-950 border border-gray-300 dark:border-gray-500 shadow-xs shadow-black/5 transition-[color,box-shadow] text-gray-900 dark:text-gray-50 placeholder:text-gray-400 dark:placeholder:text-gray-400
    focus-visible:ring-blue-500/30 dark:focus-visible:ring-blue-400/30 focus-visible:border-blue-500 dark:focus-visible:border-blue-400 focus-visible:outline-none focus-visible:ring-[3px]
    disabled:cursor-not-allowed disabled:opacity-60
    [&[readonly]]:bg-gray-100 dark:[&[readonly]]:bg-zinc-900 [&[readonly]]:cursor-not-allowed
    file:h-full [&[type=file]]:py-0 file:border-solid file:border-gray-300 dark:file:border-gray-500 file:bg-transparent
    file:font-medium file:not-italic file:text-gray-900 dark:file:text-gray-50 file:p-0 file:border-0 file:border-e
    aria-invalid:border-red-500/60 aria-invalid:ring-red-500/10 dark:aria-invalid:border-red-400 dark:aria-invalid:ring-red-400/20
  `,
  {
    variants: {
      variant: {
        lg: "h-10 px-4 text-sm rounded-md file:pe-4 file:me-4",
        md: "h-8.5 px-3 text-[0.8125rem] leading-(--text-sm--line-height) rounded-md file:pe-3 file:me-3",
        sm: "h-7 px-2.5 text-xs rounded-md file:pe-2.5 file:me-2.5",
      },
    },
    defaultVariants: {
      variant: "lg",
    },
  }
)

const inputAddonVariants = cva(
  "flex items-center shrink-0 justify-center bg-muted border border-input shadow-xs shadow-[rgba(0,0,0,0.05)] text-secondary-foreground [&_svg]:text-secondary-foreground/60",
  {
    variants: {
      variant: {
        sm: "rounded-md h-7 min-w-7 text-xs px-2.5 [&_svg:not([class*=size-])]:size-3.5",
        md: "rounded-md h-8.5 min-w-8.5 px-3 text-[0.8125rem] leading-(--text-sm--line-height) [&_svg:not([class*=size-])]:size-4.5",
        lg: "rounded-md h-10 min-w-10 px-4 text-sm [&_svg:not([class*=size-])]:size-4.5",
      },
      mode: {
        default: "",
        icon: "px-0 justify-center",
      },
    },
    defaultVariants: {
      variant: "lg",
      mode: "default",
    },
  }
)

const inputGroupVariants = cva(
  `
    flex items-stretch
    [&_[data-slot=input]]:grow
    [&_[data-slot=input-addon]:has(+[data-slot=input])]:rounded-e-none [&_[data-slot=input-addon]:has(+[data-slot=input])]:border-e-0
    [&_[data-slot=input-addon]:has(+[data-slot=datefield])]:rounded-e-none [&_[data-slot=input-addon]:has(+[data-slot=datefield])]:border-e-0 
    [&_[data-slot=input]+[data-slot=input-addon]]:rounded-s-none [&_[data-slot=input]+[data-slot=input-addon]]:border-s-0
    [&_[data-slot=input-addon]:has(+[data-slot=button])]:rounded-e-none
    [&_[data-slot=input]+[data-slot=button]]:rounded-s-none
    [&_[data-slot=button]+[data-slot=input]]:rounded-s-none
    [&_[data-slot=input-addon]+[data-slot=input]]:rounded-s-none
    [&_[data-slot=input-addon]+[data-slot=datefield]]:[&_[data-slot=input]]:rounded-s-none
    [&_[data-slot=datefield]:has(+[data-slot=input-addon])]:[&_[data-slot=input]]:rounded-e-none
    [&_[data-slot=input]:has(+[data-slot=button])]:rounded-e-none
    [&_[data-slot=input]:has(+[data-slot=input-addon])]:rounded-e-none
    [&_[data-slot=datefield]]:grow
    [&_[data-slot=datefield]+[data-slot=input-addon]]:rounded-s-none [&_[data-slot=datefield]+[data-slot=input-addon]]:border-s-0
  `,
  {
    variants: {},
    defaultVariants: {},
  }
)

const inputWrapperVariants = cva(
  `
    flex items-center gap-1.5
    has-[:focus-visible]:ring-ring/30 
    has-[:focus-visible]:border-ring
    has-[:focus-visible]:outline-none 
    has-[:focus-visible]:ring-[3px]

    [&_[data-slot=datefield]]:grow 
    [&_[data-slot=input]]:data-focus-within:ring-transparent  
    [&_[data-slot=input]]:data-focus-within:ring-0 
    [&_[data-slot=input]]:data-focus-within:border-0 
    [&_[data-slot=input]]:flex 
    [&_[data-slot=input]]:w-full 
    [&_[data-slot=input]]:outline-none 
    [&_[data-slot=input]]:transition-colors 
    [&_[data-slot=input]]:text-foreground
    [&_[data-slot=input]]:placeholder:text-muted-foreground 
    [&_[data-slot=input]]:border-0 
    [&_[data-slot=input]]:bg-transparent 
    [&_[data-slot=input]]:p-0
    [&_[data-slot=input]]:shadow-none 
    [&_[data-slot=input]]:focus-visible:ring-0 
    [&_[data-slot=input]]:h-auto 
    [&_[data-slot=input]]:disabled:cursor-not-allowed
    [&_[data-slot=input]]:disabled:opacity-50    

    [&_svg]:text-muted-foreground 
    [&_svg]:shrink-0
  `,
  {
    variants: {
      variant: {
        sm: "gap-1.25 [&_svg:not([class*=size-])]:size-3.5",
        md: "gap-1.5 [&_svg:not([class*=size-])]:size-4",
        lg: "gap-1.5 [&_svg:not([class*=size-])]:size-4",
      },
    },
    defaultVariants: {
      variant: "lg",
    },
  }
)

function Input({
  className,
  type,
  variant,
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(inputVariants({ variant }), className)}
      {...props}
    />
  )
}

function InputAddon({
  className,
  variant,
  mode,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputAddonVariants>) {
  return (
    <div
      data-slot="input-addon"
      className={cn(inputAddonVariants({ variant, mode }), className)}
      {...props}
    />
  )
}

function InputGroup({
  className,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupVariants>) {
  return (
    <div
      data-slot="input-group"
      className={cn(inputGroupVariants(), className)}
      {...props}
    />
  )
}

function InputWrapper({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputWrapperVariants>) {
  return (
    <div
      data-slot="input-wrapper"
      className={cn(
        inputVariants({ variant }),
        inputWrapperVariants({ variant }),
        className
      )}
      {...props}
    />
  )
}

export {
  Input,
  InputAddon,
  InputGroup,
  InputWrapper,
  inputVariants,
  inputAddonVariants,
}
