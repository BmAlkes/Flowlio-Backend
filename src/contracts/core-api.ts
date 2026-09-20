// Canonical source: Flowlio-Backend. Synchronize with scripts/sync-api-contracts.cjs.
import { z } from "zod";

export const CONTRACT_VERSION = 1;
export const CLIENT_STATUSES = ["Active", "Onboarding", "On Hold", "Inactive", "Completed", "Churned"] as const;
export const PROJECT_STATUSES = ["pending", "ongoing", "completed", "delayed"] as const;
export const PROPOSAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ClientStatus = typeof CLIENT_STATUSES[number];
export type ProjectStatus = typeof PROJECT_STATUSES[number];
export type ProposalStatus = typeof PROPOSAL_STATUSES[number];
export type SerializedDate = string;

export function normalizeProjectStatus(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const status = value.trim().toLowerCase();
  return status === "active" || status === "in_progress" ? "ongoing" : status;
}
export function normalizeClientStatus(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const legacy: Record<string, ClientStatus> = {
    "new lead": "Onboarding", "contacted": "Onboarding", "qualified": "Onboarding", "proposal sent": "Onboarding",
    "contract signed": "Active", "project in progress": "Active", "lost": "Churned",
  };
  if (legacy[value.trim().toLowerCase()]) return legacy[value.trim().toLowerCase()];
  return CLIENT_STATUSES.find(status => status.toLowerCase() === value.trim().toLowerCase()) ?? value;
}
export const clientStatusSchema = z.preprocess(normalizeClientStatus, z.enum(CLIENT_STATUSES));
export const projectStatusSchema = z.preprocess(normalizeProjectStatus, z.enum(PROJECT_STATUSES));
export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export const serializedDateSchema = z.string().datetime({ offset: true });
const optionalDate = serializedDateSchema.nullish();
const nullableText = z.string().nullish();
export const clientSchema = z.object({
  id: z.string(), name: z.string(), email: z.string(), status: clientStatusSchema,
  createdAt: serializedDateSchema, updatedAt: optionalDate,
  image: nullableText, phone: nullableText, address: nullableText,
  followUpAt: optionalDate,
  projects: z.array(z.object({ id: z.string(), name: z.string(), status: projectStatusSchema }).passthrough()).optional(),
}).passthrough();
export const projectSchema = z.object({
  id: z.string(), projectName: z.string(), projectNumber: z.string(), status: projectStatusSchema,
  startDate: optionalDate, endDate: optionalDate, createdAt: serializedDateSchema, updatedAt: serializedDateSchema,
  progress: z.number(), clientId: nullableText, assignedTo: nullableText,
}).passthrough();
export const proposalSchema = z.object({
  id: z.string(), projectTitle: z.string(), status: proposalStatusSchema,
  createdAt: serializedDateSchema, updatedAt: serializedDateSchema,
  approvedAt: optionalDate, rejectedAt: optionalDate,
}).passthrough();
export const clientProposalSchema = z.object({
  id: z.string(), title: z.string(), status: proposalStatusSchema,
  createdAt: serializedDateSchema, updatedAt: serializedDateSchema,
  sentAt: optionalDate, respondedAt: optionalDate,
  totalValue: z.union([z.string(), z.number()]).nullable(), pdfUrl: nullableText,
}).passthrough();
export const clientsResponseSchema = z.object({ success: z.literal(true), data: z.array(clientSchema) }).passthrough();
export const projectsResponseSchema = z.object({ success: z.literal(true), data: z.array(projectSchema) }).passthrough();
export const projectResponseSchema = z.object({ success: z.literal(true), data: projectSchema }).passthrough();
export const clientProjectsResponseSchema = z.object({ data: z.object({
  clientId: z.string(), clientName: z.string(), projectCount: z.number(), projects: z.array(projectSchema),
}).passthrough() }).passthrough();
export const proposalsResponseSchema = z.object({ success: z.literal(true), data: z.array(proposalSchema) }).passthrough();
export const clientProposalsResponseSchema = z.object({ data: z.object({
  clientId: z.string(), clientName: z.string(), proposalCount: z.number(), proposals: z.array(clientProposalSchema),
}).passthrough() }).passthrough();
export interface ApiErrorBody {
  success: false;
  code: string;
  message: string;
  issues?: { path: string; message: string }[];
}

export const coreEndpoints = {
  clientsList: { method: "get", path: "/clients" },
  clientCreate: { method: "post", path: "/clients/create" },
  clientUpdate: { method: "put", path: "/clients/:id" },
  clientDelete: { method: "delete", path: "/clients/:id" },
  projectsList: { method: "get", path: "/projects/all" },
  projectDetail: { method: "get", path: "/projects/:id" },
  projectCreate: { method: "post", path: "/projects/create" },
  projectUpdate: { method: "put", path: "/projects/update/:id" },
  projectDelete: { method: "delete", path: "/projects/:id" },
  clientProjects: { method: "post", path: "/projects/client/:clientId" },
  proposalsList: { method: "get", path: "/proposals/organization" },
  portalProposals: { method: "get", path: "/proposals/client" },
  clientProposals: { method: "get", path: "/proposals/client/:clientId" },
  proposalCreate: { method: "post", path: "/proposals" },
  proposalUpload: { method: "post", path: "/proposals/upload" },
  proposalDelete: { method: "delete", path: "/proposals/:id" },
  proposalApprove: { method: "put", path: "/proposals/:id/approve" },
  proposalReject: { method: "put", path: "/proposals/:id/reject" },
} as const;
export function corePath(name: keyof typeof coreEndpoints, params: Record<string, string> = {}): string {
  return coreEndpoints[name].path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
    if (!params[key]) throw new Error(`Missing route parameter: ${key}`);
    return encodeURIComponent(params[key]);
  });
}
