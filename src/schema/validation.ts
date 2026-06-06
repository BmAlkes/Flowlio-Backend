import { z } from "zod";

export const createUserMemberSchema = z.object({
  firstname: z.string().min(2, "First Name must be at least 2 characters"),
  lastname: z.string().min(2, "Last Name must be at least 2 characters"),
  email: z.string().email("Must be a valid email address"),
  phonenumber: z
    .string()
    .regex(/^\+?[1-9]\d{1,14}$/, "Must be a valid international phone number"),
  userrole: z.string().min(2, "Must be a proper role"),
  position: z.string().optional(),
  setpermission: z.string().min(2, "Must be a proper permission"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
  companyname: z.string().min(2, "Company name must be at least 2 characters"),
});

export const setOrganizationManagerSchema = z.object({
  setAsManager: z.boolean({
    required_error: "setAsManager is required",
    invalid_type_error: "setAsManager must be a boolean",
  }),
});

// Sub Admin validation schemas
export const createSubAdminSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  contactNumber: z.string().optional(),
  permission: z.string().min(1, "Permission is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const updateSubAdminSchema = z.object({
  firstName: z.string().min(1, "First name is required").optional(),
  lastName: z.string().min(1, "Last name is required").optional(),
  email: z.string().email("Invalid email address").optional(),
  contactNumber: z.string().optional(),
  permission: z.string().min(1, "Permission is required").optional(),
});

// User validation schemas
export const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
});

export const updateUserSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  email: z.string().email("Invalid email address").optional(),
});

// Organization validation schemas
export const createOrganizationSchema = z.object({
  name: z.string().min(1, "Organization name is required"),
  slug: z.string().min(1, "Slug is required"),
  description: z.string().optional(),
});

export const updateOrganizationSchema = z.object({
  name: z.string().min(1, "Organization name is required").optional(),
  slug: z.string().min(1, "Slug is required").optional(),
  description: z.string().optional(),
  status: z.enum(["active", "suspended", "inactive"]).optional(),
  subscriptionPlan: z.enum(["free", "basic", "pro", "enterprise"]).optional(),
  subscriptionStatus: z
    .enum(["active", "expired", "cancelled", "pending"])
    .optional(),
});

// ==================== PROJECT VALIDATION SCHEMAS ====================
const projectBaseSchema = z.object({
  name: z.string().min(2, {
    message: "Project Name must be at least 2 characters.",
  }),
  projectNumber: z
    .string()
    .nullish()
    .transform((val) => (val === null || val === "" ? undefined : val)),
  clientId: z
    .string()
    .nullish()
    .transform((val) => (val === null || val === "" ? undefined : val)),
  startDate: z
    .string()
    .nullish()
    .transform((val) => (val === null || val === "" ? undefined : val))
    .refine((date) => !date || !isNaN(Date.parse(date)), {
      message: "Start Date must be a valid date format.",
    }),
  endDate: z
    .string()
    .nullish()
    .transform((val) => (val === null || val === "" ? undefined : val))
    .refine((date) => !date || !isNaN(Date.parse(date)), {
      message: "End Date must be a valid date format.",
    }),
  assignedTo: z
    .string()
    .nullish()
    .transform((val) => (val === null || val === "" ? undefined : val)),
  description: z
    .string()
    .nullish()
    .transform((val) => (val === null || val === "" ? undefined : val)),
  address: z
    .string()
    .nullish()
    .transform((val) => (val === null || val === "" ? undefined : val)),
  budget: z
    .number()
    .min(0, { message: "Budget must be a positive number." })
    .nullish()
    .transform((val) => (val === null ? undefined : val)),
  organizationId: z.string().min(1, {
    message: "Organization ID is required.",
  }),
  contractfile: z
    .string()
    .nullish()
    .transform((val) => (val === null || val === "" ? undefined : val)),
  projectFiles: z
    .array(
      z.object({
        file: z.string(),
        type: z.string(),
        name: z.string(),
      }),
    )
    .optional(),
  customFields: z.record(z.any()).optional(),
  status: z.enum(["pending", "ongoing", "completed", "delayed"]).optional(),
  progress: z.number().min(0).max(100).optional(),
  visibility: z.enum(["public", "private"]).optional().default("private"),
  templateId: z.string().optional(),
});

export const createProjectSchema = projectBaseSchema.refine(
  (data) => {
    if (!data.startDate || !data.endDate) return true;
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    return end >= start;
  },
  {
    message: "End Date must be after or equal to Start Date.",
    path: ["endDate"],
  },
);

export const updateProjectSchema = projectBaseSchema
  .partial()
  .extend({
    organizationId: z
      .string()
      .min(1, {
        message: "Organization ID is required.",
      })
      .optional(),
  })
  .refine(
    (data) => {
      // Only validate date order if both dates are provided
      if (!data.startDate || !data.endDate) return true;
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      return end >= start;
    },
    {
      message: "End Date must be after or equal to Start Date.",
      path: ["endDate"],
    },
  );

export const createProjectCommentSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  content: z.string().min(1, "Comment content is required"),
  parentId: z.string().optional(),
  taskId: z.string().optional(),
});

export const updateProjectCommentSchema = z.object({
  content: z.string().min(1, "Comment content is required"),
});

