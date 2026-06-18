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
    status: text("status").$defaultFn(() => "pending"),
    isOrganizationOwner: boolean("is_organization_owner").$defaultFn(
      () => false,
    ),
    isOrganizationManager: boolean("is_organization_manager").$defaultFn(
      () => false,
    ),
    isSuperAdmin: boolean("is_super_admin")
      .$defaultFn(() => false)
      .notNull(),
    subadminId: text("subadmin_id"),
    selectedPlanId: text("selected_plan_id"),
    pendingOrganizationData: json("pending_organization_data").$type<{
      organizationName?: string;
      organizationWebsite?: string;
      organizationIndustry?: string;
      organizationSize?: string;
      planId?: string;
    }>(), // Store organization details before payment
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
    position: text("position"),
  },
  (table) => ({
    emailIdx: index("users_email_idx").on(table.email),
    superAdminIdx: index("users_super_admin_idx").on(table.isSuperAdmin),
  }),
);

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
    customPlanName: text("custom_plan_name"),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency")
      .$defaultFn(() => "USD")
      .notNull(),
    billingCycle: text("billing_cycle")
      .$defaultFn(() => "monthly")
      .notNull(),
    durationValue: integer("duration_value"),
    durationType: text("duration_type"),
    trialDays: integer("trial_days").$defaultFn(() => 7), // Number of trial days (default 7, 0 = no trial)
    features: json("features").$type<{
      // Numeric limits (null = unlimited)
      maxUsers?: number | null;
      maxProjects?: number | null;
      maxStorage?: number | null; // in GB
      maxTasks?: number | null;
      maxLeads?: number | null;
      maxClients?: number | null;
      maxWebhooks?: number | null;
      maxInvoices?: number | null;
      maxProposals?: number | null;
      aiTokenLimit?: number | null; // tokens per month
      // Boolean feature flags
      aiAssist?: boolean;
      prioritySupport?: boolean;
      calendarAccess?: boolean;
      taskManagement?: boolean;
      timeTracking?: boolean;
      analyticsAccess?: boolean;
      apiAccess?: boolean;
      paymentLinks?: boolean;
      proposalsAccess?: boolean;
      whitelabel?: boolean;
      customDomain?: boolean;
      customFeatures?: string[];
      [key: string]: any;
    }>(),
    paypalPlanId: text("paypal_plan_id"),
    paypalProductId: text("paypal_product_id"),
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
  }),
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
    status: text("status").$defaultFn(() => "active"),
    subscriptionPlanId: text("subscription_plan_id").references(
      () => subscriptionPlans.id,
    ),
    subscriptionStatus: text("subscription_status").$defaultFn(() => "active"),
    subscriptionStartDate: timestamp("subscription_start_date"),
    subscriptionEndDate: timestamp("subscription_end_date"),
    trialEndsAt: timestamp("trial_ends_at"),
    maxUsers: integer("max_users").$defaultFn(() => 5),
    maxProjects: integer("max_projects").$defaultFn(() => 3),
    maxStorage: integer("max_storage").$defaultFn(() => 1), // in GB
    // Per-org limit overrides — take precedence over plan limits (null = follow plan)
    overrideMaxLeads: integer("override_max_leads"),
    overrideMaxClients: integer("override_max_clients"),
    overrideMaxWebhooks: integer("override_max_webhooks"),
    overrideMaxTasks: integer("override_max_tasks"),
    overrideMaxInvoices: integer("override_max_invoices"),
    overrideMaxProposals: integer("override_max_proposals"),
    overrideAiTokenLimit: integer("override_ai_token_limit"),
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
      table.subscriptionStatus,
    ),
  }),
);

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
      .$defaultFn(() => "member"),
    status: text("status")
      .notNull()
      .$defaultFn(() => "active"),
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
      table.organizationId,
    ),
    roleIdx: index("user_organizations_role_idx").on(table.role),
    statusIdx: index("user_organizations_status_idx").on(table.status),
  }),
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
    clientId: text("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    description: text("description"),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assignedTo: text("assigned_to").references(() => users.id, {
      onDelete: "set null",
    }),
    status: text("status").$defaultFn(() => "active"),
    visibility: text("visibility")
      .$type<"public" | "private">()
      .default("private"),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    progress: integer("progress").$defaultFn(() => 0),
    address: text("address"),
    budget: decimal("budget", { precision: 10, scale: 2 }),
    contractfile: text("contractfile"),
    contractfilePublicId: text("contractfile_public_id"), // For Cloudinary
    projectFiles: json("project_files").$type<{
      projectPdf?: {
        url: string;
        publicId: string;
        name: string;
        type: string;
        size?: number;
      };
      totalSize?: number;
    }>(),
    tags: json("tags").$type<string[]>(),
    customFields: json("custom_fields").$type<Record<string, any>>(),
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
    position: integer("position").default(0).notNull(),
  },
  (table) => ({
    orgIdx: index("projects_organization_idx").on(table.organizationId),
    statusIdx: index("projects_status_idx").on(table.status),
    createdByIdx: index("projects_created_by_idx").on(table.createdBy),
    clientIdx: index("projects_client_idx").on(table.clientId),
    assignedToIdx: index("projects_assigned_to_idx").on(table.assignedTo),
    projectNumberIdx: index("projects_project_number_idx").on(
      table.projectNumber,
    ),
    // Composite index for getProjectById query optimization
    orgIdIdx: index("projects_org_id_idx").on(table.organizationId, table.id),
    positionIdx: index("projects_position_idx").on(table.position),
  }),
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
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
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
    taskIdx: index("project_comments_task_idx").on(table.taskId),
    createdAtIdx: index("project_comments_created_at_idx").on(table.createdAt),
  }),
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
    assignedTo: text("assigned_to").references(() => users.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<
        "todo" | "in_progress" | "completed" | "updated" | "delay" | "changes"
      >()
      .$defaultFn(() => "todo"),
    visibility: text("visibility")
      .$type<"public" | "private">()
      .default("private"),
    endDate: timestamp("end_date"),
    startAfter: text("start_after"),
    finishBefore: text("finish_before"),
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
    parentId: text("parent_id").references((): any => tasks.id, {
      onDelete: "cascade",
    }),
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
    parentIdIdx: index("tasks_parent_id_idx").on(table.parentId),
  }),
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
  }),
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
    invoiceNumber: text("invoice_number").notNull(),
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
      table.invoiceNumber,
    ),
    createdByIdx: index("invoices_created_by_idx").on(table.createdBy),
    // Invoice numbers should be unique per organization
    uniqueInvoiceNumberPerOrg: unique("unique_invoice_number_per_org").on(
      table.invoiceNumber,
      table.organizationId,
    ),
  }),
);

