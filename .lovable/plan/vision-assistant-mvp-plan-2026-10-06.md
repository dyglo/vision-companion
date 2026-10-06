# Vision Assistant MVP — Plan

## Who it's for
Everyday people who take a photo of something and want to know: what is this, how does it work, what should I do next.

## The one core flow
```text
Open app -> Upload photo -> Photo fills the screen, nothing on top
        -> Tap an object -> Soft outline + label appear on that object
        -> Detail text appears in an empty area of the photo (like the reference)
        -> Ask a follow-up question in one thin input line
        -> Assistant may suggest "Remember this?" -> you choose Save / Skip
```

## Screens (only two)
1. **Start** — full-screen dark canvas, app name at top center, one line of text and one "Choose a photo" action. Drag-and-drop also works.
2. **Photo view** — the photo full-bleed and slightly dimmed only after a tap.
   - Top bar like the reference: small text links left (Memory, New photo), name centered.
   - No cards, no panels. Text sits directly on the photo with a subtle shadow for readability, placed on the side of the photo away from the tapped object.
   - Tapped object: thin light outline + tiny uppercase label (like "KEYS").
   - A short headline ("This is an espresso machine."), 2–3 sentences of explanation, then up to 3 next steps as plain lines with small square markers.
   - Uncertain identifications read honestly: "Probably a pear — about 60% sure. Is that right?" with Yes / It's something else.
   - Bottom: one thin "Ask about this…" line. Answers replace the detail text, not stack into a chat log.
   - Tap empty space to clear everything back to the clean photo.

## Memory
- Assistant offers memories ("You own a Breville espresso machine") — never saves silently.
- Saved memories are used in later answers ("Last time you said the filter was new…").
- A plain full-screen Memory list to view and delete.

## Out of scope for MVP
Live camera, video, feeds, accounts on multiple devices, sharing.

## Visual direction
Dark, photographic, quiet. Light sans-serif (e.g. Inter Tight-style grotesk alternative such as "Geist"), white text, one accent color only for the active outline. Gentle fades, no bouncing.

## Decisions for you
1. **Memory storage**: keep in this browser only (simplest, no sign-in) or save to an account so it follows you (needs sign-in)?
2. **Tapping where nothing was detected**: should the assistant still try to explain that spot? (Recommended: yes — the detector only knows ~80 common object types.)
3. **Follow-up history**: keep only the latest answer on screen (cleanest), or allow scrolling back through past answers for that object?

## Technical details
- Detection: YOLO26n exported to ONNX, run in-browser with onnxruntime-web (WebGPU, WASM fallback). Boxes kept invisible as tap targets; confidence below ~0.5 flagged as uncertain. Model file hosted as a project asset.
- Explanations and follow-ups: server function calling Lovable AI (vision-capable default model) with the full image, the tapped crop, detector label + confidence, and relevant memories; strict JSON output (name, confidence, explanation, next steps, suggested memory).
- Memory: localStorage or Lovable Cloud table depending on decision 1.
- Routes: `/` (start + photo view), `/memory`.
