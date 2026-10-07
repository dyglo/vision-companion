import { ArrowLeft, ArrowUp, ImagePlus, LoaderCircle, Target, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { answerMarkers, type Marker, type Selection, type ThreadEntry } from "@/lib/workspace";

type Props = {
  thread: ThreadEntry[];
  selection: Selection | null;
  activeEntry: string | null;
  highlighted: string | null;
  detectorState: string;
  count: number;
  question: string;
  onQuestion: (v: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  onNew: () => void;
  onClear: () => void;
  onRetry: (entry: ThreadEntry) => void;
  onMemory: (id: string, save: boolean) => void;
  onMarker: (marker: Marker) => void;
  onHighlight: (key: string | null) => void;
  onActivate: (entry: ThreadEntry) => void;
};
export function ThreadPanel(props: Props) {
  const { thread, selection, activeEntry, highlighted } = props;
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = scroller.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [thread.length]);
  useEffect(() => {
    if (!activeEntry) return;
    const node = document.getElementById(`thread-${activeEntry}`);
    node?.scrollIntoView({ block: "nearest", behavior: "auto" });
    node?.focus({ preventScroll: true });
  }, [activeEntry]);
  const pending = thread.some((entry) => entry.loading);
  return (
    <section
      aria-label="Conversation"
      className="thread-panel flex min-h-0 min-w-0 flex-col bg-background"
    >
      <header className="shrink-0 border-b border-border px-4 py-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              aria-label="Back to start"
              title="Back to start"
              onClick={props.onBack}
            >
              <ArrowLeft />
            </Button>
            <span className="text-sm font-medium">lumen</span>
          </div>
          <div className="flex shrink-0 items-center">
            <Button asChild variant="ghost" size="sm">
              <Link to="/memory">Memory</Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              aria-label="New photo"
              title="New photo"
              onClick={props.onNew}
            >
              <ImagePlus />
            </Button>
          </div>
        </div>
        <p role="status" className="px-2 pb-1 text-xs text-muted-foreground">
          {props.detectorState === "loading"
            ? "Scanning photo…"
            : props.detectorState === "failed"
              ? "Detection unavailable · AI can still help"
              : props.detectorState === "ready"
                ? `${props.count} objects found`
                : "Opening photo…"}
          {pending ? " · Lumen is thinking…" : ""}
        </p>
      </header>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5"
        aria-label="Conversation history"
      >
        {thread.map((entry) => (
          <article
            key={entry.id}
            id={`thread-${entry.id}`}
            tabIndex={-1}
            onFocus={() => props.onActivate(entry)}
            className={`py-6 outline-none ${entry.sender === "assistant" ? "border-b border-border" : ""} ${activeEntry === entry.id ? "border-l-2 border-l-primary pl-3" : ""}`}
          >
            <p className="mb-2 text-[10px] uppercase text-muted-foreground">
              {entry.sender === "user" ? "You" : "Lumen"}
            </p>
            {entry.welcome && (
              <>
                <h1 className="text-xl font-medium">What would you like to explore?</h1>
                <p className="mt-2 text-sm text-muted-foreground">Your photo is ready.</p>
              </>
            )}
            {entry.sender === "user" && (
              <p className="break-words text-sm leading-relaxed">{entry.question}</p>
            )}
            {entry.loading && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Looking at your photo…
              </p>
            )}
            {entry.error && (
              <div role="status">
                <p className="text-sm text-destructive">{entry.error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => props.onRetry(entry)}
                >
                  Retry
                </Button>
              </div>
            )}
            {entry.answer && (
              <>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
                  <p className="break-words text-xs text-primary">{entry.answer.name}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {Math.round(entry.answer.confidence * 100)}% confidence
                  </span>
                </div>
                <h2 className="mt-2 text-xl font-medium leading-snug">{entry.answer.headline}</h2>
                {entry.answer.confidence < 0.7 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    I’m not fully sure. Please confirm what this is.
                  </p>
                )}
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {entry.answer.explanation}
                </p>
                {answerMarkers(entry).length > 0 && (
                  <ol className="mt-4 space-y-1">
                    {answerMarkers(entry).map((marker) => (
                      <li key={marker.key}>
                        <Button
                          variant="ghost"
                          className={`h-auto min-h-11 w-full justify-start whitespace-normal text-left ${highlighted === marker.key ? "bg-primary/10 text-primary" : ""}`}
                          onClick={() => props.onMarker(marker)}
                          onMouseEnter={() => props.onHighlight(marker.key)}
                          onMouseLeave={() => props.onHighlight(null)}
                          onFocus={() => {
                            props.onActivate(entry);
                            props.onHighlight(marker.key);
                          }}
                          onBlur={() => props.onHighlight(null)}
                          aria-label={`Show target ${marker.number}: ${marker.label}`}
                        >
                          <span className="shrink-0 text-primary">
                            {marker.number.toString().padStart(2, "0")}
                          </span>
                          <span className="min-w-0 break-words">
                            {marker.label}
                            {marker.score < 0.7 ? " · likely" : ""}
                          </span>
                        </Button>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="mt-4 flex flex-col items-start gap-2">
                  {entry.answer.nextSteps.map((step, index) => (
                    <Button
                      key={index}
                      variant="outline"
                      className="h-auto min-h-11 max-w-full whitespace-normal rounded-full py-2 text-left text-xs"
                      onClick={() => {
                        props.onActivate(entry);
                        props.onQuestion(step);
                      }}
                    >
                      {step}
                    </Button>
                  ))}
                </div>
                {entry.answer.suggestedMemory && entry.memoryState === "offered" && (
                  <div className="mt-5 rounded-md border border-border p-3">
                    <p className="text-xs leading-relaxed">
                      Remember “{entry.answer.suggestedMemory}”?
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="min-h-11"
                        onClick={() => props.onMemory(entry.id, true)}
                      >
                        Save
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11"
                        onClick={() => props.onMemory(entry.id, false)}
                      >
                        Skip
                      </Button>
                    </div>
                  </div>
                )}
                {entry.memoryState === "saved" && (
                  <p role="status" className="mt-4 text-xs text-muted-foreground">
                    Saved to memory
                  </p>
                )}
              </>
            )}
          </article>
        ))}
      </div>
      <form
        className="composer shrink-0 border-t border-border bg-background px-4 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        {selection && (
          <div className="mb-2 flex items-center gap-2 text-xs text-primary">
            <Target className="size-3 shrink-0" />
            <span className="min-w-0 truncate">
              Target #{selection.number} · {selection.label ?? "Object"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto min-h-11 min-w-11"
              aria-label="Clear selected object"
              title="Ask about the whole photo"
              onClick={props.onClear}
            >
              <X />
            </Button>
          </div>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <textarea
            value={props.question}
            maxLength={1000}
            rows={2}
            onChange={(event) => props.onQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                props.onSubmit();
              }
            }}
            placeholder="Ask about this object or the whole photo..."
            aria-label="Ask about this object or the whole photo"
            className="min-w-0 resize-none bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button
            type="submit"
            size="icon"
            className="mb-2 min-h-11 min-w-11 rounded-full"
            disabled={!props.question.trim()}
            aria-label="Ask"
            title="Ask"
          >
            <ArrowUp />
          </Button>
        </div>
      </form>
    </section>
  );
}
