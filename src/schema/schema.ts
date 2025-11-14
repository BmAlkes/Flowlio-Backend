import {
  text,
  pgTable,
  integer,
  varchar,
  boolean,
  timestamp,
  decimal,
  json,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import crypto from "crypto";

// ==================== CORE USER & AUTH TABLES ====================

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified")
      .$defaultFn(() => false)
      .notNull(),
    twoFactorEnabled: boolean("two_factor_enabled")
      .$defaultFn(() => false)
      .notNull(),
    image: text("image"),
    phone: text("phone"),
    address: text("address"),
    role: text("role").$defaultFn(() => "user"), // Required by Better Auth admin plugin
    isSuperAdmin: boolean("is_super_admin")
      .$defaultFn(() => false)
      .notNull(),
    subadminId: text("subadmin_id"),
    timezone: text("timezone")
      .$defaultFn(() => "UTC")
      .notNull(),
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
      .$defaultFn(() => ({
        paymentAlerts: true,
        invoiceReminders: true,
        projectActivityUpdates: true,
        emailNotifications: true,
        pushNotifications: true,
        smsNotifications: true,
      })),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    emailIdx: index("users_email_idx").on(table.email),
    superAdminIdx: index("users_super_admin_idx").on(table.isSuperAdmin),
  })
);

// ==================== TWO-FACTOR AUTHENTICATION TABLES ====================

export const twoFactor = pgTable("two_factor", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(),
  backupCodes: json("backup_codes").$type<string[]>(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const twoFactorBackupCodes = pgTable("two_factor_backup_codes", {
  id: text("id").primaryKey(),
  twoFactorId: text("two_factor_id")
    .notNull()
    .references(() => twoFactor.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  used: boolean("used")
    .$defaultFn(() => false)
    .notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// ==================== SUBSCRIPTION PLANS ====================

export const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(), // "Free", "Basic", "Pro", "Enterprise"
    slug: text("slug").notNull().unique(), // "free", "basic", "pro", "enterprise"
    description: text("description"),
    customPlanName: text("custom_plan_name"), // Custom display name (optional)
    price: decimal("price", { precision: 10, scale: 2 }).notNull(), // Monthly price
    currency: text("currency")
      .$defaultFn(() => "USD")
      .notNull(),
    billingCycle: text("billing_cycle")
      .$defaultFn(() => "monthly")
      .notNull(), // "days" | "monthly" | "yearly"
    durationValue: integer("duration_value"), // e.g., 7, 30, 365
    durationType: text("duration_type"), // "days" | "monthly" | "yearly"
    features: json("features").$type<{
      maxUsers: number;
      maxProjects: number;
      maxStorage: number; // in GB
      maxTasks: number;
      aiAssist: boolean;
      prioritySupport: boolean;
      calendarAccess?: boolean;
      taskManagement?: boolean;
      timeTracking?: boolean;
      customFeatures?: string[];
      [key: string]: any;
    }>(),
    isActive: boolean("is_active")
      .$defaultFn(() => true)
      .notNull(),
    sortOrder: integer("sort_order")
      .$defaultFn(() => 0)
      .notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    slugIdx: index("subscription_plans_slug_idx").on(table.slug),
    activeIdx: index("subscription_plans_active_idx").on(table.isActive),
  })
);

// ==================== ORGANIZATIONS ====================

export const organizations = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    logo: text("logo"),
    logoPublicId: text("logo_public_id"),
    website: text("website"),
    industry: text("industry"),
    size: text("size"), // "1-10", "11-50", "51-200", "200+"
    status: text("status").$defaultFn(() => "active"), // active, suspended, inactive, pending
    subscriptionPlanId: text("subscription_plan_id").references(
      () => subscriptionPlans.id
    ),
    subscriptionStatus: text("subscription_status").$defaultFn(() => "active"), // active, expired, cancelled, past_due
    subscriptionStartDate: timestamp("subscription_start_date"),
    subscriptionEndDate: timestamp("subscription_end_date"),
    trialEndsAt: timestamp("trial_ends_at"),
    maxUsers: integer("max_users").$defaultFn(() => 5),
    maxProjects: integer("max_projects").$defaultFn(() => 3),
    maxStorage: integer("max_storage").$defaultFn(() => 1), // in GB
    settings: json("settings").$type<{
      timezone: string;
      dateFormat: string;
      currency: string;
      language: string;
      notifications: {
        email: boolean;
        push: boolean;
        sms: boolean;
      };
      // Demo account related fields
      demo?: boolean;
      demoCreatedAt?: string;
      demoCreatedBy?: string | null;
      demoRole?: string;
      passwordChanged?: boolean;
      [key: string]: any;
    }>(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    slugIdx: index("organizations_slug_idx").on(table.slug),
    statusIdx: index("organizations_status_idx").on(table.status),
    subscriptionIdx: index("organizations_subscription_idx").on(
      table.subscriptionStatus
    ),
  })
);

