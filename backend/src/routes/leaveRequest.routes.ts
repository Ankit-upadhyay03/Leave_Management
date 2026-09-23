import { Router, Response, NextFunction } from 'express';
import { authenticate, authorize, verifyAccountStatus, AuthRequest } from '../middleware/auth';
import { LeaveRequestService } from '../services/leaveRequest.service';

export const leaveRequestRouter = Router();
leaveRequestRouter.use(authenticate, verifyAccountStatus);

leaveRequestRouter.post('/', authorize('Employee', 'Manager'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { leave_type_id, from_date, to_date, is_half_day, reason } = req.body;
    const request = await LeaveRequestService.submit({
      employee_id: req.user!.userId,
      leave_type_id,
      from_date,
      to_date,
      is_half_day: is_half_day === true,
      reason,
    });
    res.status(201).json(request);
  } catch (error) { next(error); }
});

leaveRequestRouter.get('/', authorize('Employee', 'Manager'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Clamp to a positive integer: an unvalidated page produced a negative OFFSET and a 500.
    const parsed = parseInt(req.query.page as string);
    const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

    const filters = {
      leave_type_id: req.query.leave_type_id,
      status: req.query.status,
      from_date: req.query.from_date,
      to_date: req.query.to_date,
    };
    const result = await LeaveRequestService.getEmployeeRequests(req.user!.userId, filters, page);
    res.json(result);
  } catch (error) { next(error); }
});

leaveRequestRouter.patch('/:id/cancel', authorize('Employee', 'Manager'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const request = await LeaveRequestService.cancel(req.params.id, req.user!.userId);
    res.json(request);
  } catch (error) { next(error); }
});
