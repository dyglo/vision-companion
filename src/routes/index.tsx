import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { detect, type Detection } from "@/lib/detector";
import { askVision, type VisionAnswer } from "@/lib/vision.functions";
import { addMemory, loadMemories } from "@/lib/memory";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lumen — tap anything in a photo" },
      { name: "description", content: "Upload a photo, tap an object, and learn what it is, how it works, and what to do next." },
      { property: "og:title", content: "Lumen — tap anything in a photo" },
      { property: "og:description", content: "Upload a photo, tap an object, and learn what it is, how it works, and what to do next." },
    ],
  }),
  component: Index,
});

type Box = { x: number; y: number; w: number; h: number };
type Selection = { box: Box; label: string | null; score: number | null };

function toDataUrl(img: HTMLImageElement, box: Box | null, max: number) {
  const sx = box ? box.x * img.naturalWidth : 0;
  const sy = box ? box.y * img.naturalHeight : 0;
  const sw = box ? box.w * img.naturalWidth : img.naturalWidth;
  const sh = box ? box.h * img.naturalHeight : img.naturalHeight;
  const s = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * s));
  c.height = Math.max(1, Math.round(sh * s));
  c.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

function pad(b: Box, p: number): Box {
  const x = Math.max(0, b.x - b.w * p);
  const y = Math.max(0, b.y - b.h * p);
  return { x, y, w: Math.min(1 - x, b.w * (1 + 2 * p)), h: Math.min(1 - y, b.h * (1 + 2 * p)) };
}

