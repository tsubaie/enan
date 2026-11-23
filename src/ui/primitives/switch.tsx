'use client';
import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from '@/ui/cn';
// An on/off setting that takes effect at once (role="switch"): a capsule track with a thumb that
// moves to the inline end when on, so it reads the same way in Arabic and English.
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-text-muted/70 p-0.5 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50 pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="block size-5 rounded-full bg-primary-foreground shadow-sm transition-transform data-checked:translate-x-4 rtl:data-checked:-translate-x-4"
      />
    </SwitchPrimitive.Root>
  );
}
export { Switch };
