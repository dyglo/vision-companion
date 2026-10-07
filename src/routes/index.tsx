import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { detect, type Detection } from "@/lib/detector";
import { askVision } from "@/lib/vision.functions";
import { addMemory, loadMemories } from "@/lib/memory";
import { ThreadPanel } from "@/components/workspace/ThreadPanel";
import { CanvasPanel } from "@/components/workspace/CanvasPanel";
import {
  answerMarkers,
  clampBox,
  relevantPrevious,
  type Box,
  type Marker,
  type Selection,
  type ThreadEntry,
} from "@/lib/workspace";
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lumen — understand everything in a photo" },
      {
        name: "description",
        content:
          "Upload a photo, tap an object or ask about the whole scene, and get clear visual answers.",
      },
      { property: "og:title", content: "Lumen — understand everything in a photo" },
      {
        property: "og:description",
        content:
          "Tap one object or ask Lumen to find and explain everything that matters in a photo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function toDataUrl(img: HTMLImageElement, box: Box | null, max: number) {
  const sx = box ? box.x * img.naturalWidth : 0;
  const sy = box ? box.y * img.naturalHeight : 0;
  const sw = box ? box.w * img.naturalWidth : img.naturalWidth;
  const sh = box ? box.h * img.naturalHeight : img.naturalHeight;
  const scale = Math.min(1, max / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function Index() {
  const [src, setSrc] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [detectorState, setDetectorState] = useState("idle");
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const threadRef = useRef<ThreadEntry[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [activeEntry, setActiveEntry] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const imageRef = useRef<HTMLImageElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const detectionRun = useRef(0);
  const sourceRef = useRef<string | null>(null);
  const attempts = useRef(new Map<string, number>());
  const ask = useServerFn(askVision);
  const changeThread = (fn: (items: ThreadEntry[]) => ThreadEntry[]) => {
    threadRef.current = fn(threadRef.current);
    setThread(threadRef.current);
  };
  const reset = () => {
    generation.current++;
    detectionRun.current++;
    attempts.current.clear();
    if (sourceRef.current) URL.revokeObjectURL(sourceRef.current);
    sourceRef.current = null;
    setSrc(null);
    setDetections([]);
    setDetectorState("idle");
    changeThread(() => []);
    setSelection(null);
    setActiveEntry(null);
    setHighlighted(null);
    setQuestion("");
  };
  const clearResult = () => {
    setSelection(null);
    setActiveEntry(null);
    setHighlighted(null);
  };
  const pick = (file?: File | null) => {
    if (!file?.type.startsWith("image/")) return;
    reset();
    const url = URL.createObjectURL(file);
    sourceRef.current = url;
    setSrc(url);
  };
  useEffect(
    () => () => {
      generation.current++;
      detectionRun.current++;
      if (sourceRef.current) URL.revokeObjectURL(sourceRef.current);
    },
    [],
  );
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () =>
      document.documentElement.style.setProperty(
        "--workspace-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
    update();
    viewport?.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--workspace-height");
    };
  }, []);
  const onLoad = async () => {
    const image = imageRef.current;
    if (!image) return;
    const epoch = generation.current,
      runId = ++detectionRun.current;
    changeThread((items) =>
      items.length ? items : [{ id: crypto.randomUUID(), sender: "assistant", welcome: true }],
    );
    setDetectorState("loading");
    try {
      const found = await detect(image);
      if (epoch !== generation.current || runId !== detectionRun.current) return;
      setDetections(found);
      setDetectorState("ready");
    } catch {
      if (epoch === generation.current && runId === detectionRun.current)
        setDetectorState("failed");
    }
  };
  const run = async (entry: ThreadEntry) => {
    const image = imageRef.current;
    if (!image?.naturalWidth) return;
    const epoch = generation.current,
      attempt = (attempts.current.get(entry.id) ?? 0) + 1;
    attempts.current.set(entry.id, attempt);
    changeThread((items) =>
      items.map((item) =>
        item.id === entry.id ? { ...item, loading: true, error: undefined } : item,
      ),
    );
    try {
      const selected = entry.selection ?? null;
      const result = await ask({
        data: {
          image: toDataUrl(image, null, 1280),
          crop: toDataUrl(image, selected?.box ?? null, selected ? 512 : 1280),
          mode: selected ? "selection" : "scene",
          detectorLabel: selected?.label ?? null,
          detectorScore: selected?.score ?? null,
          detectorCandidates: detections
            .slice(0, 40)
            .map((item, index) => ({ id: index + 1, ...item })),
          question: entry.question ?? null,
          previous: entry.previous ?? null,
          memories: loadMemories()
            .map((memory) => memory.text)
            .slice(0, 50),
        },
      });
      if (epoch !== generation.current || attempts.current.get(entry.id) !== attempt) return;
      const answer = result.answer;
      changeThread((items) =>
        items.map((item) =>
          item.id !== entry.id
            ? item
            : {
                ...item,
                loading: false,
                answer,
                error: result.error ?? (!answer ? "No answer received. Please retry." : undefined),
                memoryState:
                  answer?.suggestedMemory &&
                  !loadMemories().some(
                    (memory) => memory.text.toLowerCase() === answer.suggestedMemory?.toLowerCase(),
                  )
                    ? "offered"
                    : undefined,
              },
        ),
      );
    } catch {
      if (epoch === generation.current && attempts.current.get(entry.id) === attempt)
        changeThread((items) =>
          items.map((item) =>
            item.id === entry.id
              ? { ...item, loading: false, error: "Couldn't reach the assistant. Please retry." }
              : item,
          ),
        );
    }
  };
  const submit = () => {
    const text = question.trim();
    if (!text || !imageRef.current?.naturalWidth) return;
    const entry: ThreadEntry = {
      id: crypto.randomUUID(),
      sender: "assistant",
      question: text,
      selection,
      previous: relevantPrevious(threadRef.current, selection),
      loading: true,
    };
    changeThread((items) => [
      ...items,
      { id: crypto.randomUUID(), sender: "user", question: text, selection },
      entry,
    ]);
    setQuestion("");
    setActiveEntry(entry.id);
    void run(entry);
  };
  const activate = (entry: ThreadEntry) => {
    if (entry.sender !== "assistant" || entry.welcome) return;
    setActiveEntry(entry.id);
    setSelection(entry.selection ?? null);
  };
  const selectMarker = (marker: Marker) => {
    const selected: Selection = {
      key: marker.key,
      number: marker.number,
      box: marker.box,
      label: marker.label,
      score: marker.score,
    };
    setSelection(selected);
    setHighlighted(marker.key);
    if (marker.entryId) {
      setActiveEntry(marker.entryId);
      return;
    }
    const existing = [...threadRef.current]
      .reverse()
      .find((item) => item.sender === "assistant" && item.selection?.key === marker.key);
    if (existing) {
      setActiveEntry(existing.id);
      return;
    }
    const entry: ThreadEntry = {
      id: crypto.randomUUID(),
      sender: "assistant",
      selection: selected,
      loading: true,
    };
    changeThread((items) => [...items, entry]);
    setActiveEntry(entry.id);
    void run(entry);
  };
  const onTap = (x: number, y: number) => {
    const candidates = detections
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h,
      )
      .sort((a, b) => a.item.w * a.item.h - b.item.w * b.item.h);
    const hit = candidates[0];
    selectMarker(
      hit
        ? {
            key: `candidate:${hit.index}`,
            number: hit.index + 1,
            box: hit.item,
            label: hit.item.label,
            score: hit.item.score,
          }
        : {
            key: crypto.randomUUID(),
            number: detections.length + 1,
            box: clampBox({ x: x - 0.08, y: y - 0.08, w: 0.16, h: 0.16 }),
            label: "Object",
            score: 0,
          },
    );
  };
  const active = thread.find((entry) => entry.id === activeEntry);
  const historical = active ? answerMarkers(active) : [];
  const markers: Marker[] = historical.length
    ? historical
    : detections.map((item, index) => ({
        key: `candidate:${index}`,
        number: index + 1,
        box: item,
        label: item.label,
        score: item.score,
      }));
  const hasResult = false;
  const input = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      className="hidden"
      aria-label="Upload photo"
      onChange={(event) => {
        pick(event.target.files?.[0]);
        event.target.value = "";
      }}
    />
  );
  if (src)
    return (
      <main
        className="workspace"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          pick(event.dataTransfer.files?.[0]);
        }}
      >
        {input}
        <ThreadPanel
          thread={thread}
          selection={selection}
          activeEntry={activeEntry}
          highlighted={highlighted}
          detectorState={detectorState}
          count={detections.length}
          question={question}
          onQuestion={setQuestion}
          onSubmit={submit}
          onBack={reset}
          onNew={() => fileRef.current?.click()}
          onClear={clearResult}
          onRetry={(entry) => void run(entry)}
          onMemory={(id, save) => {
            const entry = threadRef.current.find((item) => item.id === id);
            if (!entry?.answer?.suggestedMemory || entry.memoryState !== "offered") return;
            try {
              if (
                save &&
                !loadMemories().some((memory) => memory.text === entry.answer?.suggestedMemory)
              )
                addMemory(entry.answer.suggestedMemory);
              changeThread((items) =>
                items.map((item) =>
                  item.id === id ? { ...item, memoryState: save ? "saved" : "skipped" } : item,
                ),
              );
            } catch {
              changeThread((items) =>
                items.map((item) =>
                  item.id === id
                    ? { ...item, error: "Couldn't save memory in this browser. Please try again." }
                    : item,
                ),
              );
            }
          }}
          onMarker={selectMarker}
          onHighlight={setHighlighted}
          onActivate={activate}
        />
        <CanvasPanel
          key={src}
          src={src}
          imageRef={imageRef}
          markers={markers}
          highlighted={highlighted}
          onHighlight={setHighlighted}
          onMarker={selectMarker}
          onTap={onTap}
          onLoad={() => void onLoad()}
          onNew={() => fileRef.current?.click()}
          onRecenter={clearResult}
        />
      </main>
    );
  return (
    <div
      className="relative h-dvh w-full overflow-hidden bg-background"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        pick(event.dataTransfer.files?.[0]);
      }}
    >
      {input}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center bg-gradient-to-b from-scrim-strong to-transparent px-4 pb-12 pt-4 text-[10px] uppercase md:px-8 md:pt-5">
        <nav className="pointer-events-auto flex min-w-0 items-center gap-1">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-[10px] uppercase tracking-normal text-foreground/80 hover:text-foreground"
          >
            <Link to="/memory">Memory</Link>
          </Button>
          {src && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-[10px] uppercase tracking-normal text-foreground/80 hover:text-foreground"
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus /> <span className="hidden sm:inline">New photo</span>
            </Button>
          )}
        </nav>
        <span className="text-sm font-medium normal-case text-foreground">lumen</span>
        <div className="flex justify-end">
          {src && hasResult ? (
            <Button
              variant="ghost"
              size="icon"
              className="pointer-events-auto size-8 text-foreground/80 hover:text-foreground"
              onClick={clearResult}
              aria-label="Clear result"
              title="Clear result"
            >
              <X />
            </Button>
          ) : (
            <span className="truncate text-right text-foreground/55">
              {detectorState === "loading" && "Scanning"}
              {detectorState === "ready" && `${detections.length} found`}
              {detectorState === "failed" && "Ready"}
            </span>
          )}
        </div>
      </header>

      {!src && (
        <main className="flex h-full flex-col items-center justify-center px-6 text-center">
          <p className="mb-6 text-[10px] uppercase text-muted-foreground">Lumen vision</p>
          <h1 className="max-w-lg text-4xl font-medium leading-tight md:text-5xl">
            See more in every image.
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Choose a photo. Tap one thing, or ask about everything you want to find.
          </p>
          <Button
            variant="outline"
            className="mt-9 rounded-none border-foreground/60 bg-transparent px-6 text-xs uppercase tracking-normal"
            onClick={() => fileRef.current?.click()}
          >
            Choose a photo
          </Button>
          <p className="mt-4 text-[11px] text-muted-foreground/70">or drop one anywhere</p>
        </main>
      )}
    </div>
  );
}
