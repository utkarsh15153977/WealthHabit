import { Request, Response, NextFunction } from 'express';

export const asyncHandler = <T extends Request = Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>
) => {
  return (req: T, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};
