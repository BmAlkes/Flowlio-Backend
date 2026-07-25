import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { blogPosts, blogPostViews } from "@/schema/schema";
import { eq, desc, ilike, and, sql, gte } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import crypto from "crypto";

function estimateReadingTime(content: string): number {
  const words = content.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

// GET /api/superadmin/blog/posts
export const listBlogPosts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, category, search, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (status) conditions.push(eq(blogPosts.status, status as any));
    if (category) conditions.push(eq(blogPosts.category, category));
    if (search) conditions.push(ilike(blogPosts.title, `%${search}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [posts, totalResult] = await Promise.all([
      database
        .select({
          id: blogPosts.id,
          slug: blogPosts.slug,
          title: blogPosts.title,
          excerpt: blogPosts.excerpt,
          coverImage: blogPosts.coverImage,
          status: blogPosts.status,
          category: blogPosts.category,
          tags: blogPosts.tags,
          featured: blogPosts.featured,
          viewCount: blogPosts.viewCount,
          readingTimeMin: blogPosts.readingTimeMin,
          authorName: blogPosts.authorName,
          publishedAt: blogPosts.publishedAt,
          createdAt: blogPosts.createdAt,
          updatedAt: blogPosts.updatedAt,
        })
        .from(blogPosts)
        .where(where)
        .orderBy(desc(blogPosts.updatedAt))
        .limit(limitNum)
        .offset(offset),
      database
        .select({ count: sql<number>`count(*)::int` })
        .from(blogPosts)
        .where(where),
    ]);

    res.status(200).json({
      success: true,
      data: posts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalResult[0]?.count ?? 0,
        totalPages: Math.ceil((totalResult[0]?.count ?? 0) / limitNum),
      },
    });
  } catch (error) {
    logger.error("Error listing blog posts:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// GET /api/superadmin/blog/posts/:id
export const getBlogPost = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const post = await database.query.blogPosts.findFirst({
      where: (p, { eq }) => eq(p.id, id),
    });
    if (!post) {
      res.status(404).json({ success: false, message: "Post not found" });
      return;
    }
    res.status(200).json({ success: true, data: post });
  } catch (error) {
    logger.error("Error fetching blog post:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// POST /api/superadmin/blog/posts
export const createBlogPost = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      title, excerpt, content, coverImage, category, tags,
      metaTitle, metaDescription, metaKeywords, canonicalUrl,
      ogImage, schemaMarkup, faq, featured, status,
    } = req.body;

    if (!title) {
      res.status(400).json({ success: false, message: "title is required" });
      return;
    }

    const user = (req as any).user;
    const baseSlug = generateSlug(title);
    // Ensure unique slug
    const existing = await database
      .select({ slug: blogPosts.slug })
      .from(blogPosts)
      .where(ilike(blogPosts.slug, `${baseSlug}%`));
    const slug = existing.length === 0 ? baseSlug : `${baseSlug}-${existing.length}`;

    const postStatus: "draft" | "published" = status === "published" ? "published" : "draft";
    const now = new Date();

    const [created] = await database.insert(blogPosts).values({
      id: crypto.randomUUID().replace(/-/g, ""),
      slug,
      title,
      excerpt: excerpt || null,
      content: content || "",
      coverImage: coverImage || null,
      authorId: user?.id || null,
      authorName: user?.name || null,
      status: postStatus,
      category: category || null,
      tags: Array.isArray(tags) ? tags : [],
      metaTitle: metaTitle || null,
      metaDescription: metaDescription || null,
      metaKeywords: metaKeywords || null,
      canonicalUrl: canonicalUrl || null,
      ogImage: ogImage || null,
      schemaMarkup: schemaMarkup || null,
      faq: faq || null,
      featured: Boolean(featured),
      readingTimeMin: content ? estimateReadingTime(content) : null,
      publishedAt: postStatus === "published" ? now : null,
      createdAt: now,
      updatedAt: now,
    }).returning();

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    logger.error("Error creating blog post:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// PUT /api/superadmin/blog/posts/:id
export const updateBlogPost = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await database.query.blogPosts.findFirst({
      where: (p, { eq }) => eq(p.id, id),
    });
    if (!existing) {
      res.status(404).json({ success: false, message: "Post not found" });
      return;
    }

    const {
      title, slug, excerpt, content, coverImage, category, tags,
      metaTitle, metaDescription, metaKeywords, canonicalUrl,
      ogImage, schemaMarkup, faq, featured, status,
    } = req.body;

    const wasPublished = existing.status === "published";
    const nowPublishing = status === "published" && !wasPublished;

    const [updated] = await database
      .update(blogPosts)
      .set({
        ...(title !== undefined && { title }),
        ...(slug !== undefined && { slug }),
        ...(excerpt !== undefined && { excerpt }),
        ...(content !== undefined && {
          content,
          readingTimeMin: estimateReadingTime(content),
        }),
        ...(coverImage !== undefined && { coverImage }),
        ...(category !== undefined && { category }),
        ...(tags !== undefined && { tags }),
        ...(metaTitle !== undefined && { metaTitle }),
        ...(metaDescription !== undefined && { metaDescription }),
        ...(metaKeywords !== undefined && { metaKeywords }),
        ...(canonicalUrl !== undefined && { canonicalUrl }),
        ...(ogImage !== undefined && { ogImage }),
        ...(schemaMarkup !== undefined && { schemaMarkup }),
        ...(faq !== undefined && { faq }),
        ...(featured !== undefined && { featured: Boolean(featured) }),
        ...(status !== undefined && { status }),
        ...(nowPublishing && { publishedAt: new Date() }),
        updatedAt: new Date(),
      })
      .where(eq(blogPosts.id, id))
      .returning();

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    logger.error("Error updating blog post:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// DELETE /api/superadmin/blog/posts/:id
export const deleteBlogPost = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await database.delete(blogPosts).where(eq(blogPosts.id, id)).returning();
    if (!deleted.length) {
      res.status(404).json({ success: false, message: "Post not found" });
      return;
    }
    res.status(200).json({ success: true, message: "Post deleted" });
  } catch (error) {
    logger.error("Error deleting blog post:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// GET /api/superadmin/blog/posts/:id/analytics
export const getBlogPostAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { days = "30" } = req.query as Record<string, string>;
    const since = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);

    const post = await database.query.blogPosts.findFirst({
      where: (p, { eq }) => eq(p.id, id),
      columns: { id: true, title: true, viewCount: true, publishedAt: true },
    });
    if (!post) {
      res.status(404).json({ success: false, message: "Post not found" });
      return;
    }

    const [viewsInPeriod, viewsByDay, topReferrers] = await Promise.all([
      database
        .select({ count: sql<number>`count(*)::int` })
        .from(blogPostViews)
        .where(and(eq(blogPostViews.postId, id), gte(blogPostViews.createdAt, since))),

      database
        .select({
          date: sql<string>`date_trunc('day', created_at)::date::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(blogPostViews)
        .where(and(eq(blogPostViews.postId, id), gte(blogPostViews.createdAt, since)))
        .groupBy(sql`date_trunc('day', created_at)`)
        .orderBy(sql`date_trunc('day', created_at)`),

      database
        .select({
          referrer: blogPostViews.referrer,
          count: sql<number>`count(*)::int`,
        })
        .from(blogPostViews)
        .where(and(eq(blogPostViews.postId, id), gte(blogPostViews.createdAt, since)))
        .groupBy(blogPostViews.referrer)
        .orderBy(desc(sql`count(*)`))
        .limit(10),
    ]);

    res.status(200).json({
      success: true,
      data: {
        post,
        period: { days: parseInt(days), since: since.toISOString() },
        viewsInPeriod: viewsInPeriod[0]?.count ?? 0,
        viewsByDay,
        topReferrers,
      },
    });
  } catch (error) {
    logger.error("Error fetching blog analytics:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// GET /api/superadmin/blog/stats
export const getBlogStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [counts, topPosts] = await Promise.all([
      database
        .select({
          status: blogPosts.status,
          count: sql<number>`count(*)::int`,
          totalViews: sql<number>`sum(view_count)::int`,
        })
        .from(blogPosts)
        .groupBy(blogPosts.status),

      database
        .select({
          id: blogPosts.id,
          title: blogPosts.title,
          slug: blogPosts.slug,
          viewCount: blogPosts.viewCount,
          publishedAt: blogPosts.publishedAt,
        })
        .from(blogPosts)
        .where(eq(blogPosts.status, "published"))
        .orderBy(desc(blogPosts.viewCount))
        .limit(5),
    ]);

    res.status(200).json({ success: true, data: { counts, topPosts } });
  } catch (error) {
    logger.error("Error fetching blog stats:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
