import { database } from "@/configs/connection.config";
import { users, notifications, userOrganizations, clients } from "@/schema/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger.util";
import { sendEmail } from "@/configs/brevo.config";
import crypto from "crypto";
import { logActivity } from "./activity.util";

export const notifyClientInteraction = async (params: {
  interaction: any;
  actor: any;
  organizationId: string;
}) => {
  const { interaction, actor, organizationId } = params;
  
  try {
    // 1. Fetch client details to get assigned user
    const client = await database.query.clients.findFirst({
      where: eq(clients.id, interaction.clientId),
    });

    if (!client) {
      logger.error(`Client not found for interaction notification: ${interaction.clientId}`);
      return;
    }

    const usersToNotify = new Set<string>();

    // 2. Add assigned manager
    if (client.userId) {
      usersToNotify.add(client.userId);
    }

    // 3. Add organization admins
    const orgManagers = await database.query.userOrganizations.findMany({
      where: and(
        eq(userOrganizations.organizationId, organizationId),
        inArray(userOrganizations.role, ["admin", "owner", "manager", "subadmin"])
      ),
    });

    orgManagers.forEach(manager => usersToNotify.add(manager.userId));

    // Remove the actor from notification list
    usersToNotify.delete(actor.id);

    if (usersToNotify.size === 0) {
      logger.info("No users to notify for client interaction.");
      return;
    }

    // 4. Log as recent activity
    await logActivity({
      organizationId,
      actorId: actor.id,
      type: "client",
      action: "interaction",
      resource: "client",
      resourceId: client.id,
      message: `${actor.name} logged a ${interaction.type} for ${client.name}`,
      metadata: { interactionId: interaction.id, type: interaction.type }
    });

    // 5. Fetch details for all users to notify (need email and name)
    const targetUsers = await database.query.users.findMany({
      where: inArray(users.id, Array.from(usersToNotify)),
      columns: {
        id: true,
        email: true,
        name: true,
      }
    });

    for (const targetUser of targetUsers) {
      // Create in-app notification
      try {
        await database.insert(notifications).values({
          id: crypto.randomUUID(),
          userId: targetUser.id,
          organizationId,
          type: "client_interaction",
          title: `New Client Log: ${client.name}`,
          message: `${actor.name} logged a ${interaction.type}: ${interaction.content.substring(0, 100)}${interaction.content.length > 100 ? '...' : ''}`,
          data: { 
            clientId: client.id, 
            interactionId: interaction.id,
            interactionType: interaction.type 
          },
          read: false,
          createdAt: new Date(),
        });
        logger.info(`In-app notification created for user ${targetUser.id} regarding client ${client.name}`);
      } catch (notifError) {
        logger.error(`Failed to create in-app notification for user ${targetUser.id}:`, notifError);
      }

      // Send email notification
      try {
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; background: #f7f9fb; padding: 32px;">
            <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h2 style="margin: 0; color: #1a202c;">New Client Interaction Logged</h2>
              </div>
              <p style="font-size: 16px; color: #333;">
                Hi <b>${targetUser.name || 'User'}</b>,
              </p>
              <p style="font-size: 16px; color: #333;">
                <b>${actor.name}</b> has logged a new <b>${interaction.type}</b> for client <b>${client.name}</b>.
              </p>
              <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2563eb;">
                <p style="margin: 0; font-size: 15px; color: #555; white-space: pre-wrap;">${interaction.content}</p>
              </div>
              <p style="font-size: 14px; color: #888; margin-top: 24px;">
                You can view the full details in your Flowlio dashboard.
              </p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
              <p style="font-size: 12px; color: #bbb; text-align: center;">
                &copy; ${new Date().getFullYear()} Flowlio. All rights reserved.
              </p>
            </div>
          </div>
        `;

        await sendEmail({
          subject: `Flowlio: New ${interaction.type} logged for ${client.name}`,
          htmlContent: emailHtml,
          sender: {
            email: "noreply@flowlio.com",
            name: "Flowlio Notifications",
          },
          to: [
            {
              email: targetUser.email,
              name: targetUser.name || "Manager",
            },
          ],
        });
        logger.info(`Interaction email sent to ${targetUser.email} for client ${client.name}`);
      } catch (emailError) {
        logger.error(`Failed to send interaction email to ${targetUser.email}:`, emailError);
      }
    }

  } catch (error) {
    logger.error("Error in notifyClientInteraction:", error);
  }
};
