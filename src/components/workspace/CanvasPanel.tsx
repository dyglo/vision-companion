import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Crosshair, ImagePlus, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fitFrame, type Marker } from "@/lib/workspace";

type Props = {
  src: string;
  imageRef: RefObject<HTMLImageElement | null>;
  markers: Marker[];
  highlighted: string | null;
  onHighlight: (key: string | null) => void;
  onMarker: (marker: Marker) => void;
  onTap: (x: number, y: number) => void;
  onLoad: () => void;
  onNew: () => void;
  onRecenter: () => void;
};
export function CanvasPanel({
  src,
  imageRef,
  markers,
  highlighted,
  onHighlight,
  onMarker,
  onTap,
  onLoad,
  onNew,
  onRecenter,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<ReturnType<typeof fitFrame> | null>(null);
  const [boxes, setBoxes] = useState(true);
  const update = useCallback(() => {
    const image = imageRef.current,
      container = host.current;
    if (image?.naturalWidth && container)
      setFrame(
        fitFrame(
          container.clientWidth,
          container.clientHeight,
          image.naturalWidth,
          image.naturalHeight,
        ),
      );
  }, [imageRef]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [src, update]);
  return (
    <section aria-label="Photo canvas" className="canvas-panel relative min-h-0 min-w-0 bg-canvas">
      <div className="absolute inset-x-0 top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-2 bg-canvas">
        <span className="truncate text-xs text-muted-foreground">Photo workspace</span>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            aria-label="Toggle boxes"
            aria-pressed={boxes}
            title="Toggle boxes"
            onClick={() => setBoxes((v) => !v)}
          >
            <ScanLine />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            aria-label="Recenter photo"
            title="Recenter photo"
            onClick={() => {
              update();
              onRecenter();
            }}
          >
            <Crosshair />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            aria-label="Change photo"
            title="Change photo"
            onClick={onNew}
          >
            <ImagePlus />
          </Button>
        </div>
      </div>
      <div
        ref={host}
        data-testid="image-stage"
        className="absolute inset-x-3 bottom-3 top-16 overflow-hidden"
        onClick={(event) => {
          if (!frame || !host.current) return;
          const rect = host.current.getBoundingClientRect();
          const x = (event.clientX - rect.left - frame.left) / frame.width,
            y = (event.clientY - rect.top - frame.top) / frame.height;
          if (x >= 0 && y >= 0 && x <= 1 && y <= 1) onTap(x, y);
        }}
      >
        <img
          ref={imageRef}
          src={src}
          alt="Your photo"
          className="h-full w-full object-contain"
          onLoad={() => {
            update();
            onLoad();
          }}
        />
        {frame &&
          markers.map((marker) => (
            <div
              key={marker.key}
              className="pointer-events-none absolute"
              style={{
                left: frame.left + marker.box.x * frame.width,
                top: frame.top + marker.box.y * frame.height,
                width: marker.box.w * frame.width,
                height: marker.box.h * frame.height,
              }}
            >
              {boxes && (
                <div
                  className={`absolute inset-0 border ${highlighted === marker.key ? "border-primary border-2 bg-primary/10" : "border-primary/50"}`}
                />
              )}
              <Button
                variant="default"
                size="icon"
                data-marker={marker.key}
                className={`pointer-events-auto absolute left-0 top-0 min-h-11 min-w-11 rounded-full ${highlighted === marker.key ? "ring-2 ring-ring ring-offset-2 ring-offset-canvas" : ""}`}
                aria-label={`Target ${marker.number}: ${marker.label}`}
                title={marker.label}
                onClick={(event) => {
                  event.stopPropagation();
                  onMarker(marker);
                }}
                onMouseEnter={() => onHighlight(marker.key)}
                onMouseLeave={() => onHighlight(null)}
                onFocus={() => onHighlight(marker.key)}
                onBlur={() => onHighlight(null)}
              >
                {marker.number}
              </Button>
            </div>
          ))}
      </div>
    </section>
  );
}
