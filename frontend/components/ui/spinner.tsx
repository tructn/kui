import { cn } from "@/lib/utils"
import { Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react"

function Spinner({ className, ...props }: Omit<HugeiconsIconProps, "icon">) {
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
