import { createHash } from "node:crypto";
import { sendTransactionalEmail as deliver } from "../email/transactional.service";
import { jobContext } from "./context";
import { enqueue } from "./queue";
// Automation state and the outbound email commit together. Delivery runs afterwards.
export const sendTransactionalEmail: typeof deliver = async (params) => {
    const context = jobContext.getStore();
    if (!context)
        return deliver(params);
    const key = createHash("sha256").update(context.job.id + JSON.stringify(params)).digest("hex");
    await enqueue(context.client, "email-delivery", key, { ...params, automationRunId: context.job.id });
    return { success: true, to: params.to };
};
