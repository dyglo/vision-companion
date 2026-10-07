import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z
  .object({
    image: z.string().max(4_000_000),
    crop: z.string().max(24_000_000),
    mode: z.enum(["selection", "scene", "comparison"]),
    deepInspection: z.boolean().optional().default(false),
    targets: z
      .array(
        z.object({
          id: z.string().max(100),
          number: z.number().int().positive(),
          label: z.string().max(300),
          box: z.object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            w: z.number().positive().max(1),
            h: z.number().positive().max(1),
          }),
          cropBox: z
            .object({
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
              w: z.number().positive().max(1),
              h: z.number().positive().max(1),
            })
            .optional(),
          crop: z.string().max(24_000_000),
        }),
      )
      .max(4)
      .optional()
      .default([]),
    detectorLabel: z.string().nullable(),
    detectorScore: z.number().nullable(),
    detectorCandidates: z
      .array(
        z.object({
          id: z.number().int(),
          label: z.string(),
          score: z.number(),
          x: z.number(),
          y: z.number(),
          w: z.number(),
          h: z.number(),
        }),
      )
      .max(40),
    question: z.string().max(1000).nullable(),
    previous: z.string().max(4000).nullable(),
    memories: z.array(z.string().max(300)).max(50),
  })
  .superRefine((data, context) => {
    if (data.mode === "comparison" && data.targets.length < 2)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select two to four objects to compare.",
        path: ["targets"],
      });
    if (
      data.targets.reduce((size, target) => size + target.crop.length, data.crop.length) >
      64_000_000
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Comparison crops are too large. Select smaller regions.",
        path: ["targets"],
      });
  });

export type VisionAnswer = {
  name: string;
  confidence: number;
  headline: string;
  explanation: string;
  nextSteps: string[];
  suggestedMemory: string | null;
  comparison?: Array<{
    targetId: string;
    title: string;
    condition: string;
    dimensionsAndStyle: string;
    details: string;
  }>;
  annotations: Array<{
    label: string;
    confidence: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "confidence",
    "headline",
    "explanation",
    "nextSteps",
    "suggestedMemory",
    "annotations",
    "comparison",
  ],
  properties: {
    name: { type: "string" },
    confidence: { type: "number" },
    headline: { type: "string" },
    explanation: { type: "string" },
    nextSteps: { type: "array", items: { type: "string" } },
    suggestedMemory: { type: ["string", "null"] },
    comparison: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["targetId", "title", "condition", "dimensionsAndStyle", "details"],
        properties: {
          targetId: { type: "string" },
          title: { type: "string" },
          condition: { type: "string" },
          dimensionsAndStyle: { type: "string" },
          details: { type: "string" },
        },
      },
    },
    annotations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "confidence", "x", "y", "w", "h"],
        properties: {
          label: { type: "string" },
          confidence: { type: "number" },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
        },
      },
    },
  },
};

const SYSTEM = `You are a calm, practical vision assistant. You receive a full photo, an optional close-up, and on-device detector candidates. The detector only knows about 80 common classes and may be wrong.
In selection mode, identify and explain the tapped object. In scene mode, answer the user's request about the entire photo. If they ask to find, show, count, or label objects, return one annotation for EVERY visible matching object, not only detector matches.
In comparison mode, compare only the supplied targets using the full photo and each labeled full-resolution crop. Return one comparison row per target with its exact targetId, title, condition, dimensionsAndStyle, and details addressing the question. Do not infer real dimensions or age without visible evidence or a known scale; say when unavailable. In other modes return comparison: [].
For deep inspection, closely inspect the dedicated original-resolution crop for readable fine print, serial numbers, labels, surface condition, texture wear, and defects relevant to the question. Transcribe only legible text; say when detail is unreadable. Never invent missing digits or hidden defects. Crop coordinates are supplied in the full photo frame; annotations always remain in full-image coordinates.
Annotations use normalized full-image coordinates from 0 to 1, with x/y at the top-left. Prefer the supplied detector candidate coordinates when they match. Estimate coordinates directly from the image for missed objects. Return no unrelated annotations and no more than 20.
Be honest: confidence is 0..1; if below 0.7, say so plainly in the headline (e.g. "Probably a pear — I'm not fully sure.").
headline: one short sentence. explanation: 2–3 sentences on what it is / how it works. nextSteps: up to 3 short practical actions.
If the user asks a follow-up question, answer it in explanation (can be longer, plain prose) and keep headline short.
Use the user's saved memories when relevant and mention it naturally. suggestedMemory: a short first-person-about-the-user fact worth remembering (e.g. "Owns a Breville espresso machine"), only if genuinely useful and not already saved; otherwise null.`;

export const askVision = createServerFn({ method: "POST" })
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data }): Promise<{ answer?: VisionAnswer; error?: string }> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) return { error: "AI is not configured." };
    const ctx = [
      data.detectorLabel
        ? `Detector guess: "${data.detectorLabel}" (${Math.round((data.detectorScore ?? 0) * 100)}%).`
        : "Detector found nothing at this spot.",
      `Mode: ${data.mode}.`,
      data.deepInspection
        ? "Deep crop inspection requested. Read fine details from the original-resolution PNG crop."
        : "",
      data.targets.length
        ? `Inspection targets and crop order: ${JSON.stringify(data.targets.map(({ crop: _crop, ...target }) => target))}`
        : "",
      data.detectorCandidates.length
        ? `Detector candidates (normalized full-image boxes):\n${JSON.stringify(data.detectorCandidates)}`
        : "No detector candidates are available.",
      data.memories.length
        ? `Saved memories about the user:\n- ${data.memories.join("\n- ")}`
        : "No saved memories.",
      data.previous ? `Your previous answer about this object: ${data.previous}` : "",
      data.question ? `User question: ${data.question}` : "Explain the tapped object.",
    ].join("\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        instructions: SYSTEM,
        stream: true,
        store: false,
        reasoning: { effort: "low", summary: "auto" },
        include: ["reasoning.encrypted_content"],
        text: { format: { type: "json_schema", name: "answer", strict: true, schema } },
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: ctx },
              { type: "input_image", image_url: data.image },
              { type: "input_image", image_url: data.crop },
              ...data.targets
                .filter((target) => target.crop !== data.crop)
                .flatMap((target) => [
                  {
                    type: "input_text",
                    text: `Target #${target.number}: ${target.label} (targetId ${target.id})`,
                  },
                  { type: "input_image", image_url: target.crop },
                ]),
            ],
          },
        ],
      }),
    });
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => "");
      console.error("AI error", res.status, t);
      if (res.status === 429)
        return { error: "Too many requests right now. Try again in a moment." };
      if (res.status === 402) return { error: "AI credits are used up for this workspace." };
      return { error: "The assistant couldn't look at this right now." };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    let refused = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const p = line.slice(5).trim();
        if (!p || p === "[DONE]") continue;
        try {
          const ev = JSON.parse(p);
          if (ev.type === "response.output_text.delta") text += ev.delta;
          if (ev.type === "response.refusal.delta") refused = true;
          if (ev.type === "error" || ev.type === "response.failed") console.error("AI stream", p);
        } catch {
          /* partial */
        }
      }
    }
    if (refused) return { error: "The assistant declined to describe this." };
    try {
      return { answer: JSON.parse(text) as VisionAnswer };
    } catch {
      console.error("bad json", text);
      return { error: "The assistant's answer was incomplete. Try tapping again." };
    }
  });