// ==================== USER-ORGANIZATION RELATIONSHIPS ====================

export const userOrganizations = pgTable(
  "user_organizations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role")
      .notNull()
      .$defaultFn(() => "member"), // owner, admin, manager, member, viewer
    status: text("status")
      .notNull()
      .$defaultFn(() => "active"), // active, invited, suspended, pending
    permissions: json("permissions").$type<{
      canManageUsers: boolean;
      canManageProjects: boolean;
      canManageBilling: boolean;
      canViewAnalytics: boolean;
      canInviteUsers: boolean;
      [key: string]: boolean;
    }>(),
    invitedBy: text("invited_by").references(() => users.id),
    invitedAt: timestamp("invited_at"),
    joinedAt: timestamp("joined_at"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    userOrgIdx: index("user_organizations_user_org_idx").on(
      table.userId,
      table.organizationId
    ),
    roleIdx: index("user_organizations_role_idx").on(table.role),
    statusIdx: index("user_organizations_status_idx").on(table.status),
  })
);

// ==================== SUB ADMIN TABLE ====================

export const subadmin = pgTable("subadmin", {
  id: text("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  contactNumber: text("contact_number"),
  permission: text("permission")
    .notNull()
    .$defaultFn(() => "Sub Admin"),
  password: text("password"),
  logo: text("logo"),
  logoPublicId: text("logo_public_id"),
  createdBy: text("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// ==================== PROJECTS ====================

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    projectNumber: text("project_number").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    description: text("description"),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    assignedTo: text("assigned_to").references(() => users.id),
    status: text("status").$defaultFn(() => "active"),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    progress: integer("progress").$defaultFn(() => 0),
    address: text("address"),
    contractfile: text("contractfile"),
    contractfilePublicId: text("contractfile_public_id"), // For Cloudinary
    projectFiles: json("project_files").$type<{
      projectPdf?: {
        url: string;
        publicId: string;
        name: string;
        type: string;
      };
    }>(), // Project PDF file
    tags: json("tags").$type<string[]>(),
    settings: json("settings").$type<{
      allowGuestAccess: boolean;
      autoAssignTasks: boolean;
      requireApproval: boolean;
      [key: string]: any;
    }>(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdx: index("projects_organization_idx").on(table.organizationId),
    statusIdx: index("projects_status_idx").on(table.status),
    createdByIdx: index("projects_created_by_idx").on(table.createdBy),
    clientIdx: index("projects_client_idx").on(table.clientId),
    assignedToIdx: index("projects_assigned_to_idx").on(table.assignedTo),
    projectNumberIdx: index("projects_project_number_idx").on(
      table.projectNumber
    ),
    // Composite index for getProjectById query optimization
    orgIdIdx: index("projects_org_id_idx").on(table.organizationId, table.id),
  })
);

// ==================== PROJECT COMMENTS ====================

export const projectComments = pgTable(
  "project_comments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID())
      .notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    parentId: text("parent_id"), // Self-reference for replies - will be handled in relations
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    projectIdx: index("project_comments_project_idx").on(table.projectId),
    userIdx: index("project_comments_user_idx").on(table.userId),
    parentIdx: index("project_comments_parent_idx").on(table.parentId),
    createdAtIdx: index("project_comments_created_at_idx").on(table.createdAt),
  })
);