function Index() {
  const [src, setSrc] = useState<string | null>(null);
  const [dets, setDets] = useState<Detection[]>([]);
  const [detState, setDetState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [sel, setSel] = useState<Selection | null>(null);
  const [answer, setAnswer] = useState<VisionAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [memState, setMemState] = useState<"none" | "offered" | "saved">("none");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);
  const ask = useServerFn(askVision);

  const pick = (f?: File | null) => {
    if (!f || !f.type.startsWith("image/")) return;
    if (src) URL.revokeObjectURL(src);
    setSrc(URL.createObjectURL(f));
    clear();
    setDets([]);
  };
  const clear = () => {
    reqId.current++;
    setSel(null);
    setAnswer(null);
    setError(null);
    setLoading(false);
    setQ("");
    setMemState("none");
  };

  useEffect(() => {
    const onR = () => imgRef.current && setRect(imgRef.current.getBoundingClientRect());
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);

  const onLoad = async () => {
    const img = imgRef.current!;
    setRect(img.getBoundingClientRect());
    setDetState("loading");
    try {
      setDets(await detect(img));
      setDetState("ready");
    } catch (e) {
      console.error(e);
      setDetState("failed");
    }
  };

  const run = async (s: Selection, question: string | null, previous: string | null) => {
    const img = imgRef.current;
    if (!img) return;
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    const r = await ask({
      data: {
        image: toDataUrl(img, null, 1024),
        crop: toDataUrl(img, pad(s.box, 0.15), 512),
        detectorLabel: s.label,
        detectorScore: s.score,
        question,
        previous,
        memories: loadMemories().map((m) => m.text).slice(0, 50),
      },
    }).catch(() => ({ error: "Couldn't reach the assistant." }) as { error: string; answer?: undefined });
    if (id !== reqId.current) return;
    setLoading(false);
    if (r.error || !r.answer) return setError(r.error ?? "Something went wrong.");
    setAnswer(r.answer);
    const existing = loadMemories().map((m) => m.text.toLowerCase());
    setMemState(r.answer.suggestedMemory && !existing.includes(r.answer.suggestedMemory.toLowerCase()) ? "offered" : "none");
  };

  const onTap = (e: React.MouseEvent) => {
    const img = imgRef.current;
    if (!img) return;
    const r = img.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return clear();
    const hit = dets
      .filter((d) => nx >= d.x && nx <= d.x + d.w && ny >= d.y && ny <= d.y + d.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (sel && !hit && !loading && answer) {
      // tapping elsewhere with an open answer clears first
      const inside = nx >= sel.box.x && nx <= sel.box.x + sel.box.w && ny >= sel.box.y && ny <= sel.box.y + sel.box.h;
      if (!inside) return clear();
    }
    const s: Selection = hit
      ? { box: hit, label: hit.label, score: hit.score }
      : { box: { x: Math.max(0, nx - 0.1), y: Math.max(0, ny - 0.1), w: 0.2, h: 0.2 }, label: null, score: null };
    clear();
    setSel(s);
    run(s, null, null);
  };

  const onAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sel || !q.trim() || loading) return;
    const prev = answer ? `${answer.headline} ${answer.explanation}` : null;
    const question = q.trim();
    setQ("");
    run(sel, question, prev);
  };

  // place text away from the selected object
  const textLeft = sel ? sel.box.x + sel.box.w / 2 > 0.5 : false;

  return (
    <div
      className="relative h-dvh w-full overflow-hidden bg-background"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        pick(e.dataTransfer.files?.[0]);
      }}
    >
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

      {src && (
        <div className="absolute inset-0 flex items-center justify-center" onClick={onTap}>
          <img
            ref={imgRef}
            src={src}
            alt="Your photo"
            onLoad={onLoad}
            className={`max-h-full max-w-full object-contain transition-[filter] duration-500 ${sel ? "brightness-[0.62]" : ""}`}
          />
        </div>
      )}

      {/* selected object outline */}
      {src && sel && rect && (
        <div
          className="pointer-events-none absolute animate-in fade-in duration-300"
          style={{
            left: rect.left + sel.box.x * rect.width,
            top: rect.top + sel.box.y * rect.height,
            width: sel.box.w * rect.width,
            height: sel.box.h * rect.height,
          }}
        >
          <div className="absolute inset-0 border border-primary/90" />
          <span className="absolute -top-5 left-0 bg-primary/25 px-1 text-[10px] uppercase tracking-wider text-primary">
            {answer?.name ?? sel.label ?? "looking…"}
          </span>
        </div>
      )}

      {/* top bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-scrim to-transparent px-6 py-5 text-xs uppercase tracking-wide md:px-8">
        <nav className="pointer-events-auto flex gap-5 text-foreground/80">
          <Link to="/memory" className="hover:text-foreground">Memory</Link>
          {src && (
            <button onClick={() => fileRef.current?.click()} className="uppercase hover:text-foreground">
              New photo
            </button>
          )}
        </nav>
        <span className="text-base normal-case tracking-tight text-foreground">lumen</span>
        <span className="w-24 text-right text-[10px] text-foreground/50">
          {src && detState === "loading" && "Scanning…"}
          {src && detState === "ready" && !sel && `${dets.length} things found`}
          {src && detState === "failed" && "Tap anywhere"}
        </span>
      </header>

      {!src && (
        <main className="flex h-full flex-col items-center justify-center px-6 text-center">
          <h1 className="max-w-lg text-4xl font-medium tracking-tight md:text-5xl">Tap anything. Understand it.</h1>
          <p className="mt-4 max-w-sm text-muted-foreground">
            Choose a photo, then tap an object to learn what it is, how it works, and what to do next.
          </p>
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-10 border border-foreground/60 px-6 py-3 text-xs uppercase tracking-widest transition-colors hover:bg-foreground hover:text-background"
          >
            Choose a photo
          </button>
          <p className="mt-4 text-xs text-muted-foreground/70">or drop one anywhere</p>
        </main>
      )}

      {/* insight text */}
      {sel && (
        <section
          className={`pointer-events-none absolute top-24 z-10 w-[min(26rem,calc(100%-3rem))] text-soft-shadow ${textLeft ? "left-6 md:left-10" : "right-6 md:right-10"}`}
        >
          {loading && <p className="animate-pulse text-lg text-foreground/80">Looking closely…</p>}
          {!loading && error && <p className="text-lg">{error}</p>}
          {!loading && answer && (
            <div className="pointer-events-auto animate-in fade-in slide-in-from-bottom-1 duration-500">
              <h2 className="text-2xl font-medium leading-tight tracking-tight md:text-3xl">{answer.headline}</h2>
              <p className="mt-3 whitespace-pre-line leading-relaxed text-foreground/85">{answer.explanation}</p>
              {answer.confidence < 0.7 && (
                <p className="mt-3 text-sm text-foreground/70">
                  I'm about {Math.round(answer.confidence * 100)}% sure.{" "}
                  <button className="underline underline-offset-4" onClick={() => setQ("Actually, this is ")}>
                    It's something else
                  </button>
                </p>
              )}
              {answer.nextSteps.length > 0 && (
                <ul className="mt-5 space-y-2">
                  {answer.nextSteps.slice(0, 3).map((s, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-2 size-2 shrink-0 bg-primary" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              )}
              {memState === "offered" && answer.suggestedMemory && (
                <p className="mt-6 text-sm text-foreground/80">
                  Remember “{answer.suggestedMemory}”?{" "}
                  <button
                    className="ml-2 uppercase tracking-wide underline underline-offset-4"
                    onClick={() => {
                      addMemory(answer.suggestedMemory!);
                      setMemState("saved");
                    }}
                  >
                    Save
                  </button>
                  <button className="ml-3 uppercase tracking-wide text-foreground/60" onClick={() => setMemState("none")}>
                    Skip
                  </button>
                </p>
              )}
              {memState === "saved" && <p className="mt-6 text-sm text-foreground/60">Saved to memory.</p>}
            </div>
          )}
        </section>
      )}

      {/* follow-up */}
      {sel && (answer || error) && (
        <form onSubmit={onAsk} className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-scrim to-transparent px-6 pb-6 pt-16 md:px-10">
          <div className="mx-auto flex max-w-2xl items-center border-b border-foreground/40 focus-within:border-foreground">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Ask about this ${answer?.name ?? "object"}…`}
              className="flex-1 bg-transparent py-3 text-foreground outline-none placeholder:text-foreground/50"
            />
            <button disabled={!q.trim() || loading} className="text-xs uppercase tracking-widest disabled:opacity-40">
              Ask
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
