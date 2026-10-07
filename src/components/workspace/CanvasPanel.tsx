import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  ArrowUp,
  Crosshair,
  ImagePlus,
  ScanLine,
  Maximize2,
  Minimize2,
  MousePointer2,
  ZoomIn,
  Columns2,
  SquareDashed,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  clampBox,
  padBox,
  fitFrame,
  markerColor,
  type Marker,
  type Box,
  type CanvasTool,
  type Selection,
} from "@/lib/workspace";

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
  fullView: boolean;
  onFullView: () => void;
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
  comparisons: Selection[];
  zoomBox: Box | null;
  onEscape: () => void;
  onRegion: (box: Box, question: string) => void;
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
  fullView,
  onFullView,
  tool,
  onTool,
  comparisons,
  zoomBox,
  onEscape,
  onRegion,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<ReturnType<typeof fitFrame> | null>(null);
  const [boxes, setBoxes] = useState(true);
  const [draft, setDraft] = useState<Box | null>(null);
  const [regionQuestion, setRegionQuestion] = useState("");
  const [drawing, setDrawing] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancelDraw = useCallback(() => {
    start.current = null;
    setDrawing(false);
    setDraft(null);
    setRegionQuestion("");
  }, []);
  useEffect(() => {
    cancelDraw();
  }, [tool, cancelDraw]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelDraw();
        if (!draft && !drawing) onEscape();
        return;
      }
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target instanceof Element &&
          event.target.closest("input, textarea, select, [contenteditable='true']"))
      )
        return;
      const shortcuts: Record<string, CanvasTool> = {
        v: "select",
        z: "focus",
        c: "compare",
        r: "draw",
      };
      const next = shortcuts[event.key.toLowerCase()];
      if (next) {
        event.preventDefault();
        onTool(next);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [cancelDraw, onEscape, onTool, draft, drawing]);
  const padded = zoomBox ? padBox(zoomBox) : null;
  const scale =
    padded && frame && host.current
      ? Math.max(
          1,
          Math.min(
            host.current.clientWidth / (padded.w * frame.width),
            host.current.clientHeight / (padded.h * frame.height),
          ),
        )
      : 1;
  const tx =
    padded && frame && host.current
      ? host.current.clientWidth / 2 -
        (frame.left + (padded.x + padded.w / 2) * frame.width) * scale
      : 0;
  const ty =
    padded && frame && host.current
      ? host.current.clientHeight / 2 -
        (frame.top + (padded.y + padded.h / 2) * frame.height) * scale
      : 0;
  const imagePoint = (clientX: number, clientY: number, clamp = false) => {
    if (!frame || !host.current || !frame.width || !frame.height) return null;
    const rect = host.current.getBoundingClientRect();
    let x = ((clientX - rect.left - tx) / scale - frame.left) / frame.width;
    let y = ((clientY - rect.top - ty) / scale - frame.top) / frame.height;
    if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
    return { x, y };
  };
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
      <div
        role="toolbar"
        aria-label="Canvas tools"
        className="canvas-tool-dock absolute left-3 top-3 z-20 flex rounded-lg border border-border bg-canvas/90 p-0.5"
      >
        {(
          [
            ["select", "Pointer", "V", MousePointer2],
            ["focus", "Focus Zoom", "Z", ZoomIn],
            ["compare", "Compare", "C", Columns2],
            ["draw", "Draw Box", "R", SquareDashed],
          ] as const
        ).map(([mode, label, key, Icon]) => (
          <Button
            key={mode}
            variant="ghost"
            size="icon"
            className={`size-8 rounded-md ${tool === mode ? "bg-muted text-primary" : "text-muted-foreground"}`}
            aria-label={`${label} (${key})`}
            aria-keyshortcuts={key}
            aria-pressed={tool === mode}
            title={`${label} (${key})`}
            onClick={() => onTool(mode)}
          >
            <Icon />
          </Button>
        ))}
      </div>
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg bg-canvas/90">
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={fullView ? "Exit full view" : "Full view"}
            title={fullView ? "Exit full view" : "Full view"}
            onClick={onFullView}
          >
            {fullView ? <Minimize2 /> : <Maximize2 />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
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
            className="size-8"
            aria-label="Recenter photo"
            title="Recenter photo"
            onClick={() => {
              cancelDraw();
              update();
              onRecenter();
            }}
          >
            <Crosshair />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
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
        className={`canvas-image-stage absolute inset-x-3 bottom-3 top-14 overflow-hidden ${tool === "draw" ? "cursor-crosshair touch-none" : ""}`}
        onPointerDown={(event) => {
          if (tool !== "draw" || draft || event.button !== 0) return;
          const point = imagePoint(event.clientX, event.clientY);
          if (!point) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          start.current = point;
          setDrawing(true);
          setDraft({ ...point, w: 0, h: 0 });
        }}
        onPointerMove={(event) => {
          if (!start.current || !drawing) return;
          const point = imagePoint(event.clientX, event.clientY, true);
          if (!point) return;
          setDraft({
            x: Math.min(point.x, start.current.x),
            y: Math.min(point.y, start.current.y),
            w: Math.abs(point.x - start.current.x),
            h: Math.abs(point.y - start.current.y),
          });
        }}
        onPointerUp={(event) => {
          if (!start.current || !drawing) return;
          const point = imagePoint(event.clientX, event.clientY, true),
            origin = start.current;
          start.current = null;
          setDrawing(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          if (
            !point ||
            Math.abs(point.x - origin.x) < 0.005 ||
            Math.abs(point.y - origin.y) < 0.005
          ) {
            setDraft(null);
            return;
          }
          setDraft(
            clampBox({
              x: Math.min(origin.x, point.x),
              y: Math.min(origin.y, point.y),
              w: Math.abs(point.x - origin.x),
              h: Math.abs(point.y - origin.y),
            }),
          );
        }}
        onPointerCancel={cancelDraw}
        onClick={(event) => {
          if (tool === "draw") return;
          const point = imagePoint(event.clientX, event.clientY);
          if (point) onTap(point.x, point.y);
        }}
      >
        <div
          data-testid="zoom-layer"
          className="canvas-zoom absolute inset-0"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "0 0",
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
                  color: markerColor(marker.label),
                  left: frame.left + marker.box.x * frame.width,
                  top: frame.top + marker.box.y * frame.height,
                  width: marker.box.w * frame.width,
                  height: marker.box.h * frame.height,
                }}
              >
                {boxes && (
                  <div
                    className={`object-box absolute inset-0 ${highlighted === marker.key ? "is-highlighted" : ""} ${comparisons.some((item) => item.key === marker.key) ? "is-comparing" : ""}`}
                    style={{
                      borderWidth:
                        (highlighted === marker.key ||
                        comparisons.some((item) => item.key === marker.key)
                          ? 3
                          : 2) / scale,
                      ...(comparisons.some((item) => item.key === marker.key)
                        ? {
                            boxShadow: `0 0 0 ${2 / scale}px var(--canvas), 0 0 0 ${4 / scale}px currentColor`,
                          }
                        : {}),
                    }}
                  />
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  data-marker={marker.key}
                  className="object-pin pointer-events-auto absolute left-0 top-0 size-6 rounded-md text-[10px]"
                  style={{
                    color: "var(--canvas)",
                    backgroundColor: markerColor(marker.label),
                    transform: `scale(${1 / scale})`,
                    transformOrigin: "0 0",
                  }}
                  aria-label={`Target ${marker.number}: ${marker.label}`}
                  title={marker.label}
                  tabIndex={tool === "draw" ? -1 : 0}
                  aria-pressed={comparisons.some((item) => item.key === marker.key)}
                  onPointerDown={(event) => {
                    if (tool !== "draw") event.stopPropagation();
                  }}
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
                  {comparisons.some((item) => item.key === marker.key) && (
                    <span className="comparison-badge absolute -right-2 -top-2 rounded-full bg-background px-1 text-[9px] text-primary">
                      {comparisons.findIndex((item) => item.key === marker.key) + 1}
                    </span>
                  )}
                </Button>
              </div>
            ))}
          {draft && frame && (
            <div
              data-testid="drawn-region"
              className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/5"
              style={{
                borderWidth: 2 / scale,
                left: frame.left + draft.x * frame.width,
                top: frame.top + draft.y * frame.height,
                width: draft.w * frame.width,
                height: draft.h * frame.height,
              }}
            />
          )}
        </div>
        {draft && !drawing && frame && (
          <form
            aria-label="Ask about drawn area"
            className="absolute z-30 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-background p-2 shadow-lg"
            style={{
              width: Math.min(320, host.current?.clientWidth ?? 320),
              left: Math.max(
                0,
                Math.min(
                  tx + (frame.left + draft.x * frame.width) * scale,
                  (host.current?.clientWidth ?? 320) - 320,
                ),
              ),
              top: Math.max(
                0,
                Math.min(
                  ty + (frame.top + (draft.y + draft.h) * frame.height) * scale + 8,
                  (host.current?.clientHeight ?? 100) - 100,
                ),
              ),
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              if (!regionQuestion.trim()) return;
              onRegion(draft, regionQuestion.trim());
              cancelDraw();
            }}
          >
            <input
              autoFocus
              aria-label="Ask about this area"
              placeholder="Ask about this area..."
              maxLength={1000}
              value={regionQuestion}
              onChange={(event) => setRegionQuestion(event.target.value)}
              className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm outline-none"
            />
            <Button
              type="submit"
              size="icon"
              className="size-7 rounded-full"
              aria-label="Submit area question"
              disabled={!regionQuestion.trim()}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Cancel drawn area"
              onClick={cancelDraw}
            >
              <X />
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
