import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { detect, type Detection } from "@/lib/detector";
import { askVision } from "@/lib/vision.functions";
import { addMemory, loadMemories } from "@/lib/memory";
import { ThreadPanel } from "@/components/workspace/ThreadPanel";
import { WorkspaceLayout } from "@/components/workspace/WorkspaceLayout";
import { CanvasPanel } from "@/components/workspace/CanvasPanel";
import {
  conversationMarkers,
  retainMarkers,
  sameObjectBox,
  cropFullResolution,
  toggleComparison,
  clampBox,
  relevantPrevious,
  padBox,
  type Box,
  type Marker,
  type Selection,
  type ThreadEntry,
  type CanvasTool,
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

export function Index() {
  const [src, setSrc] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [detectorState, setDetectorState] = useState("idle");
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const threadRef = useRef<ThreadEntry[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [activeEntry, setActiveEntry] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [removedMarkers, setRemovedMarkers] = useState<string[]>([]);
  const [focusedMarker, setFocusedMarker] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [tool, setTool] = useState<CanvasTool>("select");
  const toolRef = useRef<CanvasTool>("select");
  const [comparisons, setComparisons] = useState<Selection[]>([]);
  const [zoomBox, setZoomBox] = useState<Box | null>(null);
  const [toolMarkers, setToolMarkers] = useState<Marker[]>([]);
  const toolMarkersRef = useRef<Marker[]>([]);
  const knownMarkers = () => [
    ...new Map(
      [...toolMarkersRef.current, ...conversationMarkers(threadRef.current)].map((marker) => [
        marker.key,
        marker,
      ]),
    ).values(),
  ];
  const changeTool = (next: CanvasTool) => {
    toolRef.current = next;
    setTool(next);
    if (next !== "compare") setComparisons([]);
  };
  const imageRef = useRef<HTMLImageElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const detectionCache = useRef<Promise<Detection[]> | null>(null);
  const sourceRef = useRef<string | null>(null);
  const attempts = useRef(new Map<string, number>());
  const ask = useServerFn(askVision);
  const changeThread = (fn: (items: ThreadEntry[]) => ThreadEntry[]) => {
    threadRef.current = fn(threadRef.current);
    setThread(threadRef.current);
  };
  const reset = () => {
    generation.current++;
    detectionCache.current = null;
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
    setRemovedMarkers([]);
    setFocusedMarker(null);
    setQuestion("");
    changeTool("select");
    setZoomBox(null);
    toolMarkersRef.current = [];
    setToolMarkers([]);
  };
  const clearResult = () => {
    setSelection(null);
    setActiveEntry(null);
    setHighlighted(null);
    setFocusedMarker(null);
    setZoomBox(null);
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
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--workspace-height");
    };
  }, []);
  const ensureDetections = () => {
    if (detectionCache.current) return detectionCache.current;
    const image = imageRef.current;
    if (!image) return Promise.resolve([] as Detection[]);
    const epoch = generation.current;
    setDetectorState("loading");
    const pending = detect(image)
      .then((found) => {
        if (epoch === generation.current) {
          setDetections(found);
          setDetectorState("ready");
        }
        return found;
      })
      .catch(() => {
        if (epoch === generation.current) setDetectorState("failed");
        return [] as Detection[];
      });
    detectionCache.current = pending;
    return pending;
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
      const candidates = await ensureDetections();
      if (epoch !== generation.current || attempts.current.get(entry.id) !== attempt) return;
      let selected = entry.selection ?? null;
      if (selected && !selected.label) {
        const cx = selected.box.x + selected.box.w / 2,
          cy = selected.box.y + selected.box.h / 2;
        const hit = candidates
          .filter(
            (item) =>
              cx >= item.x && cx <= item.x + item.w && cy >= item.y && cy <= item.y + item.h,
          )
          .sort((a, b) => a.w * a.h - b.w * b.h)[0];
        if (hit) {
          selected = { ...selected, box: clampBox(hit), label: hit.label, score: hit.score };
          const target = selected;
          changeThread((items) =>
            items.map((item) => (item.id === entry.id ? { ...item, selection: target } : item)),
          );
          setSelection((current) => (current?.key === target.key ? target : current));
        }
      }
      const inspectionTargets = (
        entry.comparisons ?? (entry.deepInspection && selected ? [selected] : [])
      ).map((target) => ({
        id: target.key,
        number: target.number,
        label: target.label ?? "Object",
        box: target.box,
        cropBox: padBox(target.box),
        crop: cropFullResolution(image, padBox(target.box)),
      }));
      const crop =
        entry.deepInspection && selected
          ? inspectionTargets[0]!.crop
          : toDataUrl(image, selected ? padBox(selected.box) : null, selected ? 512 : 1280);
      if (
        inspectionTargets.reduce((size, target) => size + target.crop.length, crop.length) >
        64_000_000
      )
        throw new Error("Comparison crops are too large. Select smaller regions.");
      const result = await ask({
        data: {
          image: toDataUrl(image, null, 1280),
          crop,
          mode: entry.comparisons?.length ? "comparison" : selected ? "selection" : "scene",
          deepInspection: entry.deepInspection ?? false,
          targets: inspectionTargets,
          detectorLabel: selected?.label ?? null,
          detectorScore: selected?.score ?? null,
          detectorCandidates: candidates
            .slice(0, 40)
            .map((item, index) => ({ id: index + 1, ...item })),
          question: entry.question ?? null,
          previous:
            [
              entry.previous,
              conversationMarkers(threadRef.current).length
                ? `Existing canvas annotations: ${JSON.stringify(conversationMarkers(threadRef.current).map(({ number, label, box }) => ({ number, label, box })))}`
                : null,
            ]
              .filter(Boolean)
              .join("\n")
              .slice(0, 4000) || null,
          memories: loadMemories()
            .map((memory) => memory.text)
            .slice(0, 50),
        },
      });
      if (epoch !== generation.current || attempts.current.get(entry.id) !== attempt) return;
      const answer = result.answer;
      const registered = answer
        ? retainMarkers({ ...entry, selection: selected, answer }, knownMarkers())
        : (threadRef.current.find((item) => item.id === entry.id)?.markers ?? []);
      if (entry.selection?.custom && entry.markers)
        for (const marker of entry.markers)
          if (!registered.some((item) => item.key === marker.key)) registered.unshift(marker);
      const selectedMarker =
        selected && registered.find((marker) => sameObjectBox(marker.box, selected.box));
      const retainedSelection =
        selected && selectedMarker
          ? { ...selected, key: selectedMarker.key, number: selectedMarker.number }
          : selected;
      if (selected && retainedSelection) {
        const oldKey = selected.key;
        const target = retainedSelection;
        setSelection((current) => (current?.key === oldKey ? target : current));
      }
      changeThread((items) =>
        items.map((item) =>
          item.id !== entry.id
            ? item
            : {
                ...item,
                loading: false,
                answer,
                markers: registered,
                selection: retainedSelection,
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
    } catch (error) {
      if (epoch === generation.current && attempts.current.get(entry.id) === attempt)
        changeThread((items) =>
          items.map((item) =>
            item.id === entry.id
              ? {
                  ...item,
                  loading: false,
                  error:
                    error instanceof Error && /crop|image|regions/i.test(error.message)
                      ? error.message
                      : "Couldn't reach the assistant. Please retry.",
                }
              : item,
          ),
        );
    }
  };
  const submit = () => {
    const text = question.trim();
    if (!text || !imageRef.current?.naturalWidth) return;
    if (tool === "compare" && comparisons.length < 2) return;
    const requestedNumber = /(?:#|target\s+|annotation\s+)(\d+)/i.exec(text)?.[1];
    const requested = requestedNumber
      ? conversationMarkers(threadRef.current).find(
          (marker) => marker.number === Number(requestedNumber),
        )
      : /\b(?:this|selected)\b/i.test(text)
        ? selection
        : null;
    let canvasCommand = false;
    if (/^(?:please\s+)?(?:remove|clear|hide)\b/i.test(text)) {
      if (/\b(?:all annotations|all boxes|all bounding boxes)\b/i.test(text)) {
        setRemovedMarkers(conversationMarkers(threadRef.current).map((marker) => marker.key));
        canvasCommand = true;
      } else if (requested) {
        setRemovedMarkers((keys) => [...keys, requested.key]);
        canvasCommand = true;
      }
    }
    if (/\b(?:focus only|only focus|show only)\b/i.test(text) && requested) {
      setFocusedMarker(requested.key);
      canvasCommand = true;
    }
    if (/\b(?:show|restore) all (?:annotations|boxes|bounding boxes)\b/i.test(text)) {
      setFocusedMarker(null);
      setRemovedMarkers([]);
      canvasCommand = true;
    }
    if (canvasCommand) {
      changeThread((items) => [
        ...items,
        { id: crypto.randomUUID(), sender: "user", question: text, selection },
      ]);
      setQuestion("");
      return;
    }
    const entry: ThreadEntry = {
      id: crypto.randomUUID(),
      sender: "assistant",
      question: text,
      selection,
      previous: relevantPrevious(threadRef.current, selection),
      loading: true,
      ...(tool === "compare"
        ? {
            comparisons: [...comparisons],
            markers: comparisons
              .map((target) => knownMarkers().find((marker) => marker.key === target.key)!)
              .filter(Boolean),
            objectIds: comparisons.map((target) => target.key),
            selection: null,
          }
        : {}),
      ...(tool === "focus" && selection ? { deepInspection: true } : {}),
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
    if (entry.sender !== "assistant") return;
    setActiveEntry(entry.id);
    setSelection(entry.selection ?? null);
  };
  const selectMarker = (marker: Marker) => {
    const selected: Selection = {
      key: marker.key,
      number: marker.number,
      box: marker.box,
      label: marker.label || null,
      score: marker.score,
      ...(marker.custom ? { custom: true } : {}),
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
  const registerToolMarker = (marker: Marker) => {
    const existing = knownMarkers().find(
      (item) => item.key === marker.key || (!marker.custom && sameObjectBox(item.box, marker.box)),
    );
    if (existing) return existing;
    const registered = {
      ...marker,
      number: Math.max(0, ...knownMarkers().map((item) => item.number)) + 1,
    };
    toolMarkersRef.current = [...toolMarkersRef.current, registered];
    setToolMarkers(toolMarkersRef.current);
    return registered;
  };
  const toolSelect = (marker: Marker) => {
    if (toolRef.current === "select") {
      selectMarker(marker);
      return;
    }
    if (toolRef.current === "draw") return;
    if (
      toolRef.current === "compare" &&
      comparisons.length >= 4 &&
      !comparisons.some((target) => target.key === marker.key)
    )
      return;
    const registered = registerToolMarker(marker);
    const target: Selection = {
      ...registered,
      label: registered.label || null,
      score: registered.score,
    };
    if (toolRef.current === "compare") {
      setComparisons((items) => toggleComparison(items, target));
      return;
    }
    setSelection(target);
    setZoomBox(target.box);
    const entry: ThreadEntry = {
      id: crypto.randomUUID(),
      sender: "assistant",
      selection: target,
      deepInspection: true,
      question:
        "Inspect this crop in fine detail: read legible labels or serial numbers and describe visible surface condition, texture wear, or defects. Say what cannot be resolved.",
      previous: relevantPrevious(threadRef.current, target),
      loading: true,
      markers: [registered],
    };
    changeThread((items) => [...items, entry]);
    setActiveEntry(entry.id);
    void run(entry);
  };
  const toolTap = async (x: number, y: number) => {
    if (toolRef.current === "select") {
      onTap(x, y);
      return;
    }
    if (toolRef.current === "draw") return;
    const epoch = generation.current,
      mode = toolRef.current;
    const visible = markers
      .filter(
        (marker) =>
          x >= marker.box.x &&
          x <= marker.box.x + marker.box.w &&
          y >= marker.box.y &&
          y <= marker.box.y + marker.box.h,
      )
      .sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0];
    if (visible) {
      toolSelect(visible);
      return;
    }
    const candidates = await ensureDetections();
    if (epoch !== generation.current || toolRef.current !== mode) return;
    const hit = candidates
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h,
      )
      .sort((a, b) => a.item.w * a.item.h - b.item.w * b.item.h)[0];
    toolSelect(
      hit
        ? {
            key: `candidate:${hit.index}`,
            number: 0,
            box: clampBox(hit.item),
            label: hit.item.label,
            score: hit.item.score,
          }
        : {
            key: crypto.randomUUID(),
            number: 0,
            box: clampBox({ x: x - 0.08, y: y - 0.08, w: 0.16, h: 0.16 }),
            label: "",
            score: 0,
          },
    );
  };
  const submitRegion = (box: Box, text: string) => {
    const id = crypto.randomUUID();
    const marker = registerToolMarker({
      key: crypto.randomUUID(),
      number: 0,
      box: clampBox(box),
      label: "Custom",
      score: 0,
      custom: true,
      entryId: id,
    });
    const target: Selection = { ...marker, custom: true };
    const entry: ThreadEntry = {
      id,
      sender: "assistant",
      question: text,
      selection: target,
      loading: true,
      markers: [marker],
    };
    setSelection(target);
    changeThread((items) => [
      ...items,
      { id: crypto.randomUUID(), sender: "user", question: text, selection: target },
      entry,
    ]);
    setActiveEntry(id);
    void run(entry);
  };
  const onTap = (x: number, y: number) => {
    const visibleHit = markers
      .filter(
        (marker) =>
          x >= marker.box.x &&
          x <= marker.box.x + marker.box.w &&
          y >= marker.box.y &&
          y <= marker.box.y + marker.box.h,
      )
      .sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0];
    if (visibleHit) {
      selectMarker(visibleHit);
      return;
    }
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
            label: "",
            score: 0,
          },
    );
  };
  const detectionMarkers: Marker[] = detections.map((item, index) => ({
    key: `candidate:${index}`,
    number: index + 1,
    box: { x: item.x, y: item.y, w: item.w, h: item.h },
    label: item.label,
    score: item.score,
  }));
  const markers = [
    ...new Map(
      [...detectionMarkers, ...toolMarkers, ...conversationMarkers(thread)].map((marker) => [
        marker.key,
        marker,
      ]),
    ).values(),
  ].filter(
    (marker) =>
      !removedMarkers.includes(marker.key) && (!focusedMarker || marker.key === focusedMarker),
  );
  const highlightMarker = (key: string | null) => {
    setHighlighted(key);
  };
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
      <WorkspaceLayout
        input={input}
        onDrop={pick}
        thread={
          <ThreadPanel
            thread={thread}
            selection={selection}
            activeEntry={activeEntry}
            highlighted={highlighted}
            detectorState={detectorState}
            question={question}
            comparisons={comparisons}
            comparisonMode={tool === "compare"}
            onClearComparison={() => setComparisons([])}
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
                  !loadMemories().some(
                    (memory) =>
                      memory.text.toLowerCase() === entry.answer?.suggestedMemory?.toLowerCase(),
                  )
                )
                  addMemory(entry.answer.suggestedMemory);
                changeThread((items) =>
                  items.map((item) =>
                    item.id === id
                      ? { ...item, memoryState: save ? "saved" : "skipped", memoryError: undefined }
                      : item,
                  ),
                );
              } catch {
                changeThread((items) =>
                  items.map((item) =>
                    item.id === id
                      ? {
                          ...item,
                          memoryError: "Couldn't save memory in this browser. Please try again.",
                        }
                      : item,
                  ),
                );
              }
            }}
            onMarker={selectMarker}
            onRemoveMarker={(key) => {
              setRemovedMarkers((keys) => [...keys, key]);
              if (selection?.key === key) clearResult();
            }}
            onFocusMarker={(key) => setFocusedMarker(key)}
            onHighlight={highlightMarker}
            onActivate={activate}
          />
        }
        canvas={(fullView, toggleFullView) => (
          <CanvasPanel
            key={src}
            src={src}
            imageRef={imageRef}
            tool={tool}
            onTool={changeTool}
            comparisons={comparisons}
            zoomBox={zoomBox}
            onEscape={() => setZoomBox(null)}
            onRegion={submitRegion}
            markers={markers}
            highlighted={highlighted}
            onHighlight={setHighlighted}
            onMarker={toolSelect}
            onTap={(x, y) => void toolTap(x, y)}
            onLoad={() => void ensureDetections()}
            fullView={fullView}
            onFullView={toggleFullView}
            onNew={() => fileRef.current?.click()}
            onRecenter={clearResult}
          />
        )}
      />
    );
  return (
    <div
      className="lumen-landing relative isolate min-h-dvh w-full overflow-hidden"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        pick(event.dataTransfer.files?.[0]);
      }}
    >
      {input}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-6 py-6 sm:px-10 sm:py-8">
        <nav className="flex min-w-0 items-center" aria-label="Utility navigation">
          <Link
            to="/memory"
            className="pointer-events-auto rounded-sm py-2 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            Deplyze
          </Link>
        </nav>
        <span className="text-sm font-medium tracking-wide text-foreground">lumen</span>
      </header>

      {!src && (
        <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-6 pb-32 pt-28 text-center sm:pb-40">
          <p className="mb-7 inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 px-3.5 py-1.5 text-[10px] uppercase tracking-[0.2em] text-foreground/75 backdrop-blur-md">
            <span className="lumen-landing-dot size-1 rounded-full" aria-hidden="true" />
            Lumen vision
          </p>
          <h1 className="max-w-3xl text-4xl font-medium leading-[1.08] tracking-tight text-foreground sm:text-5xl md:text-6xl">
            See more in every image.
          </h1>
          <p className="mt-5 max-w-lg text-sm leading-relaxed text-muted-foreground/80 sm:text-base">
            Tap any object to inspect details, read fine texture, or ask Lumen to explain the whole
            scene.
          </p>
          <Button
            variant="outline"
            className="mt-9 h-14 gap-3 rounded-full border-foreground/15 bg-foreground/5 px-6 text-sm font-medium text-foreground shadow-xl backdrop-blur-md transition-all hover:border-foreground/30 hover:bg-foreground/10 hover:shadow-cyan-500/10 active:scale-[0.98]"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="size-[18px] text-foreground/80" aria-hidden="true" />
            <span>Choose a photo</span>
            <span
              className="ml-2 border-l border-foreground/15 pl-3 text-[10px] font-normal uppercase tracking-wider text-foreground/50"
              aria-hidden="true"
            >
              Drop
            </span>
          </Button>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/70">
            or drag and drop anywhere · JPG, PNG, WEBP
          </p>
          <p className="mt-10 inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/[0.03] px-3.5 py-2 text-[10px] tracking-wide text-foreground/60 backdrop-blur-md">
            <span className="lumen-landing-dot size-1 rounded-full" aria-hidden="true" />
            In-browser detection <span aria-hidden="true">·</span> Start with a photo
          </p>
        </main>
      )}
    </div>
  );
}