// ==================== PLAN PAYMENT REQUESTS (on-demand PayPal flow) ====================

export const planPaymentRequests = pgTable(
  "plan_payment_requests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id),
    paypalOrderId: text("paypal_order_id").notNull().unique(),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency")
      .$defaultFn(() => "USD")
      .notNull(),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    description: text("description"),
    notes: text("notes"),
    invoiceNumber: text("invoice_number"),
    status: text("status")
      .$defaultFn(() => "pending")
      .notNull(), // pending | completed | failed | cancelled
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdx: index("plan_payment_requests_org_idx").on(table.orgId),
    statusIdx: index("plan_payment_requests_status_idx").on(table.status),
    orderIdx: index("plan_payment_requests_order_idx").on(table.paypalOrderId),
  }),
);

export const recurringInvoices = pgTable(
  "recurring_invoices",
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
    templateName: text("template_name").notNull(),
    clientname: text("client_name").notNull(),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    description: text("description"),
    frequency: text("frequency")
      .$type<"daily" | "weekly" | "monthly" | "yearly">()
      .notNull(),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date"),
    lastRunDate: timestamp("last_run_date"),
    nextRunDate: timestamp("next_run_date").notNull(),
    status: text("status")
      .$defaultFn(() => "active")
      .notNull(), // active, paused, completed
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdx: index("recurring_invoices_organization_idx").on(
      table.organizationId,
    ),
    clientIdx: index("recurring_invoices_client_idx").on(table.clientId),
    statusIdx: index("recurring_invoices_status_idx").on(table.status),
    nextRunIdx: index("recurring_invoices_next_run_idx").on(table.nextRunDate),
  }),
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
      table.providerId,
    ),
  }),
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
    position: text("position"),
  },
  (table) => ({
    emailIdx: index("user_management_email_idx").on(table.email),
    orgIdx: index("user_management_organization_idx").on(table.organizationId),
    statusIdx: index("user_management_status_idx").on(table.status),
    roleIdx: index("user_management_role_idx").on(table.userrole),
  }),
);

