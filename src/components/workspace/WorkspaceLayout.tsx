import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";

type Props = {
  input: ReactNode;
  thread: ReactNode;
  canvas: (fullView: boolean, toggleFullView: () => void) => ReactNode;
  onDrop: (file: File | undefined) => void;
};
export function WorkspaceLayout({ input, thread, canvas, onDrop }: Props) {
  const host = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(24);
  const [height, setHeight] = useState(100);
  const [fullView, setFullView] = useState(false);
  const [dragging, setDragging] = useState(false);
  const resize = (event: PointerEvent<HTMLElement>, both: boolean) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !host.current) return;
    const rect = host.current.getBoundingClientRect();
    if (event.clientX <= rect.left + 24) {
      setFullView(true);
      setDragging(false);
      return;
    }
    setWidth(Math.max(18, Math.min(75, ((event.clientX - rect.left) / rect.width) * 100)));
    if (both)
      setHeight(Math.max(35, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)));
  };
  const start = (event: PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const end = () => setDragging(false);
  return (
    <main
      ref={host}
      className={`workspace ${fullView ? "is-full-view" : ""} ${dragging ? "is-resizing" : ""}`}
      style={{ "--thread-width": `${width}%`, "--artifact-height": `${height}%` } as CSSProperties}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(event.dataTransfer.files?.[0]);
      }}
    >
      {input}
      {thread}
      <div
        role="separator"
        aria-label="Resize conversation and canvas"
        aria-orientation="vertical"
        tabIndex={0}
        aria-valuemin={18}
        aria-valuemax={75}
        aria-valuenow={Math.round(width)}
        className="workspace-divider"
        onPointerDown={start}
        onPointerMove={(event) => resize(event, false)}
        onPointerUp={end}
        onLostPointerCapture={end}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            setWidth((value) =>
              Math.max(18, Math.min(75, value + (event.key === "ArrowLeft" ? -2 : 2))),
            );
          }
          if (event.key === "Home") {
            event.preventDefault();
            setWidth(24);
          }
        }}
      />
      <div className="artifact-container">
        {canvas(fullView, () => setFullView((value) => !value))}
        <div
          role="separator"
          aria-label="Resize artifact width and height"
          aria-valuemin={35}
          aria-valuemax={100}
          aria-valuenow={Math.round(height)}
          aria-valuetext={`${Math.round(width)}% conversation width, ${Math.round(height)}% artifact height`}
          tabIndex={0}
          className="artifact-resize-corner"
          onPointerDown={start}
          onPointerMove={(event) => resize(event, true)}
          onPointerUp={end}
          onLostPointerCapture={end}
          onKeyDown={(event) => {
            if (event.key.startsWith("Arrow")) event.preventDefault();
            if (event.key === "ArrowUp" || event.key === "ArrowDown")
              setHeight((value) =>
                Math.max(35, Math.min(100, value + (event.key === "ArrowUp" ? -3 : 3))),
              );
            if (event.key === "ArrowLeft" || event.key === "ArrowRight")
              setWidth((value) =>
                Math.max(18, Math.min(75, value + (event.key === "ArrowLeft" ? -2 : 2))),
              );
          }}
        />
      </div>
    </main>
  );
}
