import { AsyncLocalStorage } from "node:async_hooks";

export class AIAccessError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export interface AIContext {
  organizationId: string;
  userId: string;
  feature: string;
  endpoint: string;
  failure?: AIAccessError;
}

export const aiContext = new AsyncLocalStorage<AIContext>();

export function requireAIContext(): AIContext {
  const context = aiContext.getStore();
  if (!context) throw new AIAccessError(403, "AI_CONTEXT_REQUIRED", "AI access context is required.");
  if (context.failure) throw context.failure;
  return context;
}
