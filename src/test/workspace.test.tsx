import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Index } from "@/routes/index";
import { fitFrame, padBox, relevantPrevious, type ThreadEntry } from "@/lib/workspace";
import type { VisionAnswer } from "@/lib/vision.functions";

const mocks = vi.hoisted(() => ({ detect: vi.fn(), ask: vi.fn() }));
vi.mock("@/lib/detector", () => ({ detect: mocks.detect }));
vi.mock("@/lib/vision.functions", () => ({ askVision: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => mocks.ask }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const answer: VisionAnswer = {
  name: "Scene",
  confidence: 0.9,
  headline: "Two useful objects",
  explanation: "A pear and a cup.",
  nextSteps: ["Explain the scene"],
  suggestedMemory: "Owns a ceramic cup",
  annotations: [
    { label: "Pear", confidence: 0.65, x: 0.1, y: 0.2, w: 0.2, h: 0.3 },
    { label: "Cup", confidence: 0.9, x: 0.6, y: 0.2, w: 0.2, h: 0.3 },
  ],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function upload() {
  fireEvent.change(screen.getByLabelText("Upload photo"), {
    target: { files: [new File(["image"], "photo.png", { type: "image/png" })] },
  });
  fireEvent.load(screen.getByAltText("Your photo"));
  await waitFor(() => expect(screen.getByText(/objects found/)).toBeInTheDocument());
}
function ask(question: string) {
  fireEvent.change(screen.getByLabelText("Ask about this object or the whole photo"), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
}
beforeEach(() => {
  mocks.detect
    .mockReset()
    .mockResolvedValue([{ label: "cup", score: 0.9, x: 0.6, y: 0.2, w: 0.2, h: 0.3 }]);
  mocks.ask.mockReset().mockResolvedValue({ answer });
  localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  if (!URL.createObjectURL)
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: () => "",
    });
  if (!URL.revokeObjectURL)
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-photo");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,test");
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("workspace geometry and context", () => {
  it("contains landscape and portrait images without clipping", () => {
    expect(fitFrame(600, 600, 1200, 600)).toEqual({ left: 0, top: 150, width: 600, height: 300 });
    expect(fitFrame(600, 600, 600, 1200)).toEqual({ left: 150, top: 0, width: 300, height: 600 });
    const padded = padBox({ x: 0.95, y: 0.95, w: 0.05, h: 0.05 });
    expect(padded.x + padded.w).toBeLessThanOrEqual(1);
    expect(padded.y + padded.h).toBeLessThanOrEqual(1);
  });
  it("retains scene context for a marker but excludes unrelated object answers", () => {
    const thread: ThreadEntry[] = [{ id: "scene", sender: "assistant", answer }];
    const target = {
      key: "scene:1",
      number: 2,
      label: "Cup",
      score: 0.9,
      box: answer.annotations[1]!,
    };
    expect(relevantPrevious(thread, target)).toContain("Previous scene answer");
    expect(relevantPrevious(thread, { ...target, key: "other" })).toBeNull();
  });
});

describe("split workspace interactions", () => {
  it("preserves landing, transitions on upload and keeps selected scene context through focus", async () => {
    render(<Index />);
    expect(screen.getByText("See more in every image.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Conversation")).not.toBeInTheDocument();
    await upload();
    expect(screen.getByLabelText("Conversation")).toBeInTheDocument();
    ask("Find objects");
    await screen.findByText("Two useful objects");
    fireEvent.click(screen.getByRole("button", { name: "Show target 2: Cup" }));
    expect(screen.getByText("Target #2 · Cup")).toBeInTheDocument();
    ask("How do I clean it?");
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(2));
    expect(mocks.ask.mock.calls[1]![0].data).toMatchObject({
      mode: "selection",
      detectorLabel: "Cup",
      question: "How do I clean it?",
    });
    expect(mocks.ask.mock.calls[1]![0].data.previous).toContain("Previous scene answer");
  });
  it("saves only with opt-in and allows skipping", async () => {
    render(<Index />);
    await upload();
    ask("What is here?");
    await screen.findByText("Two useful objects");
    expect(localStorage.getItem("vision-memories")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(localStorage.getItem("vision-memories")).toBeNull();
    ask("Describe the scene");
    await screen.findByRole("button", { name: "Save" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(JSON.parse(localStorage.getItem("vision-memories")!)[0].text).toBe("Owns a ceramic cup");
  });
  it("ignores a pending vision response after reset", async () => {
    const pending = deferred<{ answer: VisionAnswer }>();
    mocks.ask.mockReturnValue(pending.promise);
    render(<Index />);
    await upload();
    ask("Describe this");
    fireEvent.click(screen.getByRole("button", { name: "Back to start" }));
    await act(async () => pending.resolve({ answer }));
    expect(screen.getByText("See more in every image.")).toBeInTheDocument();
    expect(screen.queryByText("Two useful objects")).not.toBeInTheDocument();
  });
});
