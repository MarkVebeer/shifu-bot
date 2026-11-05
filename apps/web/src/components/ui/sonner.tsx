import { CheckCircle, CircleNotch, Info, Warning, XCircle } from "@phosphor-icons/react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { dashboardTheme, dashboardRadii } from "@shifubot/shared"

// shadcn/ui's sonner, without next-themes: the dashboard is always dark and
// takes its colors from the design tokens instead of CSS variables.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      icons={{
        success: <CheckCircle className="size-4" />,
        info: <Info className="size-4" />,
        warning: <Warning className="size-4" />,
        error: <XCircle className="size-4" />,
        loading: <CircleNotch className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": dashboardTheme.popover,
          "--normal-text": dashboardTheme.popoverForeground,
          "--normal-border": dashboardTheme.border,
          "--border-radius": dashboardRadii.lg,
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