// ==================== PROJECT EXPENSES ====================

export const projectExpenses = pgTable(
  "project_expenses",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    date: timestamp("date").notNull(),
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
    projectIdx: index("project_expenses_project_idx").on(table.projectId),
    categoryIdx: index("project_expenses_category_idx").on(table.category),
    dateIdx: index("project_expenses_date_idx").on(table.date),
  }),
);

// ==================== FILES & VERSIONS ====================

export const files = pgTable(
  "files",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    taskId: text("task_id").references(() => tasks.id, {
      onDelete: "cascade",
    }),
    clientId: text("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    uploadedBy: text("uploaded_by")
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
    orgIdx: index("files_organization_idx").on(table.organizationId),
    projectIdx: index("files_project_idx").on(table.projectId),
    taskIdx: index("files_task_idx").on(table.taskId),
    clientIdx: index("files_client_idx").on(table.clientId),
  }),
);

export const fileVersions = pgTable(
  "file_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    type: text("type").notNull(),
    versionNumber: integer("version_number").notNull(),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    fileIdx: index("file_versions_file_idx").on(table.fileId),
    versionIdx: index("file_versions_version_idx").on(table.versionNumber),
  }),
);

// ==================== CLIENT MANAGEMENT ====================

export const clients = pgTable(
  "clients",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
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
    customFields: json("custom_fields").$type<Record<string, any>>(),
    status: text("status")
      .$type<"New Lead" | "Contacted" | "Qualified" | "Proposal Sent" | "Contract Signed" | "Project In Progress" | "Completed" | "Inactive" | "Lost">()
      .$defaultFn(() => "New Lead"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    position: integer("position").default(0).notNull(),
    leadValue: decimal("lead_value", { precision: 10, scale: 2 }),
    leadProbability: integer("lead_probability").default(0), // 0-100
    lastInteractionAt: timestamp("last_interaction_at"),
    leadTemperature: text("lead_temperature").$type<"Hot" | "Warm" | "Cold" | "Lost">(),
    followUpAt: timestamp("follow_up_at"),
    clientType: text("type")
      .$type<"lead" | "client">()
      .$defaultFn(() => "lead"),
    webhookId: text("webhook_id"),
    webhookName: text("webhook_name"),
  },
  (table) => ({
    orgIdx: index("clients_organization_idx").on(table.organizationId),
    userIdx: index("clients_user_idx").on(table.userId),
    statusIdx: index("clients_status_idx").on(table.status),
    emailIdx: index("clients_email_idx").on(table.email),
    emailOrgIdx: index("clients_email_org_idx").on(
      table.email,
      table.organizationId,
    ),
    positionIdx: index("clients_position_idx").on(table.position),
  }),
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
  }),
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
  }),
);

// ==================== CLIENT INTERACTIONS (CRM Timeline) ====================

export const clientInteractions = pgTable(
  "client_interactions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type")
      .$type<"note" | "call" | "email" | "meeting" | "status_change" | "temperature_change">()
      .notNull(),
    content: text("content").notNull(),
    metadata: json("metadata"), // e.g. { fromStatus: "New Lead", toStatus: "Contacted" }
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    clientIdx: index("client_interactions_client_idx").on(table.clientId),
    typeIdx: index("client_interactions_type_idx").on(table.type),
    createdAtIdx: index("client_interactions_created_at_idx").on(
      table.createdAt,
    ),
  }),
);

// ==================== INTERACTION REPLIES ====================

export const interactionReplies = pgTable(
  "interaction_replies",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    interactionId: text("interaction_id")
      .notNull()
      .references(() => clientInteractions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    interactionIdx: index("interaction_replies_interaction_idx").on(table.interactionId),
  }),
);

// ==================== LEAD FIELD DEFINITIONS ====================

export const leadFieldDefinitions = pgTable(
  "lead_field_definitions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type")
      .$type<"text" | "number" | "select" | "multiselect" | "date" | "boolean" | "url">()
      .notNull(),
    options: json("options").$type<string[]>(),
    required: boolean("required").$defaultFn(() => false),
    position: integer("position").$defaultFn(() => 0),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdx: index("lead_field_definitions_org_idx").on(table.orgId),
  }),
);

// ==================== LEAD WEBHOOKS ====================

