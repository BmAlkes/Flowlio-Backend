import { z } from "zod";

export const createUserMemberSchema = z.object({
  firstname: z.string().min(2, "First Name must be at least 2 characters"),
  lastname: z.string().min(2, "Last Name must be at least 2 characters"),
  email: z.string().email("Must be a valid email address"),
  phonenumber: z
    .string()
    .regex(/^\+?[1-9]\d{1,14}$/, "Must be a valid international phone number"),
  userrole: z.string().min(2, "Must be a proper role"),
  setpermission: z.string().min(2, "Must be a proper permission"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  companyname: z.string().min(2, "Company name must be at least 2 characters"),
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
  projectNumber: z.string().optional(),
  clientId: z.string().optional(),
  startDate: z
    .string()
    .optional()
    .refine((date) => !date || !isNaN(Date.parse(date)), {
      message: "Start Date must be a valid date format.",
    }),
  endDate: z
    .string()
    .optional()
    .refine((date) => !date || !isNaN(Date.parse(date)), {
      message: "End Date must be a valid date format.",
    }),
  assignedTo: z.string().optional(),
  description: z.string().optional(),
  address: z.string().optional(),
  organizationId: z.string().min(1, {
    message: "Organization ID is required.",
  }),
  contractfile: z.string().optional(),
  projectFiles: z
    .array(
      z.object({
        file: z.string(),
        type: z.string(),
        name: z.string(),
      })
    )
    .optional(),
  status: z.enum(["pending", "ongoing", "completed"]).optional(),
  progress: z.number().min(0).max(100).optional(),
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
  }
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
    }
  );

export const createProjectCommentSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  content: z.string().min(1, "Comment content is required"),
  parentId: z.string().optional(), // For nested comments/replies
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

export const deleteInvoiceSchema = z.object({
  id: z.string().min(1, "Invoice ID is required"),
});
