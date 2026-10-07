# Full-screen multi-object vision upgrade

## Product direction
Keep the photo as the entire workspace. The default view stays quiet; results appear only when requested, using compact typography and lightweight numbered markers rather than panels.

## What will change
- Make uploaded photos fill the screen edge-to-edge with cover-style cropping, while keeping taps and annotations aligned to the original image.
- Keep tap-to-explain for a single object.
- Add a photo-wide prompt available before any tap, so requests such as “show every car” or “label the tools” can return and annotate multiple matching objects.
- Extend vision responses with a concise summary plus normalized annotation locations. Use browser detections as grounded candidates and allow the vision assistant to identify missed objects.
- Show multi-object results as small numbered markers and thin outlines on the photo, with a compact result rail placed in the least obstructive edge area.
- Keep follow-up questions in the same single-line composer; replace the prior answer instead of creating a chat transcript.
- Preserve explicit uncertainty and opt-in memory behavior.

## Responsive behavior
- Desktop: narrow result rail on the quieter side of the photo, with the image still visible beneath it.
- Mobile: short bottom sheet-like text region without a card background; annotations remain above it and the prompt stays reachable.
- Long answers scroll inside the result region instead of overlapping the header or prompt.

## Technical details
- Add `mode`, detector candidates, and annotation objects to the vision request/response schema.
- Convert between screen coordinates and natural-image normalized coordinates for `object-cover` rendering.
- Rework the main photo route state so a request can begin from either a tap selection or a whole-photo prompt.
- Add route metadata fields required for social previews and update the project architecture note for multi-object grounding.
- Verify single-object taps, photo-wide prompts, multi-object rendering, and desktop/mobile layouts in the live preview.
