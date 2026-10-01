export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const units: [number, string][] = [[60, "s"], [60, "m"], [24, "h"], [7, "d"], [4.35, "w"], [12, "mo"], [Infinity, "y"]];
  let n = s;
  for (const [div, u] of units) {
    if (n < div) return `${Math.floor(n)}${u} ago`;
    n /= div;
  }
  return "";
}

export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem("launchpad:" + key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function save(key: string, value: unknown) {
  try {
    localStorage.setItem("launchpad:" + key, JSON.stringify(value));
  } catch {
    /* storage can be unavailable in sandboxed iframes */
  }
}

const GH_COLORS: Record<string, string> = {
  GRAY: "#8b949e", BLUE: "#4493f8", GREEN: "#3fb950", YELLOW: "#d29922",
  ORANGE: "#db6d28", RED: "#f85149", PINK: "#db61a2", PURPLE: "#ab7df8",
};
export const projectColor = (c: string | undefined) => GH_COLORS[c ?? "GRAY"] ?? GH_COLORS.GRAY;

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** "https://GHE.Corp.com/x" → "ghe.corp.com" (mirrors the server's normalizeHost). */
export const normHost = (h: string) => h.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase() || "github.com";
