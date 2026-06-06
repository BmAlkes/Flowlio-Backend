import {
  pgTable,
  index,
  foreignKey,
  unique,
  text,
  timestamp,
  integer,
  json,
  varchar,
  boolean,
  numeric,
} from "drizzle-orm/pg-core";
import crypto from "crypto";

// Import relations
import "./relations";

export const organizations = pgTable(
  "organizations",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    description: text(),
    status: text(),
    subscriptionStatus: text("subscription_status"),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
    logo: text(),
    logoPublicId: text("logo_public_id"),
    website: text(),
    industry: text(),
    size: text(),
    subscriptionPlanId: text("subscription_plan_id"),
    subscriptionStartDate: timestamp("subscription_start_date", {
      mode: "string",
    }),
    subscriptionEndDate: timestamp("subscription_end_date", { mode: "string" }),
    trialEndsAt: timestamp("trial_ends_at", { mode: "string" }),
    maxUsers: integer("max_users"),
    maxProjects: integer("max_projects"),
    maxStorage: integer("max_storage"),
    settings: json(),
  },
  (table) => [
    index("organizations_slug_idx").using(
      "btree",
      table.slug.asc().nullsLast().op("text_ops"),
    ),
    index("organizations_status_idx").using(
      "btree",
      table.status.asc().nullsLast().op("text_ops"),
    ),
    index("organizations_subscription_idx").using(
      "btree",
      table.subscriptionStatus.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.subscriptionPlanId],
      foreignColumns: [subscriptionPlans.id],
      name: "organizations_subscription_plan_id_subscription_plans_id_fk",
    }),
    unique("organizations_slug_unique").on(table.slug),
  ],
);

export const throttleInsight = pgTable("throttle_insight", {
  waitTime: integer("wait_time").notNull(),
  msBeforeNext: integer("ms_before_next").notNull(),
  endPoint: varchar("end_point", { length: 225 }),
  allottedPoints: integer("allotted_points").notNull(),
  consumedPoints: integer("consumed_points").notNull(),
  remainingPoints: integer("remaining_points").notNull(),
  key: varchar({ length: 225 }).primaryKey().notNull(),
  isFirstInDuration: boolean("is_first_in_duration").notNull(),
});

export const users = pgTable(
  "users",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    email: text().notNull(),
    phone: text(),
    address: text(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
    isSuperAdmin: boolean("is_super_admin").notNull(),
    image: text(),
    emailVerified: boolean("email_verified").notNull(),
    subadminId: text("subadmin_id"),
    role: text().notNull(),
    twoFactorEnabled: boolean("two_factor_enabled").default(false),
    notificationPreferences: json("notification_preferences")
      .$type<{
        paymentAlerts: boolean;
        invoiceReminders: boolean;
        projectActivityUpdates: boolean;
        emailNotifications: boolean;
        pushNotifications: boolean;
        smsNotifications: boolean;
        [key: string]: any;
      }>()
      .default({
        paymentAlerts: true,
        invoiceReminders: true,
        projectActivityUpdates: true,
        emailNotifications: true,
        pushNotifications: true,
        smsNotifications: true,
      }),
  },
  (table) => [
    index("users_email_idx").using(
      "btree",
      table.email.asc().nullsLast().op("text_ops"),
    ),
    index("users_super_admin_idx").using(
      "btree",
      table.isSuperAdmin.asc().nullsLast().op("bool_ops"),
    ),
    unique("users_email_unique").on(table.email),
  ],
);

export const verification = pgTable("verification", {
  id: text().primaryKey().notNull(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { mode: "string" }),
  updatedAt: timestamp("updated_at", { mode: "string" }),
});

export const account = pgTable(
  "account",
  {
    id: text().primaryKey().notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      mode: "string",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      mode: "string",
    }),
    scope: text(),
    password: text(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "account_user_id_users_id_fk",
    }).onDelete("cascade"),
    unique("user_provider_unique").on(table.userId, table.providerId),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text().primaryKey().notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    token: text().notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "session_user_id_users_id_fk",
    }).onDelete("cascade"),
    unique("session_token_unique").on(table.token),
  ],
);

