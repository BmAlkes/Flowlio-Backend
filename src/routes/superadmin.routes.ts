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
import { assignPlan } from "../controllers/super admin/organizations/assignPlan.controller";
import { overrideLimits } from "../controllers/super admin/organizations/overrideLimits.controller";
import {
  createPlanPaymentOrder,
  confirmPlanPayment,
} from "../controllers/super admin/invoices/planPayment.controller";
import { getSuperadminAILogs } from "../controllers/ai/aiLogs.controller";
import { getAllData } from "../controllers/super admin/organizations/getalldata.controller";
import { getTotalInvoices } from "../controllers/super admin/organizations/gettotalinvoices.controller";
import { getSuperadminOverview } from "../controllers/super admin/organizations/getoverview.controller";
import { getSubscriptionHistory } from "../controllers/super admin/organizations/getsubscriptionhistory.controller";
import { auditSubscriptions } from "../controllers/super admin/organizations/auditsubscriptions.controller";
import { reactivateSubscription } from "../controllers/super admin/organizations/reactivatesubscription.controller";
import { deactivateSubscription } from "../controllers/super admin/organizations/deactivatesubscription.controller";
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

router.get("/plans/public/getallplans", getPublicPlans as any);

router.get(
  "/organizations/:organizationId/details",
  isAuthenticated,
  requireSuperOrSubAdmin,
  getCompanyDetails as any,
);
router.get(
  "/organizations/:organizationId/subscription-history",
  isAuthenticated,
  requireSuperOrSubAdmin,
  getSubscriptionHistory as any,
);

router.get(
  "/subscriptions/audit",
  isAuthenticated,
  requireSuperAdmin,
  auditSubscriptions as any,
);
router.put(
  "/subscriptions/:subscriptionId/reactivate",
  isAuthenticated,
  requireSuperAdmin,
  reactivateSubscription as any,
);
router.put(
  "/subscriptions/:subscriptionId/deactivate",
  isAuthenticated,
  requireSuperAdmin,
  deactivateSubscription as any,
);
router.get(
  "/all-data",
  isAuthenticated,
  requireSuperOrSubAdmin,
  getAllData as any,
);
router.get(
  "/total-invoices",
  isAuthenticated,
  requireSuperAdmin,
  getTotalInvoices as any,
);
router.get(
  "/overview",
  isAuthenticated,
  requireSuperOrSubAdmin,
  getSuperadminOverview,
);
router.delete(
  "/organizations/:organizationId",
  isAuthenticated,
  requireSuperAdmin,
  deleteOrganization as any,
);
router.put(
  "/organizations/:orgId/assign-plan",
  isAuthenticated,
  requireSuperAdmin,
  assignPlan as any,
);
router.put(
  "/organizations/:orgId/override-limits",
  isAuthenticated,
  requireSuperOrSubAdmin,
  overrideLimits as any,
);

// On-demand plan payment via PayPal (one-time order, not recurring subscription)
router.post(
  "/invoices/plan-payment",
  isAuthenticated,
  requireSuperAdmin,
  createPlanPaymentOrder as any,
);
// Public confirm endpoint — validated by orderId/orgId/planId, no auth required
router.post("/invoices/plan-payment/confirm", confirmPlanPayment as any);

// AI audit logs with filtering, pagination and summary
router.get("/ai/logs", isAuthenticated, requireSuperAdmin, getSuperadminAILogs as any);

// DEMO ACCOUNT ROUTES - require super admin role
router.post(
  "/demo-accounts",
  isAuthenticated,
  requireSuperAdmin,
  createDemoAccount,
);
router.get(
  "/demo-accounts",
  isAuthenticated,
  requireSuperAdmin,
  listDemoAccounts,
);
router.post(
  "/demo-accounts/:organizationId/deactivate",
  isAuthenticated,
  requireSuperAdmin,
  deactivateDemoAccount,
);
router.put(
  "/demo-accounts/:organizationId",
  isAuthenticated,
  requireSuperAdmin,
  updateDemoAccount,
);

// SUB ADMIN ROUTES - require super admin role
router.post("/create-subadmin", isAuthenticated, requireSuperAdmin as any, createSubAdmin as any);
router.get("/fetch-subadmins", isAuthenticated, requireSuperAdmin as any, fetchSubAdmins);
router.put("/update-subadmin/:id", isAuthenticated, requireSuperAdmin as any, updateSubAdmin as any);
router.put(
  "/update-subadmin-permission/:id",
  isAuthenticated,
  requireSuperAdmin as any,
  updateSubAdminPermission as any,
);
router.delete("/delete-subadmin/:id", isAuthenticated, requireSuperAdmin as any, deleteSubAdmin);

router.use("/plans", isAuthenticated, plansRoutes);

router.put(
  "/updatesuperadmin-password",
  isAuthenticated,
  requireSuperAdmin as any,
  updateSuperAdminPassword as any,
);

router.get(
  "/newsletter/subscribers",
  isAuthenticated,
  requireSuperAdmin,
  getNewsletterSubscribers as any,
);
router.get(
  "/newsletter/stats",
  isAuthenticated,
  requireSuperAdmin,
  getNewsletterStats as any,
);
router.delete(
  "/newsletter/subscribers/:id",
  isAuthenticated,
  requireSuperAdmin,
  deleteNewsletterSubscriber as any,
);
router.post(
  "/newsletter/send",
  isAuthenticated,
  requireSuperAdmin,
  sendNewsletter,
);

router.get("/users", isAuthenticated, requireSuperAdmin, getAllUsers);
router.delete("/users/:userId", isAuthenticated, requireSuperAdmin, deleteUser);

import { checkPayPalConfig } from "../controllers/super admin/paypal/checkpaypalconfig.controller";
router.get(
  "/paypal/config",
  isAuthenticated,
  requireSuperAdmin,
  checkPayPalConfig,
);

export default router;