export const leadWebhooks = pgTable(
  "lead_webhooks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    source: text("source")
      .$type<"wordpress" | "facebook" | "generic">()
      .notNull(),
    token: text("token").notNull().unique(),
    active: boolean("active").$defaultFn(() => true),
    fieldMapping: json("field_mapping").$type<Record<string, string>>().$defaultFn(() => ({})),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdx: index("lead_webhooks_org_idx").on(table.orgId),
  }),
);

// ==================== LEAD WEBHOOK LOGS ====================

export const leadWebhookLogs = pgTable(
  "lead_webhook_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => leadWebhooks.id, { onDelete: "cascade" }),
    status: text("status").$type<"success" | "error">().notNull(),
    payload: json("payload").$type<Record<string, any>>(),
    leadId: text("lead_id"),
    error: text("error"),
    ip: text("ip"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    webhookIdx: index("lead_webhook_logs_webhook_idx").on(table.webhookId),
    createdAtIdx: index("lead_webhook_logs_created_at_idx").on(table.createdAt),
  }),
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
  }),
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
  }),
);

// ==================== CUSTOM FIELDS ====================

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entityType: text("entity_type")
      .notNull()
      .$defaultFn(() => "project"),
    name: text("name").notNull(),
    type: text("type").notNull(),
    options: json("options").$type<{ label: string; color: string }[]>(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdx: index("custom_field_definitions_org_idx").on(table.organizationId),
    entityTypeIdx: index("custom_field_definitions_entity_type_idx").on(
      table.entityType,
    ),
  }),
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
    priority: text("priority", {
      enum: ["low", "medium", "high", "urgent"],
    }).notNull(),
    status: text("status", {
      enum: ["open", "in_progress", "resolved", "closed"],
    })
      .notNull()
      .default("open"),
    submittedby: text("submitted_by")
      .notNull()
      .references(() => users.id),
    submittedbyRole: text("submitted_by_role").notNull(),
    submittedbyName: text("submitted_by_name").notNull(),
    destination: text("destination", { enum: ["internal", "platform"] })
      .notNull()
      .default("platform"),
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
  }),
);

// ==================== SUPPORT TICKET MESSAGES ====================

export const supportTicketMessages = pgTable(
  "support_ticket_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    senderRole: text("sender_role").notNull(),
    senderName: text("sender_name").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    ticketIdIdx: index("support_ticket_messages_ticket_id_idx").on(
      table.ticketId,
    ),
    senderIdIdx: index("support_ticket_messages_sender_id_idx").on(
      table.senderId,
    ),
  }),
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
      table.paymentLink,
    ),
  }),
);

// ==================== RECENT ACTIVITIES ====================
export const recentActivities = pgTable(
  "recent_activities",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id").references(() => organizations.id),
    userId: text("user_id").references(() => users.id),
    actorId: text("actor_id").references(() => users.id),
    type: text("type").notNull(),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
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
  }),
);

export const userOnboarding = pgTable(
  "user_onboarding",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // "admin" | "manager" | "viewer"
    dismissed: boolean("dismissed").$defaultFn(() => false).notNull(),
    dismissedAt: timestamp("dismissed_at"),
    completedAt: timestamp("completed_at"),
    steps: json("steps")
      .$type<Record<string, { completedAt: string } | null>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    userOnboardingUserIdx: index("user_onboarding_user_idx").on(table.userId),
    userOnboardingRoleIdx: index("user_onboarding_role_idx").on(table.role),
  }),
);

export const aiTokenLimits = pgTable(
  "ai_token_limits",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    feature: text("feature"),
    tokenLimit: integer("token_limit").notNull(),
    tokensUsed: integer("tokens_used")
      .$defaultFn(() => 0)
      .notNull(),
    period: text("period")
      .default("monthly")
      .notNull(),
    resetAt: timestamp("reset_at"),
    alertThresholdPercent: integer("alert_threshold_percent")
      .$defaultFn(() => 80)
      .notNull(),
    isActive: boolean("is_active")
      .$defaultFn(() => true)
      .notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    organizationIdx: index("ai_token_limits_organization_idx").on(
      table.organizationId,
    ),
    userIdx: index("ai_token_limits_user_idx").on(table.userId),
    uniqueOrgUserFeature: unique("ai_token_limits_org_user_feature_unique").on(
      table.organizationId,
      table.userId,
      table.feature,
    ),
  }),
);

