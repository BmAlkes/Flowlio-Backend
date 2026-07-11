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

const router = Router();

// ==================== PROJECT ROUTES ====================
router.post("/create", isAuthenticated, createProject as any);
router.put("/update/:id", isAuthenticated, updateProject as any);
router.get("/all", isAuthenticated, getAllProjects);
router.get("/schedule-data", isAuthenticated, getProjectScheduleData);
router.get("/status-data", isAuthenticated, getProjectStatusData);
router.post("/client/:clientId", isAuthenticated, getProjectsByClient);
router.patch("/reorder", isAuthenticated, reorderProjects as any);

// ==================== PROJECT TEMPLATE ROUTES ====================
router.get("/templates/all", isAuthenticated, getTemplates);
router.post("/templates/save-as", isAuthenticated, saveProjectAsTemplate);
router.post("/templates/create", isAuthenticated, createProjectTemplate);
router.put("/templates/:id", isAuthenticated, updateProjectTemplate as any);
router.delete("/templates/:id", isAuthenticated, deleteProjectTemplate as any);

// ==================== ORGANIZATION DATA ROUTES ====================
router.get("/clients/organization", isAuthenticated, getOrganizationClients);
router.get("/users/organization", isAuthenticated, getOrganizationUsers);

// ==================== PROJECT COMMENT ROUTES ====================
router.post("/comments", isAuthenticated, createProjectComment);
router.get("/comments/all", isAuthenticated, getAllOrgComments);          // org-wide, paginated — must be before /:projectId
router.get("/comments/:projectId", isAuthenticated, getProjectComments);  // taskId optional via query
router.patch("/comments/:commentId", isAuthenticated, updateProjectComment);
router.delete("/comments/:commentId", isAuthenticated, deleteProjectComment);

// ==================== PROJECT EXPENSE ROUTES ====================
router.get("/:projectId/expenses", isAuthenticated, getProjectExpenses);
router.post("/:projectId/expenses", isAuthenticated, createProjectExpense as any);
router.delete("/:projectId/expenses/:expenseId", isAuthenticated, deleteProjectExpense as any);

// ==================== RISK ALERT ROUTES ====================
router.get("/risk-alerts", isAuthenticated, getProjectRiskAlerts as any);
router.delete("/risk-alerts/:id", isAuthenticated, dismissProjectRiskAlert as any);

// ==================== WILDCARD ROUTES (must be last) ====================
router.get("/:id", isAuthenticated, getProjectById);
router.delete("/:id", isAuthenticated, deleteProject);

export default router;