export const subadmin = pgTable(
  "subadmin",
  {
    id: text().primaryKey().notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text().notNull(),
    contactNumber: text("contact_number"),
    permission: text().notNull(),
    password: text(),
    logo: text(),
    logoPublicId: text("logo_public_id"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "subadmin_created_by_users_id_fk",
    }).onDelete("set null"),
    unique("subadmin_email_unique").on(table.email),
  ],
);

export const userOrganizations = pgTable(
  "user_organizations",
  {
    id: text().primaryKey().notNull(),
    userId: text("user_id").notNull(),
    organizationId: text("organization_id").notNull(),
    role: text().notNull(),
    status: text().notNull(),
    joinedAt: timestamp("joined_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
    permissions: json(),
    invitedBy: text("invited_by"),
    invitedAt: timestamp("invited_at", { mode: "string" }),
  },
  (table) => [
    index("user_organizations_role_idx").using(
      "btree",
      table.role.asc().nullsLast().op("text_ops"),
    ),
    index("user_organizations_status_idx").using(
      "btree",
      table.status.asc().nullsLast().op("text_ops"),
    ),
    index("user_organizations_user_org_idx").using(
      "btree",
      table.userId.asc().nullsLast().op("text_ops"),
      table.organizationId.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "user_organizations_user_id_users_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "user_organizations_organization_id_organizations_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.invitedBy],
      foreignColumns: [users.id],
      name: "user_organizations_invited_by_users_id_fk",
    }),
  ],
);

