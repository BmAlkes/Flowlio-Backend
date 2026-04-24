import { database } from "./src/configs/connection.config";
import { projectTemplates, projectTemplateTasks } from "./src/schema/schema";
import { randomUUID } from "crypto";

async function seedTemplates() {
  console.log("🌱 Seeding default project templates...");

  const templates = [
    {
      id: randomUUID(),
      name: "Software Development",
      description: "Standard agile workflow for software projects",
      isGlobal: true,
      tasks: [
        { title: "Requirement Analysis", description: "Analyze user requirements and technical specs", order: 0 },
        { title: "System Design", description: "Architecture and database design", order: 1 },
        { title: "Frontend Development", description: "UI and client-side logic", order: 2 },
        { title: "Backend Development", description: "API and server-side logic", order: 3 },
        { title: "Testing & QA", description: "Unit, integration, and user acceptance testing", order: 4 },
        { title: "Deployment", description: "Production environment setup and release", order: 5 },
      ]
    },
    {
      id: randomUUID(),
      name: "Marketing Campaign",
      description: "Standard steps for launching a marketing campaign",
      isGlobal: true,
      tasks: [
        { title: "Market Research", description: "Identify target audience and competitors", order: 0 },
        { title: "Strategy Definition", description: "Define goals and key messages", order: 1 },
        { title: "Content Creation", description: "Write copy and design visuals", order: 2 },
        { title: "Channel Setup", description: "Configure social media and ads", order: 3 },
        { title: "Launch", description: "Go live with the campaign", order: 4 },
        { title: "Analytics & Reporting", description: "Track performance and ROI", order: 5 },
      ]
    },
    {
      id: randomUUID(),
      name: "SEO Optimization",
      description: "Workflow for improving search engine rankings",
      isGlobal: true,
      tasks: [
        { title: "SEO Audit", description: "Technical audit of the website", order: 0 },
        { title: "Keyword Research", description: "Identify target keywords", order: 1 },
        { title: "On-Page Optimization", description: "Update meta tags and content", order: 2 },
        { title: "Backlink Building", description: "Acquire high-quality backlinks", order: 3 },
        { title: "Performance Tracking", description: "Monitor rankings and traffic", order: 4 },
      ]
    }
  ];

  for (const t of templates) {
    await database.insert(projectTemplates).values({
      id: t.id,
      name: t.name,
      description: t.description,
      isGlobal: true,
    });

    const taskValues = t.tasks.map(task => ({
      id: randomUUID(),
      templateId: t.id,
      title: task.title,
      description: task.description,
      order: task.order
    }));

    await database.insert(projectTemplateTasks).values(taskValues);
    console.log(`✅ Seeded template: ${t.name}`);
  }

  console.log("✨ Seeding completed!");
  process.exit(0);
}

seedTemplates().catch(err => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