export const aiUsageLogs = pgTable(
  "ai_usage_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    provider: text("provider")
      .default("openai")
      .notNull(),
    model: text("model"),
    promptTokens: integer("prompt_tokens")
      .$defaultFn(() => 0)
      .notNull(),
    completionTokens: integer("completion_tokens")
      .$defaultFn(() => 0)
      .notNull(),
    totalTokens: integer("total_tokens")
      .$defaultFn(() => 0)
      .notNull(),
    status: text("status")
      .default("success")
      .notNull(),
    errorMessage: text("error_message"),
    metadata: json("metadata"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    organizationIdx: index("ai_usage_logs_organization_idx").on(
      table.organizationId,
    ),
    userIdx: index("ai_usage_logs_user_idx").on(table.userId),
    featureIdx: index("ai_usage_logs_feature_idx").on(table.feature),
    createdAtIdx: index("ai_usage_logs_created_at_idx").on(table.createdAt),
  }),
);

export const aiUsageAlerts = pgTable(
  "ai_usage_alerts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    alertType: text("alert_type").notNull(),
    thresholdPercent: integer("threshold_percent"),
    tokensUsed: integer("tokens_used")
      .$defaultFn(() => 0)
      .notNull(),
    tokenLimit: integer("token_limit")
      .$defaultFn(() => 0)
      .notNull(),
    notifiedTo: text("notified_to"),
    isRead: boolean("is_read")
      .$defaultFn(() => false)
      .notNull(),
    metadata: json("metadata"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    organizationIdx: index("ai_usage_alerts_organization_idx").on(
      table.organizationId,
    ),
    userIdx: index("ai_usage_alerts_user_idx").on(table.userId),
  }),
);

export const webhookSecrets = pgTable(
  "webhook_secrets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    label: text("label"),
    isActive: boolean("is_active")
      .$defaultFn(() => true)
      .notNull(),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    organizationIdx: index("webhook_secrets_organization_idx").on(
      table.organizationId,
    ),
  }),
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
  createdRecurringInvoices: many(recurringInvoices),
  supportTicketMessages: many(supportTicketMessages),
  aiTokenLimits: many(aiTokenLimits),
  aiUsageLogs: many(aiUsageLogs),
  aiUsageAlerts: many(aiUsageAlerts),
  webhookSecrets: many(webhookSecrets),
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
    recurringInvoices: many(recurringInvoices),
  }),
);

export const subscriptionPlansRelations = relations(
  subscriptionPlans,
  ({ many }) => ({
    organizations: many(organizations),
    subscriptions: many(subscriptions),
  }),
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
  expenses: many(projectExpenses),
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
  parentTask: one(tasks, {
    fields: [tasks.parentId],
    references: [tasks.id],
    relationName: "subtasks",
  }),
  subtasks: many(tasks, {
    relationName: "subtasks",
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
  recurringInvoices: many(recurringInvoices),
}));

export const recurringInvoicesRelations = relations(
  recurringInvoices,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [recurringInvoices.organizationId],
      references: [organizations.id],
    }),
    client: one(clients, {
      fields: [recurringInvoices.clientId],
      references: [clients.id],
    }),
    creator: one(users, {
      fields: [recurringInvoices.createdBy],
      references: [users.id],
    }),
  }),
);

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

export const supportTicketsRelations = relations(
  supportTickets,
  ({ one, many }) => ({
    submittedBy: one(users, {
      fields: [supportTickets.submittedby],
      references: [users.id],
      relationName: "ticketSubmitter",
    }),
    messages: many(supportTicketMessages),
  }),
);

export const supportTicketMessagesRelations = relations(
  supportTicketMessages,
  ({ one }) => ({
    ticket: one(supportTickets, {
      fields: [supportTicketMessages.ticketId],
      references: [supportTickets.id],
    }),
    sender: one(users, {
      fields: [supportTicketMessages.senderId],
      references: [users.id],
    }),
  }),
);

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
  }),
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
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
      table.organizationId,
    ),
    userIdx: index("calendar_events_user_idx").on(table.userId),
    dateIdx: index("calendar_events_date_idx").on(table.date),
    calendarTypeIdx: index("calendar_events_calendar_type_idx").on(
      table.calendarType,
    ),
  }),
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
  }),
);

