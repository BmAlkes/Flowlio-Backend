import { connection } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { createObservability } from "./store";
let lastWarning = 0;
export const observability = createObservability(connection, () => {
  if (Date.now()-lastWarning>60000) { lastWarning=Date.now(); logger.warn("Operational telemetry could not be persisted; check database health"); }
});
export function startTelemetryFlush() {
  const timer = setInterval(() => { void observability.flush(); },5000);
  timer.unref();
  return timer;
}