export const clients = pgTable(
  "clients",
  {
    id: text().primaryKey().notNull(),
    organizationId: text("organization_id").notNull(),
    name: text().notNull(),
    email: text(),
    image: text("image"),
    imagePublicId: text("image_public_id"),
    phone: text(),
    cpfCnpjNumber: text("cpf_cnpj_number"),
    businessIndustry: text("business_industry"),
    address: text(),
    status: text("status").$defaultFn(() => "New Lead"),
    createdBy: text("created_by").notNull(),
    socialMediaLinks: json("social_media_links"),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("clients_email_idx").using(
      "btree",
      table.email.asc().nullsLast().op("text_ops"),
    ),
    index("clients_organization_idx").using(
      "btree",
      table.organizationId.asc().nullsLast().op("text_ops"),
    ),
    index("clients_status_idx").using(
      "btree",
      table.status.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "clients_organization_id_organizations_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "clients_created_by_users_id_fk",
    }),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: text().primaryKey().notNull(),
    organizationId: text("organization_id").notNull(),
    email: text().notNull(),
    role: text().notNull(),
    permissions: json(),
    invitedBy: text("invited_by").notNull(),
    token: text().notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    acceptedAt: timestamp("accepted_at", { mode: "string" }),
    status: text(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("invitations_email_idx").using(
      "btree",
      table.email.asc().nullsLast().op("text_ops"),
    ),
    index("invitations_organization_idx").using(
      "btree",
      table.organizationId.asc().nullsLast().op("text_ops"),
    ),
    index("invitations_status_idx").using(
      "btree",
      table.status.asc().nullsLast().op("text_ops"),
    ),
    index("invitations_token_idx").using(
      "btree",
      table.token.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "invitations_organization_id_organizations_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.invitedBy],
      foreignColumns: [users.id],
      name: "invitations_invited_by_users_id_fk",
    }),
    unique("invitations_token_unique").on(table.token),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: text().primaryKey().notNull(),
    organizationId: text("organization_id").notNull(),
    subscriptionId: text("subscription_id"),
    amount: numeric({ precision: 10, scale: 2 }).notNull(),
    currency: text().notNull(),
    status: text().notNull(),
    stripeInvoiceId: text("stripe_invoice_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    dueDate: timestamp("due_date", { mode: "string" }),
    paidAt: timestamp("paid_at", { mode: "string" }),
    invoiceUrl: text("invoice_url"),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    metadata: json(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("invoices_organization_idx").using(
      "btree",
      table.organizationId.asc().nullsLast().op("text_ops"),
    ),
    index("invoices_status_idx").using(
      "btree",
      table.status.asc().nullsLast().op("text_ops"),
    ),
    index("invoices_stripe_idx").using(
      "btree",
      table.stripeInvoiceId.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "invoices_organization_id_organizations_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.subscriptionId],
      foreignColumns: [subscriptions.id],
      name: "invoices_subscription_id_subscriptions_id_fk",
    }),
    unique("invoices_stripe_invoice_id_unique").on(table.stripeInvoiceId),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text().primaryKey().notNull(),
    userId: text("user_id").notNull(),
    organizationId: text("organization_id"),
    type: text().notNull(),
    title: text().notNull(),
    message: text().notNull(),
    data: json(),
    read: boolean(),
    readAt: timestamp("read_at", { mode: "string" }),
    expiresAt: timestamp("expires_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("notifications_read_idx").using(
      "btree",
      table.read.asc().nullsLast().op("bool_ops"),
    ),
    index("notifications_type_idx").using(
      "btree",
      table.type.asc().nullsLast().op("text_ops"),
    ),
    index("notifications_user_idx").using(
      "btree",
      table.userId.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "notifications_user_id_users_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "notifications_organization_id_organizations_id_fk",
    }),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    projectNumber: text("project_number").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    description: text(),
    organizationId: text("organization_id").notNull(),
    createdBy: text("created_by").notNull(),
    assignedTo: text("assigned_to").references(() => users.id),
    status: text().$defaultFn(() => "active"),
    startDate: timestamp("start_date", { mode: "string" }),
    endDate: timestamp("end_date", { mode: "string" }),
    progress: integer().$defaultFn(() => 0),
    address: text(),
    contractfile: text(),
    contractfilePublicId: text("contractfile_public_id"),
    projectFiles: json("project_files").$type<{
      projectPdf?: {
        url: string;
        publicId: string;
        name: string;
        type: string;
      };
    }>(),
    tags: json(),
    settings: json(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("projects_created_by_idx").using(
      "btree",
      table.createdBy.asc().nullsLast().op("text_ops"),
    ),
    index("projects_organization_idx").using(
      "btree",
      table.organizationId.asc().nullsLast().op("text_ops"),
    ),
    index("projects_status_idx").using(
      "btree",
      table.status.asc().nullsLast().op("text_ops"),
    ),
    index("projects_project_number_idx").using(
      "btree",
      table.projectNumber.asc().nullsLast().op("text_ops"),
    ),
    index("projects_client_id_idx").using(
      "btree",
      table.clientId.asc().nullsLast().op("text_ops"),
    ),
    index("projects_assigned_to_idx").using(
      "btree",
      table.assignedTo.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "projects_organization_id_organizations_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "projects_created_by_users_id_fk",
    }),
    foreignKey({
      columns: [table.clientId],
      foreignColumns: [clients.id],
      name: "projects_client_id_clients_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.assignedTo],
      foreignColumns: [users.id],
      name: "projects_assigned_to_users_id_fk",
    }),
  ],
);

export const projectComments = pgTable(
  "project_comments",
  {
    id: text().primaryKey().notNull(),
    projectId: text("project_id").notNull(),
    userId: text("user_id").notNull(),
    content: text().notNull(),
    parentId: text("parent_id"), // For nested comments/replies
    taskId: text("task_id"),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("project_comments_project_idx").using(
      "btree",
      table.projectId.asc().nullsLast().op("text_ops"),
    ),
    index("project_comments_user_idx").using(
      "btree",
      table.userId.asc().nullsLast().op("text_ops"),
    ),
    index("project_comments_parent_idx").using(
      "btree",
      table.parentId.asc().nullsLast().op("text_ops"),
    ),
    index("project_comments_task_idx").using(
      "btree",
      table.taskId.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: "project_comments_project_id_projects_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "project_comments_user_id_users_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "project_comments_parent_id_project_comments_id_fk",
    }).onDelete("cascade"),
  ],
);

