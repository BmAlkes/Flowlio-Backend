import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import {
  requireSuperAdmin,
  requireSuperOrSubAdmin,
} from "../middlewares/role.middleware";
import { createSubAdmin } from "../controllers/super admin/sub admin/createsubadmin.controller";
import { fetchSubAdmins } from "../controllers/super admin/sub admin/fetchsubadmin.controller";
import { deleteSubAdmin } from "../controllers/super admin/sub admin/deletesubadmin.controller";
import {
  updateSubAdmin,
  updateSubAdminPermission,
} from "../controllers/super admin/sub admin/updatesubadmin.controller";
import plansRoutes from "./plans.routes";
import { updateSuperAdminPassword } from "../controllers/super admin/sub admin settings/updatesuperadminpassword.controller";
import { getPublicPlans } from "../controllers/super admin/plans";
import { deleteOrganization } from "../controllers/super admin/organizations/deleteorganization.controller";
import { getCompanyDetails } from "../controllers/super admin/organizations/getcompanydetails.controller";
import { getAllData } from "../controllers/super admin/organizations/getalldata.controller";
import { getTotalInvoices } from "../controllers/super admin/organizations/gettotalinvoices.controller";
import { getSuperadminOverview } from "../controllers/super admin/organizations/getoverview.controller";
import { getSubscriptionHistory } from "../controllers/super admin/organizations/getsubscriptionhistory.controller";
import { createDemoAccount } from "../controllers/super admin/demo/createDemoAccount.controller";
import { deactivateDemoAccount } from "../controllers/super admin/demo/deactivateDemoAccount.controller";
import { listDemoAccounts } from "../controllers/super admin/demo/listDemoAccounts.controller";
import { updateDemoAccount } from "../controllers/super admin/demo/updateDemoAccount.controller";
import {
  getNewsletterSubscribers,
  deleteNewsletterSubscriber,
  getNewsletterStats,
} from "../controllers/super admin/newsletter/getnewslettersubscribers.controller";
import { sendNewsletter } from "../controllers/super admin/newsletter/sendnewsletter.controller";
import { getAllUsers } from "../controllers/super admin/users/getallusers.controller";
import { deleteUser } from "../controllers/super admin/users/deleteuser.controller";

const router = Router();

// PUBLIC ROUTES (No Authentication Required)
router.get("/plans/public/getallplans", getPublicPlans as any);

// ORGANIZATION MANAGEMENT ROUTES - require super admin or sub admin role
router.get(
  "/organizations/:organizationId/details",
  isAuthenticated,
  requireSuperOrSubAdmin,
  getCompanyDetails as any
);
router.get(
  "/organizations/:organizationId/subscription-history",
  isAuthenticated,
  requireSuperOrSubAdmin,
  getSubscriptionHistory as any
);
router.get(
  "/all-data",
  isAuthenticated,
  requireSuperOrSubAdmin,
  getAllData as any
);
router.get(
  "/total-invoices",
  isAuthenticated,
  requireSuperAdmin,
  getTotalInvoices as any
);
router.get(
  "/overview",
  isAuthenticated,
  requireSuperOrSubAdmin,
  getSuperadminOverview
);
router.delete(
  "/organizations/:organizationId",
  isAuthenticated,
  requireSuperAdmin,
  deleteOrganization as any
);

// DEMO ACCOUNT ROUTES - require super admin role
router.post(
  "/demo-accounts",
  isAuthenticated,
  requireSuperAdmin,
  createDemoAccount
);
router.get(
  "/demo-accounts",
  isAuthenticated,
  requireSuperAdmin,
  listDemoAccounts
);
router.post(
  "/demo-accounts/:organizationId/deactivate",
  isAuthenticated,
  requireSuperAdmin,
  deactivateDemoAccount
);
router.put(
  "/demo-accounts/:organizationId",
  isAuthenticated,
  requireSuperAdmin,
  updateDemoAccount
);

// SUB ADMIN ROUTES - require sub admin role
router.post("/create-subadmin", isAuthenticated, createSubAdmin as any);
router.get("/fetch-subadmins", isAuthenticated, fetchSubAdmins);
router.put("/update-subadmin/:id", isAuthenticated, updateSubAdmin as any);
router.put(
  "/update-subadmin-permission/:id",
  isAuthenticated,
  updateSubAdminPermission as any
);
router.delete("/delete-subadmin/:id", isAuthenticated, deleteSubAdmin);

// SUBSCRIPTION PLANS ROUTES - require super admin role
router.use("/plans", isAuthenticated, plansRoutes);

// SuperAdmin Settings ROUTES - require super admin role
router.put(
  "/updatesuperadmin-password",
  isAuthenticated,
  requireSuperAdmin as any,
  updateSuperAdminPassword as any
);

// NEWSLETTER MANAGEMENT ROUTES - require super admin role
router.get(
  "/newsletter/subscribers",
  isAuthenticated,
  requireSuperAdmin,
  getNewsletterSubscribers as any
);
router.get(
  "/newsletter/stats",
  isAuthenticated,
  requireSuperAdmin,
  getNewsletterStats as any
);
router.delete(
  "/newsletter/subscribers/:id",
  isAuthenticated,
  requireSuperAdmin,
  deleteNewsletterSubscriber as any
);
router.post(
  "/newsletter/send",
  isAuthenticated,
  requireSuperAdmin,
  sendNewsletter
);

// USERS MANAGEMENT ROUTES - require super admin role
router.get("/users", isAuthenticated, requireSuperAdmin, getAllUsers);
router.delete("/users/:userId", isAuthenticated, requireSuperAdmin, deleteUser);

export default router;
