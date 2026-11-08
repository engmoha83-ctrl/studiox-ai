export function uid(prefix = ""): string {
  const r = (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/-/g, "");
  return prefix ? `${prefix}_${r.slice(0, 12)}` : r.slice(0, 16);
}
