import type { VisionAnswer } from "./vision.functions";
export type Box = { x: number; y: number; w: number; h: number };
export type Selection = {
  key: string;
  number: number;
  box: Box;
  label: string | null;
  score: number | null;
};
export type ThreadEntry = {
  id: string;
  sender: "user" | "assistant";
  question?: string;
  selection?: Selection | null;
  answer?: VisionAnswer | undefined;
  loading?: boolean;
  error?: string | undefined;
  memoryError?: string | undefined;
  previous?: string | null;
  memoryState?: "offered" | "saved" | "skipped" | undefined;
};
export type Marker = {
  key: string;
  number: number;
  box: Box;
  label: string;
  score: number;
  entryId?: string;
};
export function fitFrame(
  width: number,
  height: number,
  naturalWidth: number,
  naturalHeight: number,
) {
  const scale = Math.min(width / naturalWidth, height / naturalHeight);
  const w = naturalWidth * scale,
    h = naturalHeight * scale;
  return { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h };
}
export function clampBox(box: Box): Box {
  const x = Math.max(0, Math.min(0.99, box.x)),
    y = Math.max(0, Math.min(0.99, box.y));
  return {
    x,
    y,
    w: Math.max(0.01, Math.min(1 - x, box.w)),
    h: Math.max(0.01, Math.min(1 - y, box.h)),
  };
}
export function relevantPrevious(thread: ThreadEntry[], selection: Selection | null) {
  const entry = [...thread]
    .reverse()
    .find((item) => item.answer && (item.selection?.key ?? null) === (selection?.key ?? null));
  if (entry?.answer) return `${entry.answer.headline} ${entry.answer.explanation}`.slice(0, 4000);
  // A scene marker has no standalone object answer yet; retain its scene context.
  const scene =
    selection &&
    thread.find((item) => answerMarkers(item).some((marker) => marker.key === selection.key));
  return scene?.answer
    ? `Selected target #${selection?.number}: ${selection?.label}. Previous scene answer: ${scene.answer.headline} ${scene.answer.explanation}`.slice(
        0,
        4000,
      )
    : null;
}
export function padBox(box: Box, amount = 0.15): Box {
  const x = Math.max(0, box.x - box.w * amount),
    y = Math.max(0, box.y - box.h * amount);
  return clampBox({
    x,
    y,
    w: Math.min(1, box.x + box.w * (1 + amount)) - x,
    h: Math.min(1, box.y + box.h * (1 + amount)) - y,
  });
}
export function answerMarkers(entry: ThreadEntry): Marker[] {
  if (entry.answer?.annotations.length)
    return entry.answer.annotations.map((a, index) => ({
      key: `${entry.id}:${index}`,
      number: index + 1,
      box: clampBox(a),
      label: a.label,
      score: a.confidence,
      entryId: entry.id,
    }));
  return entry.selection
    ? [
        {
          key: entry.selection.key,
          number: entry.selection.number,
          box: entry.selection.box,
          label: entry.answer?.name ?? entry.selection.label ?? "Object",
          score: entry.answer?.confidence ?? entry.selection.score ?? 0,
          entryId: entry.id,
        },
      ]
    : [];
}

export function markerColor(label: string) {
  const type = label
    .trim()
    .toLowerCase()
    .replace(/\s*(?:#\s*)?\d+\s*$/, "")
    .trim();
  let hash = 0;
  for (const char of type) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `var(--object-color-${hash % 8})`;
}
