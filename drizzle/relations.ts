import { relations } from "drizzle-orm/relations";
import {
  subscriptionPlans,
  organizations,
  users,
  account,
  session,
  subadmin,
  userOrganizations,
  clients,
  invitations,
  invoices,
  subscriptions,
  notifications,
  projects,
  auditLogs,
  tasks,
  timeEntries,
  supportTickets,
  projectComments,
  twoFactor,
  twoFactorBackupCodes,
} from "./schema";

export const organizationsRelations = relations(
  organizations,
  ({ one, many }) => ({
    subscriptionPlan: one(subscriptionPlans, {
      fields: [organizations.subscriptionPlanId],
      references: [subscriptionPlans.id],
    }),
    userOrganizations: many(userOrganizations),
    clients: many(clients),
    invitations: many(invitations),
    invoices: many(invoices),
    notifications: many(notifications),
    projects: many(projects),
    auditLogs: many(auditLogs),
    subscriptions: many(subscriptions),
  })
);

export const subscriptionPlansRelations = relations(
  subscriptionPlans,
  ({ many }) => ({
    organizations: many(organizations),
    subscriptions: many(subscriptions),
  })
);

export const accountRelations = relations(account, ({ one }) => ({
  user: one(users, {
    fields: [account.userId],
    references: [users.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(account),
  sessions: many(session),
  subadmins: many(subadmin),
  userOrganizations_userId: many(userOrganizations, {
    relationName: "userOrganizations_userId_users_id",
  }),
  userOrganizations_invitedBy: many(userOrganizations, {
    relationName: "userOrganizations_invitedBy_users_id",
  }),
  clients: many(clients),
  invitations: many(invitations),
  notifications: many(notifications),
  projects: many(projects),
  auditLogs: many(auditLogs),
  tasks_assignedTo: many(tasks, {
    relationName: "tasks_assignedTo_users_id",
  }),
  tasks_createdBy: many(tasks, {
    relationName: "tasks_createdBy_users_id",
  }),
  timeEntries: many(timeEntries),
  supportTickets: many(supportTickets),
  twoFactor: many(twoFactor),
  twoFactorBackupCodes: many(twoFactorBackupCodes),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(users, {
    fields: [session.userId],
    references: [users.id],
  }),
}));

export const subadminRelations = relations(subadmin, ({ one }) => ({
  user: one(users, {
    fields: [subadmin.createdBy],
    references: [users.id],
  }),
}));

export const userOrganizationsRelations = relations(
  userOrganizations,
  ({ one }) => ({
    user_userId: one(users, {
      fields: [userOrganizations.userId],
      references: [users.id],
      relationName: "userOrganizations_userId_users_id",
    }),
    organization: one(organizations, {
      fields: [userOrganizations.organizationId],
      references: [organizations.id],
    }),
    user_invitedBy: one(users, {
      fields: [userOrganizations.invitedBy],
      references: [users.id],
      relationName: "userOrganizations_invitedBy_users_id",
    }),
  })
);

export const clientsRelations = relations(clients, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [clients.organizationId],
    references: [organizations.id],
  }),
  createdBy: one(users, {
    fields: [clients.createdBy],
    references: [users.id],
  }),
  projects: many(projects),
  timeEntries: many(timeEntries),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [invitations.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  organization: one(organizations, {
    fields: [invoices.organizationId],
    references: [organizations.id],
  }),
  subscription: one(subscriptions, {
    fields: [invoices.subscriptionId],
    references: [subscriptions.id],
  }),
}));

export const subscriptionsRelations = relations(
  subscriptions,
  ({ one, many }) => ({
    invoices: many(invoices),
    organization: one(organizations, {
      fields: [subscriptions.organizationId],
      references: [organizations.id],
    }),
    subscriptionPlan: one(subscriptionPlans, {
      fields: [subscriptions.planId],
      references: [subscriptionPlans.id],
    }),
  })
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [notifications.organizationId],
    references: [organizations.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.organizationId],
    references: [organizations.id],
  }),
  createdBy: one(users, {
    fields: [projects.createdBy],
    references: [users.id],
  }),
  client: one(clients, {
    fields: [projects.clientId],
    references: [clients.id],
  }),
  assignedTo: one(users, {
    fields: [projects.assignedTo],
    references: [users.id],
  }),
  tasks: many(tasks),
  timeEntries: many(timeEntries),
  comments: many(projectComments),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [auditLogs.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  user_assignedTo: one(users, {
    fields: [tasks.assignedTo],
    references: [users.id],
    relationName: "tasks_assignedTo_users_id",
  }),
  user_createdBy: one(users, {
    fields: [tasks.createdBy],
    references: [users.id],
    relationName: "tasks_createdBy_users_id",
  }),
  timeEntries: many(timeEntries),
}));

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  user: one(users, {
    fields: [timeEntries.userId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [timeEntries.projectId],
    references: [projects.id],
  }),
  task: one(tasks, {
    fields: [timeEntries.taskId],
    references: [tasks.id],
  }),
  client: one(clients, {
    fields: [timeEntries.clientId],
    references: [clients.id],
  }),
}));

export const supportTicketsRelations = relations(supportTickets, ({ one }) => ({
  user: one(users, {
    fields: [supportTickets.submittedby],
    references: [users.id],
  }),
}));

export const projectCommentsRelations = relations(
  projectComments,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [projectComments.projectId],
      references: [projects.id],
    }),
    user: one(users, {
      fields: [projectComments.userId],
      references: [users.id],
    }),
    parent: one(projectComments, {
      fields: [projectComments.parentId],
      references: [projectComments.id],
      relationName: "comment_replies",
    }),
    replies: many(projectComments, {
      relationName: "comment_replies",
    }),
  })
);

export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
  user: one(users, {
    fields: [twoFactor.userId],
    references: [users.id],
  }),
}));

export const twoFactorBackupCodesRelations = relations(
  twoFactorBackupCodes,
  ({ one }) => ({
    user: one(users, {
      fields: [twoFactorBackupCodes.userId],
      references: [users.id],
    }),
  })
);
