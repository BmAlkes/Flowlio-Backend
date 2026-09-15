import { OpenAIService } from "@/services/openai.service";
import { AIChatParams, AIChatResult } from "@/types/ai-gateway.types";
import { requireAIContext } from "@/utils/ai-context.util";

export class AIGateway {
  private openaiService = new OpenAIService();

  async chat(params: AIChatParams): Promise<AIChatResult> {
    const context = requireAIContext();
    if (context.organizationId !== params.orgId || context.userId !== params.userId) {
      throw new Error("AI request identity mismatch");
    }
    const lastUserIdx = params.messages.map((m) => m.role).lastIndexOf("user");
    const result = await this.openaiService.generateAdvancedResponse(
      lastUserIdx < 0 ? "" : params.messages[lastUserIdx].content,
      { conversationHistory: lastUserIdx > 0 ? params.messages.slice(0, lastUserIdx) : [] },
    );
    return { content: result.response, promptTokens: result.metadata?.promptTokens ?? 0,
      completionTokens: result.metadata?.completionTokens ?? 0,
      totalTokens: result.metadata?.tokens ?? 0, provider: "openai", model: "gpt-4o" };
  }
}

export const aiGateway = new AIGateway();