// ==================== TASKS ====================

export const tasks = pgTable(
  "tasks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text("title").notNull(),
    description: text("description"),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assignedTo: text("assigned_to").references(() => users.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    status: text("status")
      .$type<
        "todo" | "in_progress" | "completed" | "updated" | "delay" | "changes"
      >()
      .$defaultFn(() => "todo"),
    endDate: timestamp("end_date"),
    startDate: timestamp("start_date"),
    estimatedHours: decimal("estimated_hours", { precision: 10, scale: 2 }),
    actualHours: decimal("actual_hours", { precision: 10, scale: 2 }),
    attachments: json("attachments").$type<
      {
        id: string;
        name: string;
        url: string;
        size: number;
        type: string;
      }[]
    >(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    projectIdx: index("tasks_project_idx").on(table.projectId),
    assignedToIdx: index("tasks_assigned_to_idx").on(table.assignedTo),
    statusIdx: index("tasks_status_idx").on(table.status),
    dueDateIdx: index("tasks_end_date_idx").on(table.endDate),
  })
);

// ==================== BILLING & PAYMENTS ====================

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id),
    status: text("status").notNull(), // active, cancelled, past_due, unpaid
    currentPeriodStart: timestamp("current_period_start").notNull(),
    currentPeriodEnd: timestamp("current_period_end").notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").$defaultFn(() => false),
    cancelledAt: timestamp("cancelled_at"),
    trialStart: timestamp("trial_start"),
    trialEnd: timestamp("trial_end"),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    stripeCustomerId: text("stripe_customer_id"),
    metadata: json("metadata"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdx: index("subscriptions_organization_idx").on(table.organizationId),
    statusIdx: index("subscriptions_status_idx").on(table.status),
    stripeIdx: index("subscriptions_stripe_idx").on(table.stripeSubscriptionId),
  })
);

export const invoices = pgTable(
  "invoices",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    invoiceNumber: text("invoice_number").notNull().unique(),
    clientname: text("client_name").notNull(),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    status: text("status")
      .$defaultFn(() => "draft")
      .notNull(), // draft, sent, paid, overdue, cancelled
    datepaid: timestamp("date_paid"),
    dueDate: timestamp("due_date"),
    description: text("description"),
    pdfUrl: text("pdf_url"), // URL to generated PDF file
    pdfFileName: text("pdf_file_name"), // Original PDF filename
    pdfFileSize: integer("pdf_file_size"), // PDF file size in bytes
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdx: index("invoices_organization_idx").on(table.organizationId),
    clientIdx: index("invoices_client_idx").on(table.clientId),
    statusIdx: index("invoices_status_idx").on(table.status),
    invoiceNumberIdx: index("invoices_invoice_number_idx").on(
      table.invoiceNumber
    ),
    createdByIdx: index("invoices_created_by_idx").on(table.createdBy),
  })
);

// ==================== AUTH TABLES (Better Auth) ====================

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => ({
    // Add unique constraint for (userId, providerId) combination
    userProviderUnique: unique("user_provider_unique").on(
      table.userId,
      table.providerId
    ),
  })
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
});

// ==================== RATE LIMITING ====================

export const throttleinsight = pgTable("throttle_insight", {
  waitTime: integer("wait_time").notNull(),
  msBeforeNext: integer("ms_before_next").notNull(),
  endPoint: varchar("end_point", { length: 225 }),
  pointsAllotted: integer("allotted_points").notNull(),
  consumedPoints: integer("consumed_points").notNull(),
  remainingPoints: integer("remaining_points").notNull(),
  key: varchar("key", { length: 225 }).primaryKey().notNull(),
  isFirstInDuration: boolean("is_first_in_duration").notNull(),
});

