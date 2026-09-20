export const releaseVersion = (value = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.APP_VERSION) =>
  value && /^[a-zA-Z0-9._-]{1,64}$/.test(value) ? value : "unknown";

export function redactText(value: string) {
  return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/((?:password|token|secret|authorization|cookie)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]");
}
export function redactLog(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.slice(0,50).map(item => redactLog(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0,50).map(([key,item]) =>
    [key, /password|token|secret|authorization|cookie|email|phone|address|body|payload|headers|params/i.test(key) ? "[redacted]" : redactLog(item, depth + 1)]));
  return value;
}
export function routeLabel(route: unknown): string {
  // Only route templates, never the incoming URL, query string or identifiers.
  return typeof route === "string" && route.length <= 160 && /^[/a-zA-Z0-9:_*-]+$/.test(route) ? route : "unmatched";
}
