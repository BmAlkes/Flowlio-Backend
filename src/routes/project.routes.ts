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
import { getProjectScheduleData } from "../controllers/organization/projects/getprojectscheduledata.controller";
import { getProjectStatusData } from "../controllers/organization/projects/getprojectstatusdata.controller";

const router = Router();

// ==================== PROJECT ROUTES ====================
router.post("/create", isAuthenticated, createProject as any);
router.put("/update/:id", isAuthenticated, updateProject as any);
router.get("/all", isAuthenticated, getAllProjects);
router.get("/schedule-data", isAuthenticated, getProjectScheduleData);
router.get("/status-data", isAuthenticated, getProjectStatusData);
router.get("/client/:clientId", isAuthenticated, getProjectsByClient);
router.get("/:id", isAuthenticated, getProjectById);
router.delete("/:id", isAuthenticated, deleteProject);

// ==================== ORGANIZATION DATA ROUTES ====================
router.get("/clients/organization", isAuthenticated, getOrganizationClients);
router.get("/users/organization", isAuthenticated, getOrganizationUsers);

// ==================== PROJECT COMMENT ROUTES ====================
router.post("/comments", isAuthenticated, createProjectComment);
router.get("/comments/:projectId", isAuthenticated, getProjectComments);
router.delete("/comments/:commentId", isAuthenticated, deleteProjectComment);

export default router;