// ==================== USER MANAGEMENT ====================
export const userManagement = pgTable(
  "user_management",
  {
    id: text("id").primaryKey(),
    firstname: text("firstname").notNull(),
    lastname: text("lastname").notNull(),
    email: text("email").notNull().unique(),
    companyname: text("companyname").notNull(),
    phonenumber: text("phonenumber").notNull(),
    userrole: text("userrole").notNull(),
    setpermission: text("setpermission").notNull(),
    password: text("password").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: text("status")
      .$defaultFn(() => "active")
      .notNull(), // active, inactive, suspended
    isActive: boolean("is_active")
      .$defaultFn(() => true)
      .notNull(),
    lastLoginAt: timestamp("last_login_at"),
    loginAttempts: integer("login_attempts").$defaultFn(() => 0),
    lockedUntil: timestamp("locked_until"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    emailIdx: index("user_management_email_idx").on(table.email),
    orgIdx: index("user_management_organization_idx").on(table.organizationId),
    statusIdx: index("user_management_status_idx").on(table.status),
    roleIdx: index("user_management_role_idx").on(table.userrole),
  })
);

// ==================== CLIENT MANAGEMENT ====================

export const clients = pgTable(
  "clients",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    image: text("image"),
    imagePublicId: text("image_public_id"), // For Cloudinary
    phone: text("phone"),
    cpfcnpj: text("cpf_cnpj_number"),
    businessIndustry: text("business_industry"),
    address: text("address"),
    socialMediaLinks: json("social_media_links").$type<
      Array<{
        type: string;
        url: string;
      }>
    >(),
    status: text("status").$defaultFn(() => "New Lead"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdx: index("clients_organization_idx").on(table.organizationId),
    statusIdx: index("clients_status_idx").on(table.status),
    emailIdx: index("clients_email_idx").on(table.email),
    emailOrgIdx: index("clients_email_org_idx").on(
      table.email,
      table.organizationId
    ),
  })
);

// ==================== TIME TRACKING ====================

export const timeEntries = pgTable(
  "time_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => clients.id),
    description: text("description"),
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time"),
    duration: integer("duration"), // in minutes
    billable: boolean("billable").$defaultFn(() => true),
    hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
    status: text("status").$defaultFn(() => "active"), // active, paused, completed
    tags: json("tags").$type<string[]>(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    userIdx: index("time_entries_user_idx").on(table.userId),
    projectIdx: index("time_entries_project_idx").on(table.projectId),
    taskIdx: index("time_entries_task_idx").on(table.taskId),
    startTimeIdx: index("time_entries_start_time_idx").on(table.startTime),
  })
);

// ==================== NOTIFICATIONS ====================

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organizations.id),
    type: text("type").notNull(), // task_assigned, project_updated, billing, system
    title: text("title").notNull(),
    message: text("message").notNull(),
    data: json("data"), // Additional data for the notification
    read: boolean("read").$defaultFn(() => false),
    readAt: timestamp("read_at"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    userIdx: index("notifications_user_idx").on(table.userId),
    readIdx: index("notifications_read_idx").on(table.read),
    typeIdx: index("notifications_type_idx").on(table.type),
  })
);

// ==================== AUDIT LOGS ====================

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id),
    userId: text("user_id").references(() => users.id),
    action: text("action").notNull(), // create, update, delete, login, etc.
    resource: text("resource").notNull(), // user, project, task, etc.
    resourceId: text("resource_id"),
    oldValues: json("old_values"),
    newValues: json("new_values"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: json("metadata"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdx: index("audit_logs_organization_idx").on(table.organizationId),
    userIdx: index("audit_logs_user_idx").on(table.userId),
    actionIdx: index("audit_logs_action_idx").on(table.action),
    resourceIdx: index("audit_logs_resource_idx").on(table.resource),
    createdAtIdx: index("audit_logs_created_at_idx").on(table.createdAt),
  })
);

