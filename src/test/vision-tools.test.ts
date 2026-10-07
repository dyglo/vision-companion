import { afterEach, describe, expect, it, vi } from "vitest";
import { askVision } from "@/lib/vision.functions";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator: (validate: (data: unknown) => unknown) => ({
      handler: (handle: (args: { data: unknown }) => unknown) => ({ validate, handle }),
    }),
  }),
}));
const server = askVision as unknown as {
  validate: (data: unknown) => Record<string, unknown>;
  handle: (args: { data: unknown }) => Promise<unknown>;
};
const standard = {
  image: "data:image/jpeg;base64,full",
  crop: "data:image/jpeg;base64,crop",
  mode: "selection",
  detectorLabel: "Cup",
  detectorScore: 0.9,
  detectorCandidates: [],
  question: "What is this?",
  previous: null,
  memories: [],
};
const targets = [1, 2].map((number) => ({
  id: `target:${number}`,
  number,
  label: `Cup ${number}`,
  box: { x: 0.1 * number, y: 0.2, w: 0.2, h: 0.3 },
  crop: `data:image/png;base64,crop${number}`,
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("additive vision tool requests", () => {
  it("accepts existing selection and scene requests without new fields", () => {
    expect(server.validate(standard)).toMatchObject({
      mode: "selection",
      targets: [],
      deepInspection: false,
    });
    expect(server.validate({ ...standard, mode: "scene" })).toMatchObject({ mode: "scene" });
  });
  it("rejects comparison outside two to four targets", () => {
    expect(() =>
      server.validate({ ...standard, mode: "comparison", targets: targets.slice(0, 1) }),
    ).toThrow();
    expect(() =>
      server.validate({
        ...standard,
        mode: "comparison",
        targets: [...targets, ...targets, targets[0]],
      }),
    ).toThrow();
    expect(server.validate({ ...standard, mode: "comparison", targets })).toMatchObject({
      targets,
    });
  });
  it("passes labeled PNG crops and structured comparison schema to the gateway", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "test-only-key");
    const answer = {
      name: "Comparison",
      confidence: 0.9,
      headline: "Two cups",
      explanation: "Different wear.",
      nextSteps: [],
      suggestedMemory: null,
      annotations: [],
      comparison: targets.map((target) => ({
        targetId: target.id,
        title: target.label,
        condition: "Worn",
        dimensionsAndStyle: "Unknown size",
        details: "Visible scratches",
      })),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: JSON.stringify(answer) })}\n\ndata: [DONE]\n\n`,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await server.handle({
      data: server.validate({ ...standard, mode: "comparison", targets }),
    });
    expect(result).toEqual({ answer });
    const request = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(
      request.input[0].content
        .filter((part: { type: string }) => part.type === "input_image")
        .map((part: { image_url: string }) => part.image_url),
    ).toEqual([standard.image, standard.crop, ...targets.map((target) => target.crop)]);
    expect(request.text.format.schema.required).toContain("comparison");
    expect(request.instructions).toContain("Do not infer real dimensions or age");
  });
  it("accepts deep crops without changing selection mode", () => {
    expect(
      server.validate({
        ...standard,
        deepInspection: true,
        crop: targets[0]!.crop,
        targets: [targets[0]],
      }),
    ).toMatchObject({ mode: "selection", deepInspection: true });
  });
});
