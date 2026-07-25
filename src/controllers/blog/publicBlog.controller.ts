import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { blogPosts, blogPostViews } from "@/schema/schema";
import { eq, desc, and, sql, ne } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import crypto from "crypto";

function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip + "flowlio-salt").digest("hex").slice(0, 16);
}

// GET /blog/posts — list published posts
export const listPublicPosts = async (req: Request, res: Response): Promise<void> => {
  try {
    const { category, page = "1", limit = "12", featured } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [eq(blogPosts.status, "published")];
    if (category) conditions.push(eq(blogPosts.category, category));
    if (featured === "true") conditions.push(eq(blogPosts.featured, true));

    const where = and(...conditions);

    const [posts, totalResult, categories, mostViewed] = await Promise.all([
      database
        .select({
          id: blogPosts.id,
          slug: blogPosts.slug,
          title: blogPosts.title,
          excerpt: blogPosts.excerpt,
          coverImage: blogPosts.coverImage,
          category: blogPosts.category,
          tags: blogPosts.tags,
          featured: blogPosts.featured,
          viewCount: blogPosts.viewCount,
          readingTimeMin: blogPosts.readingTimeMin,
          authorName: blogPosts.authorName,
          publishedAt: blogPosts.publishedAt,
          metaTitle: blogPosts.metaTitle,
          metaDescription: blogPosts.metaDescription,
          ogImage: blogPosts.ogImage,
        })
        .from(blogPosts)
        .where(where)
        .orderBy(desc(blogPosts.publishedAt))
        .limit(limitNum)
        .offset(offset),

      database
        .select({ count: sql<number>`count(*)::int` })
        .from(blogPosts)
        .where(where),

      database
        .select({ category: blogPosts.category, count: sql<number>`count(*)::int` })
        .from(blogPosts)
        .where(and(eq(blogPosts.status, "published"), ne(blogPosts.category, "")))
        .groupBy(blogPosts.category)
        .orderBy(desc(sql`count(*)`)),

      database
        .select({
          id: blogPosts.id,
          slug: blogPosts.slug,
          title: blogPosts.title,
          coverImage: blogPosts.coverImage,
          viewCount: blogPosts.viewCount,
          publishedAt: blogPosts.publishedAt,
          readingTimeMin: blogPosts.readingTimeMin,
        })
        .from(blogPosts)
        .where(eq(blogPosts.status, "published"))
        .orderBy(desc(blogPosts.viewCount))
        .limit(5),
    ]);

    res.status(200).json({
      success: true,
      data: posts,
      categories: categories.filter((c) => c.category),
      mostViewed,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalResult[0]?.count ?? 0,
        totalPages: Math.ceil((totalResult[0]?.count ?? 0) / limitNum),
      },
    });
  } catch (error) {
    logger.error("Error listing public posts:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// GET /blog/posts/:slug — single post + track view
export const getPublicPost = async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;

    const post = await database.query.blogPosts.findFirst({
      where: (p, { eq, and }) => and(eq(p.slug, slug), eq(p.status, "published")),
    });

    if (!post) {
      res.status(404).json({ success: false, message: "Post not found" });
      return;
    }

    // Track view (fire-and-forget — don't block response)
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";
    const referrer = (req.headers["referer"] || req.headers["referrer"] || "") as string;
    const userAgent = req.headers["user-agent"] || "";

    Promise.all([
      database.insert(blogPostViews).values({
        id: crypto.randomUUID().replace(/-/g, ""),
        postId: post.id,
        ipHash: hashIp(ip),
        referrer: referrer.slice(0, 500) || null,
        userAgent: userAgent.slice(0, 300) || null,
      }),
      database
        .update(blogPosts)
        .set({ viewCount: sql`${blogPosts.viewCount} + 1` })
        .where(eq(blogPosts.id, post.id)),
    ]).catch((err) => logger.error("Error tracking blog view:", err));

    // Related posts (same category, excluding current)
    const related = await database
      .select({
        id: blogPosts.id,
        slug: blogPosts.slug,
        title: blogPosts.title,
        excerpt: blogPosts.excerpt,
        coverImage: blogPosts.coverImage,
        publishedAt: blogPosts.publishedAt,
        readingTimeMin: blogPosts.readingTimeMin,
      })
      .from(blogPosts)
      .where(
        and(
          eq(blogPosts.status, "published"),
          eq(blogPosts.category, post.category || ""),
          ne(blogPosts.id, post.id),
        ),
      )
      .orderBy(desc(blogPosts.publishedAt))
      .limit(3);

    res.status(200).json({ success: true, data: post, related });
  } catch (error) {
    logger.error("Error fetching public post:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// GET /blog/sitemap — XML sitemap data for SEO
export const getBlogSitemap = async (_req: Request, res: Response): Promise<void> => {
  try {
    const posts = await database
      .select({ slug: blogPosts.slug, updatedAt: blogPosts.updatedAt, publishedAt: blogPosts.publishedAt })
      .from(blogPosts)
      .where(eq(blogPosts.status, "published"))
      .orderBy(desc(blogPosts.publishedAt));

    res.status(200).json({ success: true, data: posts });
  } catch (error) {
    logger.error("Error fetching blog sitemap:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
