import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { NotificationService } from '../services/notification.service';

export const notificationRouter = Router();
notificationRouter.use(authenticate);

// Own notifications only — recipient is always taken from the token, never the query.
notificationRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const unreadOnly = req.query.unread === 'true';
    const notifications = await NotificationService.getNotifications(req.user!.userId, unreadOnly);
    res.json(notifications);
  } catch (error) { next(error); }
});

notificationRouter.get('/unread-count', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const count = await NotificationService.getUnreadCount(req.user!.userId);
    res.json({ count });
  } catch (error) { next(error); }
});

notificationRouter.patch('/:id/read', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ok = await NotificationService.markAsRead(req.params.id, req.user!.userId);
    if (!ok) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Notification not found' });
      return;
    }
    res.json({ message: 'Marked as read' });
  } catch (error) { next(error); }
});

notificationRouter.patch('/read-all', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const updated = await NotificationService.markAllAsRead(req.user!.userId);
    res.json({ message: `${updated} notification(s) marked as read` });
  } catch (error) { next(error); }
});
