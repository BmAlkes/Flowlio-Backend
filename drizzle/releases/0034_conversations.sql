CREATE TABLE "conversation_participants" (
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "conversation_participants_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_reads" (
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_reads_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"project_id" text,
	"task_id" text,
	"client_id" text,
	"created_by" text,
	"archived_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_kind_check" CHECK ("conversations"."kind" in ('channel','project','task','client','direct'))
);
--> statement-breakpoint
CREATE TABLE "message_reactions" (
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"author_id" text,
	"author_kind" text NOT NULL,
	"visibility" text NOT NULL,
	"body" text NOT NULL,
	"parent_id" text,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"task_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approval" jsonb,
	"source" text,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_kind_check" CHECK ("messages"."author_kind" in ('member','client','system') and "messages"."visibility" in ('internal','client'))
);
--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_participants_user_idx" ON "conversation_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversations_org_idx" ON "conversations" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_project_key" ON "conversations" USING btree ("project_id") WHERE "conversations"."kind"='project';--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_task_key" ON "conversations" USING btree ("task_id") WHERE "conversations"."kind"='task';--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_client_key" ON "conversations" USING btree ("client_id") WHERE "conversations"."kind"='client';--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_channel_name_key" ON "conversations" USING btree ("organization_id","name") WHERE "conversations"."kind"='channel';--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_parent_idx" ON "messages" USING btree ("parent_id");--> statement-breakpoint
-- Copy (never move) existing project/task comments and client messages into conversations.
-- The old tables stay untouched, so going back to the previous comments is always possible.
-- Old comments are copied as CLIENT-visible: before this, the client portal could already see them.
INSERT INTO conversations (id, organization_id, kind, project_id, created_at, last_message_at)
SELECT gen_random_uuid()::text, p.organization_id, 'project', p.id, min(c.created_at), max(c.created_at)
FROM project_comments c JOIN projects p ON p.id = c.project_id
WHERE c.task_id IS NULL
GROUP BY p.id, p.organization_id
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO conversations (id, organization_id, kind, project_id, task_id, created_at, last_message_at)
SELECT gen_random_uuid()::text, p.organization_id, 'task', p.id, t.id, min(c.created_at), max(c.created_at)
FROM project_comments c JOIN tasks t ON t.id = c.task_id JOIN projects p ON p.id = t.project_id
GROUP BY t.id, p.id, p.organization_id
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO messages (id, conversation_id, organization_id, author_id, author_kind, visibility, body, parent_id, source, created_at, edited_at)
SELECT c.id, cv.id, cv.organization_id, c.user_id, CASE WHEN u.role = 'client' THEN 'client' ELSE 'member' END, 'client', c.content, c.parent_id, 'project_comment',
       c.created_at, CASE WHEN c.updated_at > c.created_at + interval '1 second' THEN c.updated_at END
FROM project_comments c
JOIN conversations cv ON (cv.kind = 'project' AND cv.project_id = c.project_id AND c.task_id IS NULL) OR (cv.kind = 'task' AND cv.task_id = c.task_id)
LEFT JOIN users u ON u.id = c.user_id
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO conversations (id, organization_id, kind, client_id, created_at, last_message_at)
SELECT gen_random_uuid()::text, ci.organization_id, 'client', ci.client_id, min(ci.created_at), max(ci.created_at)
FROM client_interactions ci WHERE ci.type = 'note'
GROUP BY ci.organization_id, ci.client_id
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO messages (id, conversation_id, organization_id, author_id, author_kind, visibility, body, source, created_at)
SELECT ci.id, cv.id, ci.organization_id, ci.user_id, CASE WHEN u.role = 'client' THEN 'client' ELSE 'member' END, 'client', ci.content, 'client_interaction', ci.created_at
FROM client_interactions ci
JOIN conversations cv ON cv.kind = 'client' AND cv.client_id = ci.client_id
LEFT JOIN users u ON u.id = ci.user_id
WHERE ci.type = 'note'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO messages (id, conversation_id, organization_id, author_id, author_kind, visibility, body, parent_id, source, created_at)
SELECT r.id, cv.id, ci.organization_id, r.user_id, CASE WHEN u.role = 'client' THEN 'client' ELSE 'member' END, 'client', r.content, r.interaction_id, 'interaction_reply', r.created_at
FROM interaction_replies r
JOIN client_interactions ci ON ci.id = r.interaction_id AND ci.type = 'note'
JOIN conversations cv ON cv.kind = 'client' AND cv.client_id = ci.client_id
LEFT JOIN users u ON u.id = r.user_id
ON CONFLICT DO NOTHING;
