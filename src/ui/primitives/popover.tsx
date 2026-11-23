'use client';

import * as React from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from '@/ui/cn';

function Popover(props: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

// The popup's ground: the theme's glass (the default), or the opaque elevated surface for a popup
// over dense text. tokens.css draws both from `data-surface`.
type PopoverSurface = 'glass' | 'elevated';

function PopoverContent({
  className,
  surface = 'glass',
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, 'side' | 'align' | 'sideOffset'> & {
    surface?: PopoverSurface;
  }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        data-slot="popover-positioner"
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          data-surface={surface}
          className={cn(
            'w-72 max-w-[calc(100vw-1rem)] rounded-xl bg-popover p-3 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverClose(props: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

export { Popover, PopoverClose, PopoverContent, PopoverTrigger };
