import { Router, type RequestHandler } from 'express';
import { ZodError } from 'zod';
import { connection } from '../../configs/connection.config';
import { isAuthenticated } from '../../middlewares/auth.middleware';
import { createPortalInvitations, PortalInvitationError } from './service';
import { logger } from '../../utils/logger.util';
const service = createPortalInvitations(connection, async password => {
  const {auth} = await import('../../lib/auth');
  return (await auth.$context).password.hash(password);
});
const handle = (action: 'status'|'issue'|'revoke'|'accept'): RequestHandler => async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  try {
    const clientId = String(req.params.clientId ?? '');
    const data = action === 'accept' ? await service.accept(req.body)
      : action === 'issue' ? await service.issue(req.user!,clientId,req.body)
      : action === 'revoke' ? await service.revoke(req.user!,clientId) : await service.status(req.user!,clientId);
    res.json({success:true,data});
  } catch(error) {
    if(error instanceof PortalInvitationError){res.status(error.status).json({success:false,code:error.code});return;}
    if(error instanceof ZodError){res.status(400).json({success:false,code:'INVALID_INPUT'});return;}
    // Never log tokens, passwords or request bodies.
    logger.error({action},'Portal invitation operation failed');res.status(500).json({success:false,code:'INVITATION_FAILED'});
  }
};
export const portalInvitationRoutes = Router();
portalInvitationRoutes.post('/accept',handle('accept'));
portalInvitationRoutes.get('/:clientId',isAuthenticated,handle('status'));
portalInvitationRoutes.post('/:clientId',isAuthenticated,handle('issue'));
portalInvitationRoutes.delete('/:clientId',isAuthenticated,handle('revoke'));