export const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    name: text().notNull(),
    slug: text().notNull(),
    description: text(),
    customPlanName: text("custom_plan_name"),
    price: numeric({ precision: 10, scale: 2 }).notNull(),
    currency: text().notNull(),
    billingCycle: text("billing_cycle").notNull(),
    durationValue: integer("duration_value"),
    durationType: text("duration_type"), // "days" | "monthly" | "yearly"
    features: json(),
    isActive: boolean("is_active").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("subscription_plans_active_idx").using(
      "btree",
      table.isActive.asc().nullsLast().op("bool_ops"),
    ),
    index("subscription_plans_slug_idx").using(
      "btree",
      table.slug.asc().nullsLast().op("text_ops"),
    ),
    unique("subscription_plans_slug_unique").on(table.slug),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text().primaryKey().notNull(),
    organizationId: text("organization_id"),
    userId: text("user_id"),
    action: text().notNull(),
    resource: text().notNull(),
    resourceId: text("resource_id"),
    oldValues: json("old_values"),
    newValues: json("new_values"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: json(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("audit_logs_action_idx").using(
      "btree",
      table.action.asc().nullsLast().op("text_ops"),
    ),
    index("audit_logs_created_at_idx").using(
      "btree",
      table.createdAt.asc().nullsLast().op("timestamp_ops"),
    ),
    index("audit_logs_organization_idx").using(
      "btree",
      table.organizationId.asc().nullsLast().op("text_ops"),
    ),
    index("audit_logs_resource_idx").using(
      "btree",
      table.resource.asc().nullsLast().op("text_ops"),
    ),
    index("audit_logs_user_idx").using(
      "btree",
      table.userId.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "audit_logs_organization_id_organizations_id_fk",
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "audit_logs_user_id_users_id_fk",
    }),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text().primaryKey().notNull(),
    organizationId: text("organization_id").notNull(),
    planId: text("plan_id").notNull(),
    status: text().notNull(),
    currentPeriodStart: timestamp("current_period_start", {
      mode: "string",
    }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", {
      mode: "string",
    }).notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end"),
    cancelledAt: timestamp("cancelled_at", { mode: "string" }),
    trialStart: timestamp("trial_start", { mode: "string" }),
    trialEnd: timestamp("trial_end", { mode: "string" }),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCustomerId: text("stripe_customer_id"),
    metadata: json(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("subscriptions_organization_idx").using(
      "btree",
      table.organizationId.asc().nullsLast().op("text_ops"),
    ),
    index("subscriptions_status_idx").using(
      "btree",
      table.status.asc().nullsLast().op("text_ops"),
    ),
    index("subscriptions_stripe_idx").using(
      "btree",
      table.stripeSubscriptionId.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "subscriptions_organization_id_organizations_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.planId],
      foreignColumns: [subscriptionPlans.id],
      name: "subscriptions_plan_id_subscription_plans_id_fk",
    }),
    unique("subscriptions_stripe_subscription_id_unique").on(
      table.stripeSubscriptionId,
    ),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: text().primaryKey().notNull(),
    title: text().notNull(),
    description: text(),
    projectId: text("project_id").notNull(),
    assignedTo: text("assigned_to"),
    createdBy: text("created_by").notNull(),
    status: text(),
    startDate: timestamp("start_date", { mode: "string" }),
    endDate: timestamp("end_date", { mode: "string" }),
    estimatedHours: numeric({ precision: 10, scale: 2 }),
    actualHours: numeric({ precision: 10, scale: 2 }),
    attachments: json(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("tasks_assigned_to_idx").using(
      "btree",
      table.assignedTo.asc().nullsLast().op("text_ops"),
    ),
    index("tasks_end_date_idx").using(
      "btree",
      table.endDate.asc().nullsLast().op("timestamp_ops"),
    ),
    index("tasks_project_idx").using(
      "btree",
      table.projectId.asc().nullsLast().op("text_ops"),
    ),
    index("tasks_status_idx").using(
      "btree",
      table.status.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: "tasks_project_id_projects_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.assignedTo],
      foreignColumns: [users.id],
      name: "tasks_assigned_to_users_id_fk",
    }),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "tasks_created_by_users_id_fk",
    }),
  ],
);

