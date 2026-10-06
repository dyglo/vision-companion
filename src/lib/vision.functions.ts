import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  image: z.string().max(4_000_000),
  crop: z.string().max(2_000_000),
  detectorLabel: z.string().nullable(),
  detectorScore: z.number().nullable(),
  question: z.string().max(1000).nullable(),
  previous: z.string().max(4000).nullable(),
  memories: z.array(z.string().max(300)).max(50),
});

export type VisionAnswer = {
  name: string;
  confidence: number;
  headline: string;
  explanation: string;
  nextSteps: string[];
  suggestedMemory: string | null;
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "confidence", "headline", "explanation", "nextSteps", "suggestedMemory"],
  properties: {
    name: { type: "string" },
    confidence: { type: "number" },
    headline: { type: "string" },
    explanation: { type: "string" },
    nextSteps: { type: "array", items: { type: "string" } },
    suggestedMemory: { type: ["string", "null"] },
  },
};

const SYSTEM = `You are a calm, practical vision assistant. The user tapped a spot in their photo. You receive the full photo and a close-up crop of the tapped area, plus an optional on-device detector guess (which only knows ~80 common classes and may be wrong).
Identify the tapped object. Be honest: confidence is 0..1; if below 0.7, say so plainly in the headline (e.g. "Probably a pear — I'm not fully sure.").
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
      data.memories.length ? `Saved memories about the user:\n- ${data.memories.join("\n- ")}` : "No saved memories.",
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
        reasoning: { effort: "low" },
        text: { format: { type: "json_schema", name: "answer", strict: true, schema } },
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: ctx },
              { type: "input_image", image_url: data.image },
              { type: "input_image", image_url: data.crop },
            ],
          },
        ],
      }),
    });
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => "");
      console.error("AI error", res.status, t);
      if (res.status === 429) return { error: "Too many requests right now. Try again in a moment." };
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
