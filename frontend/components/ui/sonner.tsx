import { useResolvedTheme } from "@/app/stores/theme-store"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Loading03Icon,
  MultiplicationSignCircleIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useResolvedTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" />
        ),
        info: (
          <HugeiconsIcon icon={InformationCircleIcon} className="size-4" />
        ),
        warning: (
          <HugeiconsIcon icon={Alert02Icon} className="size-4" />
        ),
        error: (
          <HugeiconsIcon icon={MultiplicationSignCircleIcon} className="size-4" />
        ),
        loading: (
          <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          // Messages often name topics, which can be long and have no spaces to wrap at.
          title: "[overflow-wrap:anywhere]",
          description: "[overflow-wrap:anywhere]",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
