import { and,eq,exists,or,sql } from 'drizzle-orm';
import { database } from '../../configs/connection.config';
import { projects,tasks,timeEntries } from '../../schema/schema';
import { projectReadScope } from '../../security/resource-access';
import type { Actor } from '../../security/resource-policy';
export function aiTaskScope(a:Actor){return and(
 exists(database.select({id:projects.id}).from(projects).where(and(eq(projects.id,tasks.projectId),projectReadScope(a)))),
 or(eq(tasks.createdBy,a.id),eq(tasks.assignedTo,a.id),eq(tasks.visibility,'public'))
)!;}
export function aiTimeScope(a:Actor){return and(
 exists(database.select({id:projects.id}).from(projects).where(and(eq(projects.id,timeEntries.projectId),projectReadScope(a)))),
 or(sql`${timeEntries.taskId} is null`,exists(database.select({id:tasks.id}).from(tasks).where(and(eq(tasks.id,timeEntries.taskId),eq(tasks.projectId,timeEntries.projectId),aiTaskScope(a)))))
)!;}
