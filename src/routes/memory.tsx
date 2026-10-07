import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { loadMemories, removeMemory, type Memory } from "@/lib/memory";

export const Route = createFileRoute("/memory")({
  head: () => ({
    meta: [
      { title: "Memory — Lumen" },
      { name: "description", content: "What Lumen remembers about you and your things." },
      { property: "og:title", content: "Memory — Lumen" },
      { property: "og:description", content: "What Lumen remembers about you and your things." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MemoryPage,
});

function MemoryPage() {
  const [items, setItems] = useState<Memory[]>([]);
  useEffect(() => setItems(loadMemories()), []);
  return (
    <div className="min-h-screen px-6 py-6 md:px-8">
      <header className="flex items-center justify-between text-xs uppercase tracking-wide">
        <Link to="/" className="text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
        <span className="text-base normal-case tracking-tight">lumen</span>
        <span className="w-12" />
      </header>
      <main className="mx-auto mt-24 max-w-xl">
        <h1 className="text-3xl font-medium tracking-tight">What I remember</h1>
        <p className="mt-2 text-muted-foreground">
          Saved only in this browser. Remove anything at any time.
        </p>
        <ul className="mt-10 space-y-4">
          {items.length === 0 && <li className="text-muted-foreground">Nothing yet.</li>}
          {items.map((m) => (
            <li key={m.id} className="flex items-start gap-3 border-b pb-4">
              <span className="mt-2 size-2 shrink-0 bg-primary" />
              <span className="flex-1">{m.text}</span>
              <button
                className="text-xs uppercase text-muted-foreground hover:text-foreground"
                onClick={() => {
                  removeMemory(m.id);
                  setItems(loadMemories());
                }}
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
