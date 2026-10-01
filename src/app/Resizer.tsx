import { useRef } from "preact/hooks";

export const DETAIL_MIN = 320;
export const DETAIL_DEFAULT = 440;

type Props = { width: number; onChange: (w: number) => void; onCommit: (w: number) => void };

/** Draggable divider on the left edge of the detail panel. Pointer + keyboard + double-click reset. */
export function Resizer({ width, onChange, onCommit }: Props) {
  const drag = useRef<{ right: number; max: number } | null>(null);
  const clamp = (w: number, max: number) => Math.round(Math.min(max, Math.max(DETAIL_MIN, w)));
  const maxFor = (container: number) => Math.max(DETAIL_MIN, Math.min(920, container - 360));

  return (
    <div
      class="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize details panel"
      aria-valuenow={width}
      aria-valuemin={DETAIL_MIN}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        const main = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
        drag.current = { right: main.right, max: maxFor(main.width) };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        document.body.classList.add("resizing");
      }}
      onPointerMove={(e) => {
        if (drag.current) onChange(clamp(drag.current.right - e.clientX, drag.current.max));
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        const w = clamp(drag.current.right - e.clientX, drag.current.max);
        drag.current = null;
        document.body.classList.remove("resizing");
        onChange(w);
        onCommit(w);
      }}
      onDblClick={() => {
        onChange(DETAIL_DEFAULT);
        onCommit(DETAIL_DEFAULT);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 80 : 24;
        const dir = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const max = maxFor((e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect().width);
        const w = clamp(width + dir * step, max);
        onChange(w);
        onCommit(w);
      }}
    />
  );
}
