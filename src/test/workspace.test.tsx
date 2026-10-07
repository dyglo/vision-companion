import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Index } from "@/routes/index";
import { ThinkingStatus } from "@/components/workspace/ThreadPanel";
import {
  fitFrame,
  markerColor,
  padBox,
  relevantPrevious,
  retainMarkers,
  cropFullResolution,
  toggleComparison,
  type ThreadEntry,
  type Selection,
} from "@/lib/workspace";
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
  expect(screen.getByLabelText("Conversation")).toBeInTheDocument();
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
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.stubGlobal("PointerEvent", MouseEvent);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(true);
  Element.prototype.releasePointerCapture = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,test");
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("workspace geometry and context", () => {
  it("extracts lossless crops at source resolution without shrinking pixels", () => {
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(4000);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(3000);
    const draw = vi.fn();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
      drawImage: draw,
    } as unknown as CanvasRenderingContext2D);
    const image = document.createElement("img");
    cropFullResolution(image, { x: 0.1, y: 0.2, w: 0.4, h: 0.5 });
    expect(draw).toHaveBeenCalledWith(image, 400, 600, 1600, 1500, 0, 0, 1600, 1500);
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith("image/png");
  });
  it("caps comparison at four while allowing deselection", () => {
    const targets = Array.from({ length: 5 }, (_, index) => ({
      key: String(index),
      number: index + 1,
      box: { x: 0, y: 0, w: 0.1, h: 0.1 },
      label: "Object",
      score: 1,
    }));
    let selected: Selection[] = [];
    for (const target of targets) selected = toggleComparison(selected, target);
    expect(selected).toHaveLength(4);
    expect(toggleComparison(selected, targets[0]!)).toHaveLength(3);
  });
  it("keeps a tapped target identity and registers fresh annotations on retry", () => {
    const selection = {
      key: "candidate:7",
      number: 8,
      box: answer.annotations[0]!,
      label: "Pear",
      score: 0.65,
    };
    const entry: ThreadEntry = { id: "first", sender: "assistant", selection, answer };
    const registered = retainMarkers(entry, []);
    expect(registered[0]).toMatchObject({ key: selection.key, number: 1 });
    const retried = retainMarkers(
      {
        ...entry,
        markers: registered,
        answer: {
          ...answer,
          annotations: [{ label: "Person", confidence: 0.9, x: 0.35, y: 0.2, w: 0.15, h: 0.6 }],
        },
      },
      registered,
    );
    expect(retried[0]).toMatchObject({ label: "Person", number: 3 });
  });
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
  it("enforces the four-target limit in the canvas and frees a slot on deselection", async () => {
    mocks.ask.mockResolvedValue({
      answer: {
        ...answer,
        annotations: Array.from({ length: 5 }, (_, index) => ({
          label: `Object ${index + 1}`,
          confidence: 0.9,
          x: 0.02 + index * 0.19,
          y: 0.1,
          w: 0.12,
          h: 0.2,
        })),
      },
    });
    render(<Index />);
    await upload();
    ask("Find objects");
    await screen.findByText("Two useful objects");
    fireEvent.click(screen.getByRole("button", { name: "Compare (C)" }));
    for (let number = 1; number <= 5; number++)
      fireEvent.click(screen.getByRole("button", { name: `Target ${number}: Object ${number}` }));
    expect(screen.getByRole("button", { name: "Target 4: Object 4" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Target 5: Object 5" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "Target 1: Object 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Target 5: Object 5" }));
    expect(screen.getByRole("button", { name: "Target 5: Object 5" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(mocks.ask).toHaveBeenCalledTimes(1);
  });
  it("zooms a target, sends a dedicated deep crop, and resets without removing annotations", async () => {
    render(<Index />);
    await upload();
    ask("Find objects");
    await screen.findByText("Two useful objects");
    fireEvent.click(screen.getByRole("button", { name: "Focus Zoom (Z)" }));
    fireEvent.click(screen.getByRole("button", { name: "Target 2: Cup" }));
    expect(screen.getByTestId("zoom-layer").style.transform).not.toContain("scale(1)");
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(2));
    expect(mocks.ask.mock.calls[1]![0].data).toMatchObject({
      mode: "selection",
      deepInspection: true,
      targets: [{ number: 2, label: "Cup" }],
    });
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith("image/png");
    expect(screen.getByText("Deep crop inspection · original resolution")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("zoom-layer").style.transform).toBe("translate(0px, 0px) scale(1)");
    expect(screen.getByRole("button", { name: "Target 1: Pear" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Target 2: Cup" }));
    fireEvent.click(screen.getByRole("button", { name: "Recenter photo" }));
    expect(screen.getByTestId("zoom-layer").style.transform).toBe("translate(0px, 0px) scale(1)");
  });
  it("compares targets with multiple crops and renders the structured result", async () => {
    render(<Index />);
    await upload();
    ask("Find objects");
    await screen.findByText("Two useful objects");
    fireEvent.keyDown(window, { key: "c" });
    expect(screen.getByRole("button", { name: "Compare (C)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Target 1: Pear" }));
    expect(screen.getByRole("button", { name: /^Ask$/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Target 2: Cup" }));
    expect(screen.getByText("Comparing: #01 Pear, #02 Cup")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Target 1: Pear" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    mocks.ask.mockImplementationOnce(({ data }) =>
      Promise.resolve({
        answer: {
          ...answer,
          headline: "Comparison ready",
          suggestedMemory: null,
          annotations: [],
          comparison: data.targets.map((target: { id: string; label: string }) => ({
            targetId: target.id,
            title: target.label,
            condition: "No visible damage",
            dimensionsAndStyle: "No scale available",
            details: "Surface looks smooth",
          })),
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Compare condition & wear" }));
    fireEvent.click(screen.getByRole("button", { name: /^Ask$/ }));
    await screen.findByText("Comparison ready");
    expect(mocks.ask.mock.calls[1]![0].data).toMatchObject({
      mode: "comparison",
      targets: [
        { number: 1, label: "Pear" },
        { number: 2, label: "Cup" },
      ],
    });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByText("No visible damage")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Clear comparison" }));
    expect(screen.getByText("Comparing: Select 2–4 objects")).toBeInTheDocument();
  });
  it("draws and cancels regions, then retains a submitted Custom marker through answers", async () => {
    render(<Index />);
    await upload();
    fireEvent.keyDown(window, { key: "r" });
    const stage = screen.getByTestId("image-stage");
    const draw = () => {
      fireEvent.pointerDown(stage, { button: 0, clientX: 160, clientY: 120 });
      fireEvent.pointerMove(stage, { clientX: 400, clientY: 300 });
      fireEvent.pointerUp(stage, { clientX: 400, clientY: 300 });
    };
    draw();
    expect(screen.getByRole("form", { name: "Ask about drawn area" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Ask about this area" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("form", { name: "Ask about drawn area" })).toBeNull();
    expect(mocks.ask).not.toHaveBeenCalled();
    draw();
    fireEvent.change(screen.getByRole("textbox", { name: "Ask about this area" }), {
      target: { value: "Read this label" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Ask about this area" }), { key: "v" });
    expect(screen.getByRole("button", { name: "Draw Box (R)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.submit(screen.getByRole("form", { name: "Ask about drawn area" }));
    expect(screen.getByRole("button", { name: "Target 1: Custom" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(1));
    await screen.findByText("Two useful objects");
    expect(mocks.ask.mock.calls[0]![0].data).toMatchObject({
      mode: "selection",
      question: "Read this label",
      detectorLabel: "Custom",
    });
    expect(screen.getByRole("button", { name: "Target 1: Custom" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show target 1: Custom" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pointer (V)" }));
    fireEvent.click(screen.getByRole("button", { name: "Target 1: Custom" }));
    expect(screen.getByText("Target #1 · Custom")).toBeInTheDocument();
  });
  it("rotates the plain thinking status without a spinner", () => {
    vi.useFakeTimers();
    const view = render(<ThinkingStatus />);
    expect(screen.getByRole("status")).toHaveTextContent("Observing…");
    act(() => vi.advanceTimersByTime(2400));
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
    expect(view.container.querySelector("svg")).toBeNull();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retains earlier boxes during and after follow-ups, with stable numbering and explicit controls", async () => {
    render(<Index />);
    await upload();
    ask("Find objects");
    await screen.findByText("Two useful objects");
    const first = screen.getByRole("button", { name: "Target 1: Pear" });
    fireEvent.click(screen.getByRole("button", { name: "Show target 1: Pear" }));
    const pending = deferred<{ answer: VisionAnswer }>();
    mocks.ask.mockReturnValueOnce(pending.promise);
    ask("Who is next to it?");
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(2));
    expect(first).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Target 2: Cup" })).toBeInTheDocument();
    await act(async () =>
      pending.resolve({
        answer: {
          ...answer,
          headline: "Another object",
          suggestedMemory: null,
          annotations: [{ label: "Person", confidence: 0.95, x: 0.35, y: 0.2, w: 0.15, h: 0.6 }],
        },
      }),
    );
    expect(first).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Target 3: Person" })).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Show target 3: Person" }));
    expect(first).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear selected object" }));
    expect(first).toBeInTheDocument();
    ask("focus only on #3");
    expect(screen.queryByRole("button", { name: "Target 1: Pear" })).toBeNull();
    expect(screen.getByRole("button", { name: "Target 3: Person" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recenter photo" }));
    expect(screen.getByRole("button", { name: "Target 1: Pear" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove annotation 1" }));
    expect(screen.queryByRole("button", { name: "Target 1: Pear" })).toBeNull();
    ask("show all annotations");
    expect(screen.getByRole("button", { name: "Target 1: Pear" })).toBeInTheDocument();
    ask("remove annotation 2");
    expect(screen.queryByRole("button", { name: "Target 2: Cup" })).toBeNull();
    expect(mocks.ask).toHaveBeenCalledTimes(2);
  });
  it("reuses existing annotation numbers when the same boxes are returned", async () => {
    render(<Index />);
    await upload();
    ask("Find objects");
    await screen.findByText("Two useful objects");
    ask("Explain them");
    await waitFor(() => expect(screen.getAllByText("Two useful objects")).toHaveLength(2));
    expect(screen.getAllByRole("button", { name: "Target 1: Pear" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Target 2: Cup" })).toHaveLength(1);
  });
  it("preserves landing, transitions on upload and keeps selected scene context through focus", async () => {
    render(<Index />);
    expect(screen.getByText("See more in every image.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Conversation")).not.toBeInTheDocument();
    await upload();
    expect(screen.getByLabelText("Conversation")).toBeInTheDocument();
    expect(mocks.detect).not.toHaveBeenCalled();
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(screen.queryByText("What would you like to explore?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Target \d/ })).not.toBeInTheDocument();
    ask("Find objects");
    await screen.findByText("Two useful objects");
    expect(mocks.detect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Target 2: Cup" })).toBeInTheDocument();
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
    expect(mocks.detect).toHaveBeenCalledTimes(1);
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
    await waitFor(() => expect(mocks.ask).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Back to start" }));
    await act(async () => pending.resolve({ answer }));
    expect(screen.getByText("See more in every image.")).toBeInTheDocument();
    expect(screen.queryByText("Two useful objects")).not.toBeInTheDocument();
  });
  it("ignores detection that finishes after changing photo", async () => {
    const pending = deferred<[]>();
    mocks.detect.mockReturnValue(pending.promise);
    render(<Index />);
    await upload();
    ask("Find objects");
    fireEvent.click(screen.getByRole("button", { name: "Back to start" }));
    await act(async () => pending.resolve([]));
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(screen.getByText("See more in every image.")).toBeInTheDocument();
  });
  it("resizes width and height, then restores the same photo from full view", async () => {
    render(<Index />);
    await upload();
    const image = screen.getByAltText("Your photo");
    const root = image.closest("main")!;
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize conversation and canvas" }), {
      key: "ArrowRight",
    });
    expect(root.style.getPropertyValue("--thread-width")).toBe("26%");
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize artifact width and height" }), {
      key: "ArrowUp",
    });
    expect(root.style.getPropertyValue("--artifact-height")).toBe("97%");
    fireEvent.click(screen.getByRole("button", { name: "Full view" }));
    expect(root).toHaveClass("is-full-view");
    fireEvent.click(screen.getByRole("button", { name: "Exit full view" }));
    expect(root).not.toHaveClass("is-full-view");
    expect(screen.getByAltText("Your photo")).toBe(image);
    expect(mocks.detect).not.toHaveBeenCalled();
  });
  it("keeps the same object type color and separates different types", () => {
    expect(markerColor("Person")).toBe(markerColor("person"));
    expect(markerColor("cup 2")).toBe(markerColor("cup"));
    expect(markerColor("Person")).not.toBe(markerColor("cup"));
  });
});
