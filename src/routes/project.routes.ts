import { resourceAccess } from "../security/resource-access";
import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { createProject } from "../controllers/organization/projects/createproject.controller";
import { updateProject } from "../controllers/organization/projects/updateproject.controller";
import {
  getAllProjects,
  getProjectById,
  getOrganizationClients,
  getOrganizationUsers,
} from "../controllers/organization/projects/getproject.controller";
import { getProjectsByClient } from "../controllers/organization/projects/getprojectsbyclient.controller";
import { deleteProject } from "../controllers/organization/projects/deleteproject.controller";
import { getProjectComments } from "../controllers/organization/projects/getprojectcomments.controller";
import { createProjectComment } from "../controllers/organization/projects/createprojectcomment.controller";
import { deleteProjectComment } from "../controllers/organization/projects/deleteprojectcomment.controller";
import { updateProjectComment } from "../controllers/organization/projects/updateprojectcomment.controller";
import { getAllOrgComments } from "../controllers/organization/projects/getallorgcomments.controller";
import { getProjectScheduleData } from "../controllers/organization/projects/getprojectscheduledata.controller";
import { getProjectStatusData } from "../controllers/organization/projects/getprojectstatusdata.controller";
import { getProjectExpenses } from "../controllers/organization/projects/expenses/getProjectExpenses.controller";
import { createProjectExpense } from "../controllers/organization/projects/expenses/createProjectExpense.controller";
import { deleteProjectExpense } from "../controllers/organization/projects/expenses/deleteProjectExpense.controller";
import { reorderProjects } from "../controllers/organization/projects/reorderprojects.controller";
import { getTemplates } from "../controllers/organization/projects/templates/gettemplates.controller";
import { saveProjectAsTemplate } from "../controllers/organization/projects/templates/saveastemplate.controller";
import { createProjectTemplate } from "../controllers/organization/projects/templates/createtemplate.controller";
import { updateProjectTemplate } from "../controllers/organization/projects/templates/updatetemplate.controller";
import { deleteProjectTemplate } from "../controllers/organization/projects/templates/deletetemplate.controller";
import { getProjectRiskAlerts, dismissProjectRiskAlert } from "../controllers/organization/projects/riskAlerts.controller";
import { getMilestones, createMilestone, updateMilestone, deleteMilestone } from "../controllers/organization/projects/milestones.controller";

const router = Router();

// ==================== PROJECT ROUTES ====================
router.post("/create", isAuthenticated, resourceAccess.action("create"), resourceAccess.projectFields, createProject as any);
router.put("/update/:id", isAuthenticated, resourceAccess.project(req => req.params.id, "update"), resourceAccess.projectFields, updateProject as any);
router.get("/all", isAuthenticated, getAllProjects);
router.get("/schedule-data", isAuthenticated, getProjectScheduleData);
router.get("/status-data", isAuthenticated, getProjectStatusData);
router.post("/client/:clientId", isAuthenticated, resourceAccess.client(req => req.params.clientId), getProjectsByClient);
router.patch("/reorder", isAuthenticated, resourceAccess.reorder, reorderProjects as any);

// ==================== PROJECT TEMPLATE ROUTES ====================
router.get("/templates/all", isAuthenticated, resourceAccess.staff, getTemplates);
router.post("/templates/save-as", isAuthenticated, resourceAccess.project(req => req.body.projectId, "create"), saveProjectAsTemplate);
router.post("/templates/create", isAuthenticated, resourceAccess.action("create"), createProjectTemplate);
router.put("/templates/:id", isAuthenticated, resourceAccess.action("update"), updateProjectTemplate as any);
router.delete("/templates/:id", isAuthenticated, resourceAccess.action("delete"), deleteProjectTemplate as any);

// ==================== ORGANIZATION DATA ROUTES ====================
router.get("/clients/organization", isAuthenticated, resourceAccess.staff, getOrganizationClients);
router.get("/users/organization", isAuthenticated, resourceAccess.staff, getOrganizationUsers);

// ==================== PROJECT COMMENT ROUTES ====================
router.post("/comments", isAuthenticated, resourceAccess.action("comment"), resourceAccess.commentReferences, createProjectComment);
router.get("/comments/all", isAuthenticated, getAllOrgComments);          // org-wide, paginated — must be before /:projectId
router.get("/comments/:projectId", isAuthenticated, resourceAccess.project(req => req.params.projectId), getProjectComments);  // taskId optional via query
router.patch("/comments/:commentId", isAuthenticated, resourceAccess.comment(req => req.params.commentId), updateProjectComment);
router.delete("/comments/:commentId", isAuthenticated, resourceAccess.comment(req => req.params.commentId), deleteProjectComment);

// ==================== PROJECT EXPENSE ROUTES ====================
router.get("/:projectId/expenses", isAuthenticated, resourceAccess.financial, resourceAccess.project(req => req.params.projectId), getProjectExpenses);
router.post("/:projectId/expenses", isAuthenticated, resourceAccess.financial, resourceAccess.project(req => req.params.projectId, "update"), createProjectExpense as any);
router.delete("/:projectId/expenses/:expenseId", isAuthenticated, resourceAccess.financial, resourceAccess.project(req => req.params.projectId, "delete"), deleteProjectExpense as any);

// ==================== RISK ALERT ROUTES ====================
router.get("/risk-alerts", isAuthenticated, resourceAccess.financial, getProjectRiskAlerts as any);
router.delete("/risk-alerts/:id", isAuthenticated, resourceAccess.financial, dismissProjectRiskAlert as any);

// ==================== MILESTONE ROUTES ====================
router.get("/:projectId/milestones", isAuthenticated, resourceAccess.project(req => req.params.projectId), getMilestones);
router.post("/:projectId/milestones", isAuthenticated, resourceAccess.project(req => req.params.projectId, "create"), createMilestone);
router.patch("/:projectId/milestones/:id", isAuthenticated, resourceAccess.project(req => req.params.projectId, "update"), updateMilestone);
router.delete("/:projectId/milestones/:id", isAuthenticated, resourceAccess.project(req => req.params.projectId, "delete"), deleteMilestone);

// ==================== WILDCARD ROUTES (must be last) ====================
router.get("/:id", isAuthenticated, resourceAccess.project(req => req.params.id), getProjectById);
router.delete("/:id", isAuthenticated, resourceAccess.project(req => req.params.id, "delete"), deleteProject);

export default router;