// ==================== INVITATIONS ====================

export const invitations = pgTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role")
      .notNull()
      .$defaultFn(() => "member"),
    permissions: json("permissions").$type<{
      canManageUsers: boolean;
      canManageProjects: boolean;
      canManageBilling: boolean;
      canViewAnalytics: boolean;
      canInviteUsers: boolean;
      [key: string]: boolean;
    }>(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    status: text("status").$defaultFn(() => "pending"), // pending, accepted, expired, cancelled
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdx: index("invitations_organization_idx").on(table.organizationId),
    emailIdx: index("invitations_email_idx").on(table.email),
    tokenIdx: index("invitations_token_idx").on(table.token),
    statusIdx: index("invitations_status_idx").on(table.status),
  })
);

// ==================== SUPPORT TICKETS ====================

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ticketNumber: text("ticket_number").notNull().unique(),
    subject: text("subject").notNull(),
    description: text("description").notNull(),
    priority: text("priority", { enum: ["High", "Medium", "Low"] }).notNull(),
    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    submittedby: text("submitted_by")
      .notNull()
      .references(() => users.id),
    submittedbyRole: text("submitted_by_role").notNull(),
    submittedbyName: text("submitted_by_name").notNull(),
    client: text("client").notNull(),
    assignedto: text("assigned_to").notNull(),
    createdon: timestamp("created_on").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    ticketNumberIdx: index("ticket_number_idx").on(table.ticketNumber),
    statusIdx: index("status_idx").on(table.status),
    priorityIdx: index("priority_idx").on(table.priority),
    submittedByIdx: index("submitted_by_idx").on(table.submittedby),
  })
);
// ==================== PAYMENT LINKS ====================

export const paymentLinks = pgTable(
  "payment_links",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    description: text("description").notNull(),
    project: text("project").notNull(),
    submittedby: text("submitted_by").notNull(),
    clientname: text("client_name").notNull(),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    paymentLink: text("payment_link").notNull().unique(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdx: index("payment_links_organization_idx").on(table.organizationId),
    clientIdx: index("payment_links_client_idx").on(table.clientId),
    projectIdx: index("payment_links_project_idx").on(table.projectId),
    createdByIdx: index("payment_links_created_by_idx").on(table.createdBy),
    paymentLinkIdx: index("payment_links_payment_link_idx").on(
      table.paymentLink
    ),
  })
);

// ==================== RECENT ACTIVITIES ====================
export const recentActivities = pgTable(
  "recent_activities",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id").references(() => organizations.id),
    userId: text("user_id").references(() => users.id), // subject of activity (optional)
    actorId: text("actor_id").references(() => users.id), // who performed the action
    type: text("type").notNull(), // auth, user, task, project, invoice, system
    action: text("action").notNull(), // create, update, delete, login, logout, assign, etc.
    resource: text("resource").notNull(), // user, task, project, invoice, etc.
    resourceId: text("resource_id"),
    message: text("message"),
    metadata: json("metadata"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdx: index("recent_activities_org_idx").on(table.organizationId),
    actorIdx: index("recent_activities_actor_idx").on(table.actorId),
    typeIdx: index("recent_activities_type_idx").on(table.type),
    resIdx: index("recent_activities_res_idx").on(table.resource),
  })
);

// ==================== RELATIONS ====================

