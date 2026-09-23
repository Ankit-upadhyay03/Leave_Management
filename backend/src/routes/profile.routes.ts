import { Router, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import { authenticate, verifyAccountStatus, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { ProfileService } from '../services/profile.service';
import { AuthService } from '../services/auth.service';

export const profileRouter = Router();
profileRouter.use(authenticate, verifyAccountStatus);

// ---- Avatar upload storage ----
export const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads', 'avatars');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (req: AuthRequest, file, cb) => {
    // Random name keyed to the user; never trust the client-provided filename.
    const ext = EXT_BY_MIME[file.mimetype] || '.img';
    cb(null, `${req.user!.userId}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new AppError(400, 'INVALID_FILE', 'Only JPG, PNG, WEBP, or GIF images are allowed'));
    }
    cb(null, true);
  },
});

// GET /api/profile — current user's full profile
profileRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await AuthService.getCurrentUser(req.user!.userId);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
    res.json(user);
  } catch (error) { next(error); }
});

// PUT /api/profile — update editable fields (address)
profileRouter.put('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await ProfileService.updateProfile(req.user!.userId, { address: req.body.address }, req.ip);
    const user = await AuthService.getCurrentUser(req.user!.userId);
    res.json(user);
  } catch (error) { next(error); }
});

// POST /api/profile/avatar — upload a new profile picture
profileRouter.post('/avatar', upload.single('avatar'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw new AppError(400, 'NO_FILE', 'No image was uploaded');

    const publicUrl = `/uploads/avatars/${req.file.filename}`;
    const previous = await ProfileService.updateAvatar(req.user!.userId, publicUrl, req.ip);

    // Best-effort cleanup of the replaced file so uploads don't accumulate.
    if (previous) {
      const prevPath = path.resolve(process.cwd(), '.' + previous);
      fs.promises.unlink(prevPath).catch(() => { /* already gone */ });
    }

    res.json({ avatar_url: publicUrl });
  } catch (error) { next(error); }
});

// POST /api/profile/email/request-otp — send a code to the new address
profileRouter.post('/email/request-otp', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { new_email } = req.body;
    const result = await ProfileService.requestEmailChange(req.user!.userId, new_email, req.ip);
    res.json({ message: 'Verification code sent to the new email address', ...result });
  } catch (error) { next(error); }
});

// POST /api/profile/email/verify-otp — confirm the code and apply the change
profileRouter.post('/email/verify-otp', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code } = req.body;
    const result = await ProfileService.verifyEmailChange(req.user!.userId, code, req.ip);
    res.json({ message: 'Email address updated successfully', ...result });
  } catch (error) { next(error); }
});
