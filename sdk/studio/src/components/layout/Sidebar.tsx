import React from "react"
import { SidebarPrimary } from "./components/sidebar-primary"
import { cn } from "@/lib/utils"

// Simplified Sidebar Props - only includes basic UI state, no business data
interface SidebarProps {
  // Basic UI state - if needed
  className?: string
}

const Sidebar: React.FC<SidebarProps> = ({ className }) => {
  return (
    <aside
      className={cn(
        "relative overflow-hidden transition-all duration-300 flex items-stretch flex-shrink-0 h-full",
        "w-[var(--sidebar-collapsed-width)]",
        className
      )}
    >
      <SidebarPrimary />
    </aside>
  )
}

export default Sidebar
