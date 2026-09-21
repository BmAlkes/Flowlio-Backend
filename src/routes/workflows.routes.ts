import { Router, type RequestHandler } from "express";
import { connection } from "../configs/connection.config";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "../middlewares/role.middleware";
import { createWorkflows, WorkflowError } from "../modules/workflows/service";
import { logger } from "../utils/logger.util";
const service = createWorkflows(connection), router = Router();
const handler = (action: 'list' | 'create' | 'state' | 'history' | 'simulate'): RequestHandler => async (req, res) => {
  try {
    const actor = req.user!, id = String(req.params.id);
    const data = action === 'list' ? await service.list(actor) : action === 'create' ? await service.create(actor, req.body)
      : action === 'state' ? await service.setEnabled(actor, id, req.body) : await service.inspect(actor, id, action === 'simulate');
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof WorkflowError) { res.status(error.status).json({ success: false, code: error.code }); return; }
    logger.error({ error }, 'Workflow request failed'); res.status(500).json({ success: false, code: 'WORKFLOW_FAILED' });
  }
};
router.use(isAuthenticated, requireOrgOwnerAccess);
router.get('/', handler('list')); router.post('/', handler('create'));
router.patch('/:id', handler('state')); router.get('/:id/history', handler('history')); router.get('/:id/simulate', handler('simulate'));
export default router;
