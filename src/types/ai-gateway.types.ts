export interface AIChatParams {
  feature: string
  model?: string // default "gpt-4o"
  messages: { role: "system" | "user" | "assistant"; content: string }[]
  orgId: string
  userId: string
  metadata?: Record<string, any>
}

export interface AIChatResult {
  content: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  provider: string
  model: string
}
