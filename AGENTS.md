<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- Object detection runs in the browser (onnxruntime-web, YOLO26n hosted as a Lovable asset); the vision server function grounds tap and whole-photo answers to detector candidates while permitting model-estimated boxes for missed objects — keeps keys server-side and supports exhaustive requested annotations.
- Memories live in browser localStorage (`src/lib/memory.ts`) — MVP has no accounts.
- Post-upload workspace state is owned by the index route; ThreadPanel and CanvasPanel share normalized marker identities, while geometry/context helpers live in lib/workspace.ts — isolates presentation and keeps historical object context consistent.
- Photo generations and per-entry attempt counters guard detection and AI completions; object URLs are revoked on replacement/unmount — prevents stale results from crossing photos or retries.
