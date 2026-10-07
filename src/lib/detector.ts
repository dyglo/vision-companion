import modelAsset from "@/assets/yolo26n.onnx.asset.json";
import { LABELS } from "./labels";

export type Detection = {
  label: string;
  score: number;
  // normalized 0..1, top-left based
  x: number;
  y: number;
  w: number;
  h: number;
};

type Ort = typeof import("onnxruntime-web");
let sessionPromise: Promise<{
  ort: Ort;
  session: import("onnxruntime-web").InferenceSession;
}> | null = null;

function load() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import("onnxruntime-web");
      ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
      const session = await ort.InferenceSession.create(modelAsset.url, {
        executionProviders: ["wasm"],
      });
      return { ort, session };
    })();
    sessionPromise.catch(() => (sessionPromise = null));
  }
  return sessionPromise;
}

const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));

export async function detect(img: HTMLImageElement, minScore = 0.3): Promise<Detection[]> {
  const { ort, session } = await load();
  const S = 640;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, S, S);
  const px = ctx.getImageData(0, 0, S, S).data;
  const data = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) {
    data[i] = px[i * 4]! / 255;
    data[i + S * S] = px[i * 4 + 1]! / 255;
    data[i + 2 * S * S] = px[i * 4 + 2]! / 255;
  }
  const input = new ort.Tensor("float32", data, [1, 3, S, S]);
  const out = await session.run({ [session.inputNames[0]!]: input });
  const logits = out["logits"]!.data as Float32Array;
  const boxes = out["pred_boxes"]!.data as Float32Array;
  const n = boxes.length / 4;
  const C = logits.length / n;
  const res: Detection[] = [];
  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    let bi = 0;
    for (let k = 0; k < C; k++) {
      const v = logits[i * C + k]!;
      if (v > best) {
        best = v;
        bi = k;
      }
    }
    const score = sigmoid(best);
    if (score < minScore) continue;
    const cx = boxes[i * 4]!,
      cy = boxes[i * 4 + 1]!,
      w = boxes[i * 4 + 2]!,
      h = boxes[i * 4 + 3]!;
    res.push({
      label: LABELS[bi] ?? "object",
      score,
      x: Math.max(0, cx - w / 2),
      y: Math.max(0, cy - h / 2),
      w: Math.min(1, w),
      h: Math.min(1, h),
    });
  }
  return res.sort((a, b) => b.score - a.score).slice(0, 40);
}
