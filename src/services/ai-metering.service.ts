import type OpenAI from "openai";
import { AIAccessError, requireAIContext } from "@/utils/ai-context.util";
import { reserveAITokens, settleAITokens } from "@/services/ai-quota.service";
import { logger } from "@/utils/logger.util";

type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type Usage = { promptTokens: number; completionTokens: number; totalTokens: number };

// UTF-8 bytes conservatively bound text tokens. Each gpt-4o image uses a fixed
// high-detail allowance instead of counting base64 bytes as text tokens.
export function estimateChatReservation(params: ChatParams): number {
  let images = 0;
  const text = JSON.stringify(params.messages, (key, value) => {
    if (key === "image_url") { images++; return ""; }
    return value;
  });
  return Buffer.byteLength(text, "utf8") + params.messages.length * 32 + 64
    + images * 4096 + (params.max_tokens ?? 3000);
}

export async function meterAI<T>(
  model: string, reserved: number, invoke: () => Promise<T>, getUsage: (value: T) => Usage,
  metadata?: Record<string, unknown>,
): Promise<T> {
  const context = requireAIContext();
  let reservation: Awaited<ReturnType<typeof reserveAITokens>>;
  try {
    reservation = await reserveAITokens(context, reserved, model, metadata);
  } catch (error) {
    context.failure = error instanceof AIAccessError ? error :
      new AIAccessError(503, "SERVICE_UNAVAILABLE", "Unable to verify AI quota. Please try again.");
    throw context.failure;
  }

  let result: T;
  try {
    result = await invoke();
  } catch (error) {
    // A definite provider rejection has no usage. A timeout/network interruption
    // can have been processed remotely: retain the reservation for reconciliation.
    const status = (error as { status?: number })?.status;
    const rejected = typeof status === "number" && status >= 400 && status < 500 && status !== 408;
    try {
      if (rejected) await settleAITokens(reservation, { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, "error");
    } catch (settlementError) { logger.error("AI rejection settlement failed", settlementError); }
    context.failure = new AIAccessError(503, "AI_PROVIDER_UNAVAILABLE", "AI service is unavailable. Please try again later.");
    throw context.failure;
  }

  try {
    const usage = getUsage(result);
    await settleAITokens(reservation, usage, "success");
  } catch (error) {
    // Do not insert another log or call the provider again after a billing failure.
    logger.error("AI usage settlement failed; reservation retained", error);
    context.failure = new AIAccessError(503, "AI_ACCOUNTING_UNAVAILABLE", "Unable to confirm AI usage. Please try again later.");
    throw context.failure;
  }
  return result;
}

export function meteredChat(client: OpenAI, params: ChatParams) {
  return meterAI(String(params.model), estimateChatReservation(params),
    () => client.chat.completions.create(params),
    (response) => {
      if (!response.usage) throw new Error("Provider did not return token usage");
      return { promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens };
    });
}

export function meteredImage(client: OpenAI, params: OpenAI.Images.ImageGenerateParams) {
  return meterAI(String(params.model), 1000, () => client.images.generate(params),
    () => ({ promptTokens: 1000, completionTokens: 0, totalTokens: 1000 }),
    { accounting: "fixed_image_credits", creditsPerImage: 1000 });
}