export const projectExpensesRelations = relations(
  projectExpenses,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectExpenses.projectId],
      references: [projects.id],
    }),
    creator: one(users, {
      fields: [projectExpenses.createdBy],
      references: [users.id],
    }),
  }),
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
      table.subscribed,
    ),
  }),
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
  }),
);

export const filesRelations = relations(files, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [files.organizationId],
    references: [organizations.id],
  }),
  project: one(projects, {
    fields: [files.projectId],
    references: [projects.id],
  }),
  task: one(tasks, {
    fields: [files.taskId],
    references: [tasks.id],
  }),
  client: one(clients, {
    fields: [files.clientId],
    references: [clients.id],
  }),
  uploader: one(users, {
    fields: [files.uploadedBy],
    references: [users.id],
  }),
  versions: many(fileVersions),
}));

export const fileVersionsRelations = relations(fileVersions, ({ one }) => ({
  file: one(files, {
    fields: [fileVersions.fileId],
    references: [files.id],
  }),
  uploader: one(users, {
    fields: [fileVersions.uploadedBy],
    references: [users.id],
  }),
}));

// ==================== AI PROPOSALS ====================

export const proposals = pgTable(
  "proposals",
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
    projectTitle: text("project_title").notNull(),
    clientName: text("client_name").notNull(),
    companyName: text("company_name"),
    // Store the full AI-generated proposal data as JSON
    proposalData: json("proposal_data").$type<Record<string, any>>(),
    // Status: pending | approved | rejected
    status: text("status")
      .$defaultFn(() => "pending")
      .notNull(),
    approvedAt: timestamp("approved_at"),
    rejectedAt: timestamp("rejected_at"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdx: index("proposals_organization_idx").on(table.organizationId),
    clientIdx: index("proposals_client_idx").on(table.clientId),
    statusIdx: index("proposals_status_idx").on(table.status),
    createdByIdx: index("proposals_created_by_idx").on(table.createdBy),
  }),
);

export const proposalsRelations = relations(proposals, ({ one }) => ({
  organization: one(organizations, {
    fields: [proposals.organizationId],
    references: [organizations.id],
  }),
  client: one(clients, {
    fields: [proposals.clientId],
    references: [clients.id],
  }),
  createdByUser: one(users, {
    fields: [proposals.createdBy],
    references: [users.id],
  }),
}));

// ==================== PROJECT & TASK TEMPLATES ====================

export const projectTemplates = pgTable(
  "project_templates",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    description: text("description"),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    isGlobal: boolean("is_global")
      .$defaultFn(() => false)
      .notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdx: index("project_templates_organization_idx").on(
      table.organizationId,
    ),
    globalIdx: index("project_templates_global_idx").on(table.isGlobal),
  }),
);

export const projectTemplateTasks = pgTable(
  "project_template_tasks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    templateId: text("template_id")
      .notNull()
      .references(() => projectTemplates.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    estimatedHours: decimal("estimated_hours", { precision: 10, scale: 2 }),
    order: integer("order")
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
    templateIdx: index("project_template_tasks_template_idx").on(
      table.templateId,
    ),
  }),
);

export const projectTemplateRelations = relations(
  projectTemplates,
  ({ many, one }) => ({
    organization: one(organizations, {
      fields: [projectTemplates.organizationId],
      references: [organizations.id],
    }),
    creator: one(users, {
      fields: [projectTemplates.createdBy],
      references: [users.id],
    }),
    tasks: many(projectTemplateTasks),
  }),
);

export const projectTemplateTaskRelations = relations(
  projectTemplateTasks,
  ({ one }) => ({
    template: one(projectTemplates, {
      fields: [projectTemplateTasks.templateId],
      references: [projectTemplates.id],
    }),
  }),
);

export const clientInteractionsRelations = relations(
  clientInteractions,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [clientInteractions.clientId],
      references: [clients.id],
    }),
    user: one(users, {
      fields: [clientInteractions.userId],
      references: [users.id],
    }),
    organization: one(organizations, {
      fields: [clientInteractions.organizationId],
      references: [organizations.id],
    }),
    replies: many(interactionReplies),
  }),
);

export const interactionRepliesRelations = relations(
  interactionReplies,
  ({ one }) => ({
    interaction: one(clientInteractions, {
      fields: [interactionReplies.interactionId],
      references: [clientInteractions.id],
    }),
    user: one(users, {
      fields: [interactionReplies.userId],
      references: [users.id],
    }),
  }),
);
