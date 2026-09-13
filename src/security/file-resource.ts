import { and, eq, sql } from "drizzle-orm";
import { database } from "@/configs/connection.config";
import { files, projects, tasks } from "@/schema/schema";

export async function findFileResource(id: string, organizationId: string) {
  const file = await database.query.files.findFirst({
    where: and(eq(files.id, id), eq(files.organizationId, organizationId)),
  });
  if (file) return file;
  const [legacyTask] = await database
    .select({ task: tasks, project: projects })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        sql`exists (select 1 from jsonb_array_elements(coalesce(${tasks.attachments}::jsonb, '[]'::jsonb)) attachment where attachment->>'id' = ${id})`,
      ),
    )
    .limit(1);
  if (legacyTask)
    return {
      organizationId,
      projectId: legacyTask.project.id,
      taskId: legacyTask.task.id,
      clientId: legacyTask.project.clientId,
      uploadedBy: legacyTask.task.createdBy,
    };
  const [project] = await database
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, organizationId),
        sql`(
    ${projects.projectFiles}::jsonb->'projectPdf'->>'publicId' = ${id}
    or ${projects.projectFiles}::jsonb->'projectPdf'->>'url' = ${id}
    or ${projects.contractfilePublicId} = ${id}
    or ('proj_' || ${projects.id} || '_pdf' = ${id} and ${projects.projectFiles}::jsonb->'projectPdf' is not null)
    or ('proj_' || ${projects.id} || '_contract' = ${id} and ${projects.contractfile} is not null)
    or ('contract-' || ${projects.id} = ${id} and ${projects.contractfile} is not null)
  )`,
      ),
    )
    .limit(1);
  return project
    ? {
        organizationId,
        projectId: project.id,
        clientId: project.clientId,
        uploadedBy: project.createdBy,
      }
    : undefined;
}
