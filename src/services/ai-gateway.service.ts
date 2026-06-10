import { OpenAIService } from "@/services/openai.service"
import { database } from "@/configs/connection.config"
import { aiUsageLogs, aiTokenLimits } from "@/schema/schema"
import { sql, and, isNull, eq } from "drizzle-orm"
import { AIChatParams, AIChatResult } from "@/types/ai-gateway.types"

export class AIGateway {
  private provider: string = "openai"
  private openaiService: OpenAIService

  constructor() {
    this.openaiService = new OpenAIService()
  }

  async chat(params: AIChatParams): Promise<AIChatResult> {
    const { feature, model = "gpt-4o", messages, orgId, userId, metadata } =
      params

    try {
      if (this.provider === "openai") {
        // generateAdvancedResponse is the existing OpenAIService method that accepts
        // a messages array (via conversationHistory) and returns a response with usage stats.
        // It surfaces total_tokens via result.metadata.tokens.
        // promptTokens / completionTokens are not individually exposed by this method
        // and are recorded as 0 until a lower-level method is available.
        const lastUserIdx = [...messages]
          .reverse()
          .findIndex((m) => m.role === "user")
        const userMsgIdx =
          lastUserIdx === -1 ? -1 : messages.length - 1 - lastUserIdx
        const userInput =
          userMsgIdx !== -1 ? messages[userMsgIdx].content : ""
        const conversationHistory =
          userMsgIdx > 0
            ? messages.slice(0, userMsgIdx).map((m) => ({
                role: m.role,
                content: m.content,
              }))
            : []

        const result = await this.openaiService.generateAdvancedResponse(
          userInput,
          { conversationHistory }
        )

        const content = result.response
        const totalTokens = result.metadata?.tokens ?? 0
        const promptTokens = result.metadata?.promptTokens ?? 0
        const completionTokens = result.metadata?.completionTokens ?? 0

        await database.insert(aiUsageLogs).values({
          feature,
          provider: this.provider,
          model,
          promptTokens,
          completionTokens,
          totalTokens,
          organizationId: orgId,
          userId,
          status: "success",
          ...(metadata !== undefined ? { metadata } : {}),
        })

        await database
          .update(aiTokenLimits)
          .set({
            tokensUsed: sql`${aiTokenLimits.tokensUsed} + ${totalTokens}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(aiTokenLimits.organizationId, orgId),
              isNull(aiTokenLimits.userId),
              isNull(aiTokenLimits.feature),
              eq(aiTokenLimits.isActive, true)
            )
          )

        return {
          content,
          promptTokens,
          completionTokens,
          totalTokens,
          provider: this.provider,
          model,
        }
      }

      throw new Error("Provider not supported yet")
    } catch (err: any) {
      await database.insert(aiUsageLogs).values({
        feature,
        provider: this.provider,
        model,
        organizationId: orgId,
        userId,
        status: "error",
        errorMessage: err.message,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      })

      throw err
    }
  }
}

export const aiGateway = new AIGateway()
