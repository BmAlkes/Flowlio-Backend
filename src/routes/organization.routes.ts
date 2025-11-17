import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import {
  createOrganizationWithPlan,
  getUserOrganizations,
  getUserSubscriptions,
} from "../controllers/user/organization.controller";
import { getAllOrganizations } from "../controllers/user/getallorganizations.controller";
import { createUserMember } from "../controllers/organization/user-management/createusermember.controller";
import {
  getAllUserMembers,
  getCurrentOrgUserMembers,
} from "../controllers/organization/user-management/getusermemeber.controller";
import {
  deleteUserMember,
  deactivateUserMember,
  reactivateUserMember,
} from "../controllers/organization/user-management/deleteusermember.controller";
import { testUserMembers } from "../controllers/organization/user-management/test-usermembers.controller";
import { getOrganizationTotalClients } from "../controllers/organization/stats/gettotalclients.controller";
import { getOrganizationActiveProjects } from "../controllers/organization/stats/getactiveprojects.controller";
import { getOrganizationHoursTracked } from "../controllers/organization/stats/gethourstracked.controller";
import { getOrganizationPendingTasks } from "../controllers/organization/stats/getpendingtasks.controller";
import { getOrganizationWeeklyHoursTracked } from "../controllers/organization/stats/getweeklyhourstracked.controller";
import { getOrganizationActivities } from "../controllers/organization/activities/getorganizationactivities.controller";
import { deleteActivity } from "../controllers/organization/activities/deleteactivity.controller";
import {
  checkCanCreateUser,
  checkCanCreateProject,
  checkFeatureAccess,
} from "../controllers/organization/plan-access/checkplanaccess.controller";

const router = Router();

// ==================== ORGANIZATION ROUTES ====================
router.post("/create-with-plan", createOrganizationWithPlan as any);
router.get("/user-organizations", isAuthenticated, getUserOrganizations as any);
router.get("/user-subscriptions", isAuthenticated, getUserSubscriptions as any);
router.get("/all-organizations", isAuthenticated, getAllOrganizations as any);

// ==================== USER MANAGEMENT ROUTES ====================
// Temporarily simplified to isolate middleware issue
router.post("/create-user-member", isAuthenticated, createUserMember as any);
router.get("/user-members", isAuthenticated, getAllUserMembers as any);
router.get(
  "/current-org-user-members",
  isAuthenticated,
  getCurrentOrgUserMembers as any
);
router.delete("/user-members/:id", isAuthenticated, deleteUserMember as any);
router.patch(
  "/user-members/:id/deactivate",
  isAuthenticated,
  deactivateUserMember as any
);
router.patch(
  "/user-members/:id/reactivate",
  isAuthenticated,
  reactivateUserMember as any
);

// Test endpoint for debugging user members
router.get("/test-user-members", isAuthenticated, testUserMembers as any);

// ==================== ORGANIZATION STATS ROUTES ====================
router.get(
  "/stats/total-clients",
  isAuthenticated,
  getOrganizationTotalClients
);
router.get(
  "/stats/active-projects",
  isAuthenticated,
  getOrganizationActiveProjects
);
router.get(
  "/stats/hours-tracked",
  isAuthenticated,
  getOrganizationHoursTracked
);
router.get(
  "/stats/pending-tasks",
  isAuthenticated,
  getOrganizationPendingTasks
);
router.get(
  "/stats/weekly-hours-tracked",
  isAuthenticated,
  getOrganizationWeeklyHoursTracked
);

// ==================== ORGANIZATION ACTIVITIES ROUTE ====================
router.get("/activities", isAuthenticated, getOrganizationActivities);
router.delete("/activities/:id", isAuthenticated, deleteActivity);

// ==================== PLAN ACCESS ROUTES ====================
router.get("/plan-access/can-create-user", isAuthenticated, checkCanCreateUser);
router.get(
  "/plan-access/can-create-project",
  isAuthenticated,
  checkCanCreateProject
);
router.get(
  "/plan-access/feature/:featureName",
  isAuthenticated,
  checkFeatureAccess
);

export default router;
