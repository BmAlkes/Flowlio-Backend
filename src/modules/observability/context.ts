import { AsyncLocalStorage } from "node:async_hooks";
export const requestContext = new AsyncLocalStorage<{ correlationId: string; release: string }>();
