export type Memory = { id: string; text: string; createdAt: number };
const KEY = "vision-memories";

export function loadMemories(): Memory[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
export function saveMemories(m: Memory[]) {
  localStorage.setItem(KEY, JSON.stringify(m));
}
export function addMemory(text: string) {
  const m = loadMemories();
  m.unshift({ id: crypto.randomUUID(), text, createdAt: Date.now() });
  saveMemories(m);
}
export function removeMemory(id: string) {
  saveMemories(loadMemories().filter((x) => x.id !== id));
}