export const createCalendarEventSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    description: z
      .string()
      .optional()
      .transform((val) => (val === "" ? undefined : val)),
    date: z.string().min(1, "Date is required"),
    startHour: z
      .number({
        required_error: "Start hour is required",
        invalid_type_error: "Start hour must be a number",
      })
      .min(0, "Start hour must be between 0 and 23")
      .max(23, "Start hour must be between 0 and 23"),
    endHour: z
      .number({
        required_error: "End hour is required",
        invalid_type_error: "End hour must be a number",
      })
      .min(0, "End hour must be between 0 and 23")
      .max(23, "End hour must be between 0 and 23"),
    calendarType: z.enum(["work", "education", "personal", "meeting"], {
      errorMap: () => ({
        message:
          "Calendar type must be one of: work, education, personal, meeting",
      }),
    }),
    platform: z
      .enum(["google_meet", "whatsapp", "outlook", "none", "meeting"], {
        errorMap: () => ({
          message:
            "Platform must be one of: google_meet, whatsapp, outlook, none, meeting",
        }),
      })
      .optional()
      .default("none")
      .transform((val) => {
        // Map "meeting" to "google_meet" if platform is "meeting"
        if (val === "meeting") return "google_meet";
        return val;
      }),
    meetLink: z.string().optional(),
    whatsappNumber: z.string().optional(),
    outlookEvent: z.string().optional(),
  })
  .refine((data) => data.startHour < data.endHour, {
    message: "End hour must be after start hour",
    path: ["endHour"],
  });

// ==================== PAYMENT LINKS VALIDATION SCHEMAS ====================

export const createPaymentLinkSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  projectId: z.string().min(1, "Project is required"),
  description: z.string().min(1, "Description is required"),
  amount: z.number().min(0.01, "Amount must be greater than 0"),
});

export const updatePaymentLinkSchema = createPaymentLinkSchema.partial();

export const deletePaymentLinkSchema = z.object({
  id: z.string().min(1, "Payment link ID is required"),
});

// ==================== INVOICE VALIDATION SCHEMAS ====================

export const createInvoiceSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  amount: z.number().min(0.01, "Amount must be greater than 0"),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  pdfFile: z.string().optional(), // Base64 encoded PDF file
  pdfFileName: z.string().optional(), // Original filename
});

export const updateInvoiceSchema = createInvoiceSchema.partial();

// ==================== CLIENT VALIDATION SCHEMAS ====================
export const clientBaseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  cpfcnpj: z.string().optional(),
  businessIndustry: z.string().optional(),
  address: z.string().optional(),
  socialMediaLinks: z
    .array(
      z.object({
        type: z.string(),
        url: z.string(),
      }),
    )
    .optional(),
  status: z.string().optional(),
  customFields: z.record(z.any()).optional(),
});

export const createClientSchema = clientBaseSchema;
export const updateClientSchema = clientBaseSchema.partial();

export const createCustomFieldDefinitionSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["text", "number", "date", "boolean", "select"]),
  entityType: z.enum(["project", "client"]).default("project"),
  options: z
    .array(
      z.object({
        label: z.string().min(1, "Option label is required"),
        color: z
          .string()
          .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid color format"),
      }),
    )
    .optional(),
});

export const updateCustomFieldDefinitionSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  options: z
    .array(
      z.object({
        label: z.string().min(1, "Option label is required"),
        color: z
          .string()
          .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid color format"),
      }),
    )
    .optional(),
});

export const deleteInvoiceSchema = z.object({
  id: z.string().min(1, "Invoice ID is required"),
});

// ==================== REORDER VALIDATION SCHEMAS ====================
export const reorderClientsSchema = z.object({
  updates: z
    .array(
      z.object({
        clientId: z.string().min(1, "Client ID is required"),
        position: z.number().min(0, "Position must be a non-negative integer"),
      }),
    )
    .min(1, "At least one update is required"),
});

export const reorderProjectsSchema = z.object({
  updates: z
    .array(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        position: z.number().min(0, "Position must be a non-negative integer"),
      }),
    )
    .min(1, "At least one update is required"),
});

export const reorderLeadsSchema = z.object({
  updates: z
    .array(
      z.object({
        leadId: z.string().min(1, "Lead ID is required"),
        position: z.number().min(0, "Position must be a non-negative integer"),
      }),
    )
    .min(1, "At least one update is required"),
});

// ==================== RECURRING INVOICE VALIDATION SCHEMAS ====================

export const createRecurringInvoiceSchema = z.object({
  templateName: z.string().min(1, "Template name is required"),
  clientId: z.string().min(1, "Client is required"),
  amount: z.number().min(0.01, "Amount must be greater than 0"),
  description: z.string().optional(),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional(),
});

export const updateRecurringInvoiceSchema = createRecurringInvoiceSchema
  .partial()
  .extend({
    status: z.enum(["active", "paused", "completed"]).optional(),
  });

// ==================== PROJECT TEMPLATE VALIDATION SCHEMAS ====================

export const createProjectTemplateSchema = z.object({
  name: z.string().min(1, "Template name is required"),
  description: z.string().optional(),
  tasks: z
    .array(
      z.object({
        title: z.string().min(1, "Task title is required"),
        description: z.string().optional(),
        estimatedHours: z.number().nullish(),
        order: z.number().optional(),
      }),
    )
    .optional(),
});

export const saveProjectAsTemplateSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  templateName: z.string().min(1, "Template name is required"),
  description: z.string().optional(),
});
