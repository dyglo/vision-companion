import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, ImagePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { detect, type Detection } from "@/lib/detector";
import { askVision, type VisionAnswer } from "@/lib/vision.functions";
import { addMemory, loadMemories } from "@/lib/memory";

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

type Box = { x: number; y: number; w: number; h: number };
type Selection = { box: Box; label: string | null; score: number | null };
type ImageFrame = { left: number; top: number; width: number; height: number };

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

function pad(box: Box, amount: number): Box {
  const x = Math.max(0, box.x - box.w * amount);
  const y = Math.max(0, box.y - box.h * amount);
  return {
    x,
    y,
    w: Math.min(1 - x, box.w * (1 + 2 * amount)),
    h: Math.min(1 - y, box.h * (1 + 2 * amount)),
  };
}

function getImageFrame(img: HTMLImageElement): ImageFrame {
  const rect = img.getBoundingClientRect();
  if (!img.naturalWidth || !img.naturalHeight)
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  const scale = Math.max(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
  const width = img.naturalWidth * scale;
  const height = img.naturalHeight * scale;
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}

function clampBox(box: Box): Box {
  const x = Math.max(0, Math.min(1, box.x));
  const y = Math.max(0, Math.min(1, box.y));
  return {
    x,
    y,
    w: Math.max(0.01, Math.min(1 - x, box.w)),
    h: Math.max(0.01, Math.min(1 - y, box.h)),
  };
}

function Index() {
  const [src, setSrc] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [detectorState, setDetectorState] = useState<"idle" | "loading" | "ready" | "failed">(
    "idle",
  );
  const [selection, setSelection] = useState<Selection | null>(null);
  const [sceneMode, setSceneMode] = useState(false);
  const [answer, setAnswer] = useState<VisionAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [memoryState, setMemoryState] = useState<"none" | "offered" | "saved">("none");
  const [frame, setFrame] = useState<ImageFrame | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const ask = useServerFn(askVision);

  const clearResult = () => {
    requestId.current += 1;
    setSelection(null);
    setSceneMode(false);
    setAnswer(null);
    setError(null);
    setLoading(false);
    setQuestion("");
    setMemoryState("none");
  };

  const pick = (file?: File | null) => {
    if (!file?.type.startsWith("image/")) return;
    if (src) URL.revokeObjectURL(src);
    clearResult();
    setDetections([]);
    setDetectorState("idle");
    setSrc(URL.createObjectURL(file));
  };

  useEffect(() => {
    const updateFrame = () => {
      const image = imageRef.current;
      if (image) setFrame(getImageFrame(image));
    };
    window.addEventListener("resize", updateFrame);
    return () => window.removeEventListener("resize", updateFrame);
  }, []);

  const onLoad = async () => {
    const image = imageRef.current;
    if (!image) return;
    setFrame(getImageFrame(image));
    setDetectorState("loading");
    try {
      setDetections(await detect(image));
      setDetectorState("ready");
    } catch (cause) {
      console.error(cause);
      setDetectorState("failed");
    }
  };

  const run = async (
    mode: "selection" | "scene",
    selected: Selection | null,
    nextQuestion: string | null,
    previous: string | null,
  ) => {
    const image = imageRef.current;
    if (!image) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setMemoryState("none");
    const result = await ask({
      data: {
        image: toDataUrl(image, null, 1280),
        crop: toDataUrl(image, selected ? pad(selected.box, 0.15) : null, selected ? 512 : 1280),
        mode,
        detectorLabel: selected?.label ?? null,
        detectorScore: selected?.score ?? null,
        detectorCandidates: detections.map((item, index) => ({ id: index + 1, ...item })),
        question: nextQuestion,
        previous,
        memories: loadMemories()
          .map((memory) => memory.text)
          .slice(0, 50),
      },
    }).catch(
      () => ({ error: "Couldn't reach the assistant." }) as { error: string; answer?: undefined },
    );
    if (id !== requestId.current) return;
    setLoading(false);
    if (result.error || !result.answer) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    setAnswer(result.answer);
    const existing = loadMemories().map((memory) => memory.text.toLowerCase());
    setMemoryState(
      result.answer.suggestedMemory &&
        !existing.includes(result.answer.suggestedMemory.toLowerCase())
        ? "offered"
        : "none",
    );
  };

  const onPhotoTap = (event: React.MouseEvent) => {
    if (sceneMode && (answer || loading || error)) return;
    const image = imageRef.current;
    if (!image) return;
    const imageFrame = getImageFrame(image);
    const x = (event.clientX - imageFrame.left) / imageFrame.width;
    const y = (event.clientY - imageFrame.top) / imageFrame.height;
    if (x < 0 || y < 0 || x > 1 || y > 1) return;
    const hit = detections
      .filter((item) => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    const selected: Selection = hit
      ? { box: hit, label: hit.label, score: hit.score }
      : { box: clampBox({ x: x - 0.08, y: y - 0.08, w: 0.16, h: 0.16 }), label: null, score: null };
    clearResult();
    setSelection(selected);
    void run("selection", selected, null, null);
  };

  const onAsk = (event: React.FormEvent) => {
    event.preventDefault();
    const nextQuestion = question.trim();
    if (!nextQuestion || loading) return;
    const previous = answer ? `${answer.headline} ${answer.explanation}` : null;
    setQuestion("");
    if (selection) {
      void run("selection", selection, nextQuestion, previous);
      return;
    }
    setSceneMode(true);
    void run("scene", null, nextQuestion, previous);
  };

  const annotations = answer?.annotations.length
    ? answer.annotations.map((annotation) => ({ ...annotation, box: clampBox(annotation) }))
    : selection
      ? [
          {
            label: answer?.name ?? selection.label ?? "Looking",
            confidence: selection.score ?? 0,
            box: selection.box,
          },
        ]
      : [];
  const resultOnLeft = selection ? selection.box.x + selection.box.w / 2 > 0.5 : false;
  const hasResult = loading || Boolean(answer) || Boolean(error);

  return (
    <div
      className="relative h-dvh w-full overflow-hidden bg-background"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        pick(event.dataTransfer.files?.[0]);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => pick(event.target.files?.[0])}
      />

      {src && (
        <div className="absolute inset-0 overflow-hidden" onClick={onPhotoTap}>
          <img
            ref={imageRef}
            src={src}
            alt="Your photo"
            onLoad={onLoad}
            className={`h-full w-full object-cover transition-[filter] duration-500 ${hasResult ? "brightness-[0.72]" : ""}`}
          />
          {hasResult && <div className="pointer-events-none absolute inset-0 bg-scrim-soft" />}
        </div>
      )}

      {src &&
        frame &&
        annotations.map((annotation, index) => (
          <div
            key={`${annotation.label}-${index}`}
            className="pointer-events-none absolute z-10 animate-in fade-in duration-300"
            style={{
              left: frame.left + annotation.box.x * frame.width,
              top: frame.top + annotation.box.y * frame.height,
              width: annotation.box.w * frame.width,
              height: annotation.box.h * frame.height,
            }}
          >
            <div className="absolute inset-0 border border-primary/90" />
            <span className="absolute -top-5 left-0 flex h-5 items-center gap-1 bg-primary px-1.5 text-[9px] font-medium uppercase text-primary-foreground">
              {annotations.length > 1 && <span>{String(index + 1).padStart(2, "0")}</span>}
              <span className="max-w-28 truncate">{annotation.label}</span>
            </span>
          </div>
        ))}

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

      {src && hasResult && (
        <section
          className={`absolute inset-x-0 bottom-20 z-20 max-h-[44dvh] overflow-y-auto bg-gradient-to-t from-scrim-strong via-scrim to-transparent px-5 pb-6 pt-16 text-soft-shadow md:inset-x-auto md:bottom-20 md:top-20 md:max-h-none md:w-[min(23rem,32vw)] md:bg-gradient-to-r md:px-8 md:pb-8 md:pt-16 ${resultOnLeft ? "md:left-0" : "md:right-0 md:bg-gradient-to-l"}`}
          onClick={(event) => event.stopPropagation()}
        >
          {loading && (
            <div className="flex items-center gap-3 text-xs uppercase text-foreground/75">
              <span className="size-1.5 animate-pulse bg-primary" /> Looking across the photo
            </div>
          )}
          {!loading && error && <p className="text-sm leading-relaxed text-foreground">{error}</p>}
          {!loading && answer && (
            <div className="animate-in fade-in slide-in-from-bottom-1 duration-500">
              <p className="mb-3 text-[9px] uppercase text-foreground/55">
                {sceneMode ? `${annotations.length} marked` : answer.name}
              </p>
              <h2 className="text-xl font-medium leading-snug md:text-2xl">{answer.headline}</h2>
              <p className="mt-3 text-[13px] leading-relaxed text-foreground/85">
                {answer.explanation}
              </p>
              {annotations.length > 1 && (
                <ol className="mt-5 space-y-2 border-t border-foreground/15 pt-4">
                  {annotations.map((annotation, index) => (
                    <li
                      key={`${annotation.label}-summary-${index}`}
                      className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-baseline gap-2 text-xs"
                    >
                      <span className="text-primary">{String(index + 1).padStart(2, "0")}</span>
                      <span className="truncate">{annotation.label}</span>
                      {annotation.confidence < 0.7 && (
                        <span className="text-[9px] uppercase text-foreground/45">likely</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {answer.confidence < 0.7 && (
                <div className="mt-4 flex items-center gap-3 text-[11px] text-foreground/65">
                  <span>{Math.round(answer.confidence * 100)}% sure</span>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-[11px] text-foreground underline"
                    onClick={() => setQuestion("Actually, this is ")}
                  >
                    Correct it
                  </Button>
                </div>
              )}
              {answer.nextSteps.length > 0 && (
                <ul className="mt-5 space-y-2.5">
                  {answer.nextSteps.slice(0, 3).map((step, index) => (
                    <li
                      key={index}
                      className="grid grid-cols-[0.4rem_minmax(0,1fr)] gap-3 text-xs leading-relaxed"
                    >
                      <span className="mt-1.5 size-1 bg-primary" /> <span>{step}</span>
                    </li>
                  ))}
                </ul>
              )}
              {memoryState === "offered" && answer.suggestedMemory && (
                <div className="mt-5 border-t border-foreground/15 pt-4 text-[11px] text-foreground/75">
                  <p>Remember “{answer.suggestedMemory}”?</p>
                  <div className="mt-2 flex gap-3">
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-[10px] uppercase text-foreground"
                      onClick={() => {
                        addMemory(answer.suggestedMemory ?? "");
                        setMemoryState("saved");
                      }}
                    >
                      Save
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-[10px] uppercase text-foreground/55"
                      onClick={() => setMemoryState("none")}
                    >
                      Skip
                    </Button>
                  </div>
                </div>
              )}
              {memoryState === "saved" && (
                <p className="mt-5 text-[10px] uppercase text-foreground/55">Saved to memory</p>
              )}
            </div>
          )}
        </section>
      )}

      {src && (
        <form
          onSubmit={onAsk}
          className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-scrim-strong to-transparent px-4 pb-4 pt-10 md:px-8 md:pb-6"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mx-auto grid max-w-2xl grid-cols-[minmax(0,1fr)_2.25rem] items-center border-b border-foreground/45 focus-within:border-foreground">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={
                selection
                  ? `Ask about this ${answer?.name ?? "object"}…`
                  : "Ask about the whole photo…"
              }
              className="min-w-0 bg-transparent py-3 text-sm text-foreground outline-none placeholder:text-foreground/55"
              aria-label="Ask about the photo"
            />
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              disabled={!question.trim() || loading}
              className="size-9 text-foreground"
              aria-label="Ask"
              title="Ask"
            >
              <ArrowUp />
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
