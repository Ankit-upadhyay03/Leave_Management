import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  statusCode: number;
  error: string;
  fields?: Record<string, string>;

  constructor(statusCode: number, error: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.statusCode = statusCode;
    this.error = error;
    this.fields = fields;
    Error.captureStackTrace?.(this, AppError);
  }
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    const response: Record<string, unknown> = { error: err.error, message: err.message };
    if (err.fields) response.fields = err.fields;
    res.status(err.statusCode).json(response);
    return;
  }

  // Multer upload failures (size, count, unexpected field).
  if (err?.name === 'MulterError') {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large. Maximum size is 5 MB.'
        : err.code === 'LIMIT_FILE_COUNT'
        ? 'Only one file may be uploaded at a time.'
        : `Upload error: ${err.message}`;
    res.status(400).json({ error: 'UPLOAD_ERROR', message });
    return;
  }

  // Malformed JSON body.
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'INVALID_JSON', message: 'Request body is not valid JSON' });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' });
    return;
  }

  if (err?.message === 'Not allowed by CORS') {
    res.status(403).json({ error: 'CORS_REJECTED', message: 'Origin not allowed' });
    return;
  }

  // Translate the database errors that map cleanly onto client mistakes.
  switch (err?.code) {
    case 'ER_DUP_ENTRY':
      res.status(409).json({ error: 'DUPLICATE_ENTRY', message: 'A record with these details already exists' });
      return;
    case 'ER_NO_REFERENCED_ROW_2':
    case 'ER_NO_REFERENCED_ROW':
      res.status(400).json({ error: 'INVALID_REFERENCE', message: 'A referenced record does not exist' });
      return;
    case 'ER_ROW_IS_REFERENCED_2':
    case 'ER_ROW_IS_REFERENCED':
      res.status(409).json({ error: 'RECORD_IN_USE', message: 'This record is referenced by other data and cannot be removed' });
      return;
    case 'ER_CHECK_CONSTRAINT_VIOLATED':
      res.status(409).json({ error: 'CONSTRAINT_VIOLATION', message: 'The operation would violate a data integrity rule' });
      return;
    case 'ER_DATA_TOO_LONG': {
      // Name the offending column so the client can point at the right field,
      // rather than returning an opaque 500.
      const column = /column '([^']+)'/.exec(err.message)?.[1];
      res.status(400).json({
        error: 'VALUE_TOO_LONG',
        message: column
          ? `The value provided for "${column}" is too long. Please shorten it.`
          : 'One of the submitted values is too long.',
        ...(column ? { fields: { [column]: 'Value is too long' } } : {}),
      });
      return;
    }
    case 'WARN_DATA_TRUNCATED':
    case 'ER_TRUNCATED_WRONG_VALUE':
      res.status(400).json({ error: 'INVALID_VALUE', message: 'One of the submitted values has an invalid format' });
      return;
    case 'ER_LOCK_DEADLOCK':
      res.status(409).json({ error: 'CONCURRENT_UPDATE', message: 'Another operation conflicted with this one. Please retry.' });
      return;
    case 'ER_LOCK_WAIT_TIMEOUT':
      res.status(409).json({ error: 'LOCK_TIMEOUT', message: 'The request timed out waiting on another operation. Please retry.' });
      return;
    case 'ECONNREFUSED':
    case 'PROTOCOL_CONNECTION_LOST':
      console.error('Database connection error:', err);
      res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Database is temporarily unavailable' });
      return;
  }

  // Anything unrecognised: log server-side, return an opaque message.
  console.error('Unhandled error:', {
    method: req.method,
    path: req.originalUrl,
    message: err?.message,
    stack: err?.stack,
  });
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
}
