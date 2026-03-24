import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

function Progress({
  className,
  value,
  indeterminate,
  ...props
}: React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { indeterminate?: boolean }) {
  return (
    <ProgressPrimitive.Root
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "h-full bg-foreground/30 rounded-full",
          indeterminate ? "animate-progress-indeterminate" : "transition-all",
        )}
        style={indeterminate ? { width: '40%' } : { width: `${value || 0}%` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