export const usersRelations = relations(users, ({ many }) => ({
  userOrganizations: many(userOrganizations, {
    relationName: "userOrganizations_userId",
  }),
  createdProjects: many(projects, { relationName: "projectCreator" }),
  assignedTasks: many(tasks, { relationName: "taskAssignee" }),
  createdTasks: many(tasks, { relationName: "taskCreator" }),
  sessions: many(session),
  accounts: many(account),
  timeEntries: many(timeEntries),
  notifications: many(notifications),
  auditLogs: many(auditLogs),
  createdClients: many(clients, { relationName: "clientCreator" }),
  sentInvitations: many(invitations, { relationName: "invitationSender" }),
  createdSubAdmins: many(subadmin, { relationName: "subadminCreator" }),
  supportTickets: many(supportTickets, { relationName: "ticketSubmitter" }),
  invitedUserOrganizations: many(userOrganizations, {
    relationName: "userOrganizations_invitedBy",
  }),
  createdUserMembers: many(userManagement, {
    relationName: "userManagementCreator",
  }),
  projectComments: many(projectComments),
  calendarEvents: many(calendarEvents),
  createdPaymentLinks: many(paymentLinks),
  createdInvoices: many(invoices),
}));

export const organizationsRelations = relations(
  organizations,
  ({ one, many }) => ({
    subscriptionPlan: one(subscriptionPlans, {
      fields: [organizations.subscriptionPlanId],
      references: [subscriptionPlans.id],
    }),
    userOrganizations: many(userOrganizations),
    projects: many(projects),
    subscriptions: many(subscriptions),
    invoices: many(invoices),
    clients: many(clients),
    invitations: many(invitations),
    auditLogs: many(auditLogs),
    userManagement: many(userManagement),
    calendarEvents: many(calendarEvents),
  })
);

export const subscriptionPlansRelations = relations(
  subscriptionPlans,
  ({ many }) => ({
    organizations: many(organizations),
    subscriptions: many(subscriptions),
  })
);

export const invoicesRelations = relations(invoices, ({ one }) => ({
  organization: one(organizations, {
    fields: [invoices.organizationId],
    references: [organizations.id],
  }),
  client: one(clients, {
    fields: [invoices.clientId],
    references: [clients.id],
  }),
  creator: one(users, {
    fields: [invoices.createdBy],
    references: [users.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.organizationId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [projects.createdBy],
    references: [users.id],
    relationName: "projectCreator",
  }),
  tasks: many(tasks),
  timeEntries: many(timeEntries),
  comments: many(projectComments),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  assignee: one(users, {
    fields: [tasks.assignedTo],
    references: [users.id],
    relationName: "taskAssignee",
  }),
  creator: one(users, {
    fields: [tasks.createdBy],
    references: [users.id],
    relationName: "taskCreator",
  }),
  timeEntries: many(timeEntries),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  organization: one(organizations, {
    fields: [subscriptions.organizationId],
    references: [organizations.id],
  }),
  plan: one(subscriptionPlans, {
    fields: [subscriptions.planId],
    references: [subscriptionPlans.id],
  }),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [clients.organizationId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [clients.createdBy],
    references: [users.id],
    relationName: "clientCreator",
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

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [auditLogs.organizationId],
    references: [organizations.id],
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [invitations.organizationId],
    references: [organizations.id],
  }),
  invitedBy: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
    relationName: "invitationSender",
  }),
}));

export const supportTicketsRelations = relations(supportTickets, ({ one }) => ({
  submittedBy: one(users, {
    fields: [supportTickets.submittedby],
    references: [users.id],
    relationName: "ticketSubmitter",
  }),
}));

export const userOrganizationsRelations = relations(
  userOrganizations,
  ({ one }) => ({
    user: one(users, {
      fields: [userOrganizations.userId],
      references: [users.id],
      relationName: "userOrganizations_userId",
    }),
    organization: one(organizations, {
      fields: [userOrganizations.organizationId],
      references: [organizations.id],
    }),
    invitedBy: one(users, {
      fields: [userOrganizations.invitedBy],
      references: [users.id],
      relationName: "invitationSender",
    }),
  })
);

export const subadminRelations = relations(subadmin, ({ one }) => ({
  createdBy: one(users, {
    fields: [subadmin.createdBy],
    references: [users.id],
    relationName: "subadminCreator",
  }),
}));