export const timeEntries = pgTable(
  "time_entries",
  {
    id: text().primaryKey().notNull(),
    userId: text("user_id").notNull(),
    projectId: text("project_id").notNull(),
    taskId: text("task_id"),
    clientId: text("client_id"),
    description: text(),
    startTime: timestamp("start_time", { mode: "string" }).notNull(),
    endTime: timestamp("end_time", { mode: "string" }),
    duration: integer(),
    billable: boolean(),
    hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }),
    status: text(),
    tags: json(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("time_entries_project_idx").using(
      "btree",
      table.projectId.asc().nullsLast().op("text_ops"),
    ),
    index("time_entries_start_time_idx").using(
      "btree",
      table.startTime.asc().nullsLast().op("timestamp_ops"),
    ),
    index("time_entries_task_idx").using(
      "btree",
      table.taskId.asc().nullsLast().op("text_ops"),
    ),
    index("time_entries_user_idx").using(
      "btree",
      table.userId.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "time_entries_user_id_users_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: "time_entries_project_id_projects_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.taskId],
      foreignColumns: [tasks.id],
      name: "time_entries_task_id_tasks_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clientId],
      foreignColumns: [clients.id],
      name: "time_entries_client_id_clients_id_fk",
    }),
  ],
);

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    ticketNumber: text("ticket_number").notNull(),
    subject: text("subject").notNull(),
    description: text("description").notNull(),
    priority: text("priority").notNull(),
    status: text("status").notNull(),
    submittedby: text("submitted_by").notNull(),
    submittedbyName: text("submitted_by_name"),
    submittedbyRole: text("submitted_by_role"),
    destination: text("destination").notNull().default("platform"),
    client: text("client").notNull(),
    assignedto: text("assigned_to").notNull(),
    createdon: timestamp("created_on", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("support_tickets_ticket_number_idx").using(
      "btree",
      table.ticketNumber.asc().nullsLast().op("text_ops"),
    ),
    index("support_tickets_status_idx").using(
      "btree",
      table.status.asc().nullsLast().op("text_ops"),
    ),
    index("support_tickets_priority_idx").using(
      "btree",
      table.priority.asc().nullsLast().op("text_ops"),
    ),
    index("support_tickets_submitted_by_idx").using(
      "btree",
      table.submittedby.asc().nullsLast().op("text_ops"),
    ),
    unique("support_tickets_ticket_number_unique").on(table.ticketNumber),
    foreignKey({
      columns: [table.submittedby],
      foreignColumns: [users.id],
      name: "support_tickets_submitted_by_users_id_fk",
    }),
  ],
);

export const userManagement = pgTable(
  "user_management",
  {
    id: text().primaryKey().notNull(),
    firstname: text().notNull(),
    lastname: text().notNull(),
    email: text().notNull(),
    phonenumber: text().notNull(),
    companyname: text().notNull(),
    userrole: text().notNull(),
    setpermission: text().notNull(),
    password: text().notNull(),
    organizationId: text("organization_id").notNull(),
    status: text().notNull(),
    isActive: boolean("is_active").notNull(),
    lastLoginAt: timestamp("last_login_at", { mode: "string" }),
    loginAttempts: integer("login_attempts"),
    lockedUntil: timestamp("locked_until", { mode: "string" }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("user_management_email_idx").using(
      "btree",
      table.email.asc().nullsLast().op("text_ops"),
    ),
    index("user_management_organization_idx").using(
      "btree",
      table.organizationId.asc().nullsLast().op("text_ops"),
    ),
    index("user_management_status_idx").using(
      "btree",
      table.status.asc().nullsLast().op("text_ops"),
    ),
    index("user_management_role_idx").using(
      "btree",
      table.userrole.asc().nullsLast().op("text_ops"),
    ),
    unique("user_management_email_unique").on(table.email),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "user_management_organization_id_organizations_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "user_management_created_by_users_id_fk",
    }),
  ],
);

export const twoFactor = pgTable(
  "two_factor",
  {
    id: text().primaryKey().notNull(),
    secret: text().notNull(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "two_factor_user_id_users_id_fk",
    }).onDelete("cascade"),
  ],
);

export const twoFactorBackupCodes = pgTable(
  "two_factor_backup_codes",
  {
    id: text().primaryKey().notNull(),
    code: text().notNull(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "two_factor_backup_codes_user_id_users_id_fk",
    }).onDelete("cascade"),
  ],
);
