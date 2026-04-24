import { clients, clientInteractions } from "../schema/schema";
import { eq, desc } from "drizzle-orm";
import { database } from "../configs/connection.config";

export interface LeadInsight {
  score: number; // 0-100
  temperature: "Hot" | "Warm" | "Cold";
  daysSinceLastContact: number;
  interactionCount: number;
  recommendedAction: string;
}

export const calculateLeadInsight = async (clientId: string): Promise<LeadInsight> => {
  // 1. Fetch client and interactions
  const client = await database.query.clients.findFirst({
    where: eq(clients.id, clientId)
  });

  const interactions = await database.query.clientInteractions.findMany({
    where: eq(clientInteractions.clientId, clientId),
    orderBy: [desc(clientInteractions.createdAt)]
  });

  if (!client) throw new Error("Client not found");

  const interactionCount = interactions.length;
  const lastInteraction = interactions[0]?.createdAt || client.createdAt;
  const daysSinceLastContact = Math.floor(
    (new Date().getTime() - new Date(lastInteraction).getTime()) / (1000 * 3600 * 24)
  );

  // 2. Base Score Calculation
  let score = 0;
  
  // Value weight (max 30 pts)
  const val = Number(client.leadValue || 0);
  if (val > 10000) score += 30;
  else if (val > 5000) score += 20;
  else if (val > 1000) score += 10;

  // Interaction weight (max 30 pts)
  if (interactionCount > 10) score += 30;
  else if (interactionCount > 5) score += 20;
  else if (interactionCount > 0) score += 10;

  // Recency weight (max 40 pts)
  if (daysSinceLastContact < 2) score += 40;
  else if (daysSinceLastContact < 7) score += 25;
  else if (daysSinceLastContact < 14) score += 10;

  // 3. Determine Temperature
  let temperature: "Hot" | "Warm" | "Cold" = "Cold";
  if (score > 70) temperature = "Hot";
  else if (score > 40) temperature = "Warm";

  // 4. Recommendation
  let recommendedAction = "Reach out to start a conversation";
  if (daysSinceLastContact > 7) recommendedAction = "Follow up - it's been a while";
  if (client.status === "Proposal Sent" && daysSinceLastContact > 2) recommendedAction = "Follow up on the sent proposal";
  if (temperature === "Hot" && client.status !== "Closed Won") recommendedAction = "High potential - prioritize closing";

  return {
    score,
    temperature,
    daysSinceLastContact,
    interactionCount,
    recommendedAction
  };
};