// ==================== CALENDAR EVENTS ====================

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    date: timestamp("date").notNull(),
    startHour: integer("start_hour").notNull(),
    endHour: integer("end_hour").notNull(),
    calendarType: text("calendar_type", {
      enum: ["work", "education", "personal", "meeting"],
    }).notNull(),
    platform: text("platform", {
      enum: ["google_meet", "whatsapp", "outlook", "none", "meeting"],
    }).$defaultFn(() => "none"),
    meetLink: text("meet_link"),
    whatsappNumber: text("whatsapp_number"),
    outlookEvent: text("outlook_event"),
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    // Google Calendar integration fields
    googleEventId: text("google_event_id"), // Google Calendar event ID
    googleCalendarId: text("google_calendar_id"), // Google Calendar ID (usually 'primary')
    syncStatus: text("sync_status", {
      enum: ["synced", "pending", "failed", "not_synced"],
    }).$defaultFn(() => "not_synced"),
    lastSyncAt: timestamp("last_sync_at"),
    syncDirection: text("sync_direction", {
      enum: ["app_to_google", "google_to_app", "bidirectional"],
    }).$defaultFn(() => "bidirectional"),
    googleEventData: json("google_event_data").$type<{
      htmlLink?: string;
      hangoutLink?: string;
      conferenceData?: any;
      attendees?: any[];
      location?: string;
      recurrence?: string[];
      [key: string]: any;
    }>(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    organizationIdx: index("calendar_events_organization_idx").on(
      table.organizationId
    ),
    userIdx: index("calendar_events_user_idx").on(table.userId),
    dateIdx: index("calendar_events_date_idx").on(table.date),
    calendarTypeIdx: index("calendar_events_calendar_type_idx").on(
      table.calendarType
    ),
  })
);

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(users, {
    fields: [session.userId],
    references: [users.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(users, {
    fields: [account.userId],
    references: [users.id],
  }),
}));

export const paymentLinksRelations = relations(paymentLinks, ({ one }) => ({
  organization: one(organizations, {
    fields: [paymentLinks.organizationId],
    references: [organizations.id],
  }),
  client: one(clients, {
    fields: [paymentLinks.clientId],
    references: [clients.id],
  }),
  project: one(projects, {
    fields: [paymentLinks.projectId],
    references: [projects.id],
  }),
  creator: one(users, {
    fields: [paymentLinks.createdBy],
    references: [users.id],
  }),
}));

export const userManagementRelations = relations(userManagement, ({ one }) => ({
  organization: one(organizations, {
    fields: [userManagement.organizationId],
    references: [organizations.id],
  }),
  createdBy: one(users, {
    fields: [userManagement.createdBy],
    references: [users.id],
    relationName: "userManagementCreator",
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
      relationName: "commentReplies",
    }),
    replies: many(projectComments, {
      relationName: "commentReplies",
    }),
  })
);

// ==================== NEWSLETTER SUBSCRIBERS ====================

export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    subscribed: boolean("subscribed")
      .$defaultFn(() => true)
      .notNull(),
    subscribedAt: timestamp("subscribed_at")
      .$defaultFn(() => new Date())
      .notNull(),
    unsubscribedAt: timestamp("unsubscribed_at"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    emailIdx: index("newsletter_subscribers_email_idx").on(table.email),
    subscribedIdx: index("newsletter_subscribers_subscribed_idx").on(
      table.subscribed
    ),
  })
);

export const calendarEventsRelations = relations(calendarEvents, ({ one }) => ({
  organization: one(organizations, {
    fields: [calendarEvents.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [calendarEvents.userId],
    references: [users.id],
  }),
}));

export const recentActivitiesRelations = relations(
  recentActivities,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [recentActivities.organizationId],
      references: [organizations.id],
    }),
    actor: one(users, {
      fields: [recentActivities.actorId],
      references: [users.id],
    }),
    user: one(users, {
      fields: [recentActivities.userId],
      references: [users.id],
    }),
  })
);
