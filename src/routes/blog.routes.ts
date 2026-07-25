import { Router } from "express";
import { listPublicPosts, getPublicPost, getBlogSitemap } from "@/controllers/blog/publicBlog.controller";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requireSuperOrSubAdmin } from "@/middlewares/role.middleware";
import {
  listBlogPosts,
  getBlogPost,
  createBlogPost,
  updateBlogPost,
  deleteBlogPost,
  getBlogPostAnalytics,
  getBlogStats,
} from "@/controllers/blog/adminBlog.controller";

const router = Router();

// ── Public routes (no auth) ───────────────────────────────────────────────────
router.get("/posts",          listPublicPosts);
router.get("/posts/:slug",    getPublicPost);
router.get("/sitemap",        getBlogSitemap);

// ── Admin routes ──────────────────────────────────────────────────────────────
router.get(    "/admin/stats",            isAuthenticated, requireSuperOrSubAdmin, getBlogStats);
router.get(    "/admin/posts",            isAuthenticated, requireSuperOrSubAdmin, listBlogPosts);
router.get(    "/admin/posts/:id",        isAuthenticated, requireSuperOrSubAdmin, getBlogPost);
router.post(   "/admin/posts",            isAuthenticated, requireSuperOrSubAdmin, createBlogPost);
router.put(    "/admin/posts/:id",        isAuthenticated, requireSuperOrSubAdmin, updateBlogPost);
router.delete( "/admin/posts/:id",        isAuthenticated, requireSuperOrSubAdmin, deleteBlogPost);
router.get(    "/admin/posts/:id/analytics", isAuthenticated, requireSuperOrSubAdmin, getBlogPostAnalytics);

export default router;
