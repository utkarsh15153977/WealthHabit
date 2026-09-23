import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { AuthErrorCodes } from '../types/auth.js';

export const validate = (schema: AnyZodObject) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      if (parsed && typeof parsed === 'object') {
        if ('body' in parsed && parsed.body !== undefined) {
          req.body = parsed.body;
        }
        if ('query' in parsed && parsed.query !== undefined) {
          req.query = parsed.query as Request['query'];
        }
        if ('params' in parsed && parsed.params !== undefined) {
          req.params = parsed.params as Request['params'];
        }
      }

      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors: Record<string, string[]> = {};
        error.errors.forEach((e) => {
          const path = e.path.join('.');
          if (!errors[path]) errors[path] = [];
          errors[path].push(e.message);
        });
        return next(
          AppError.badRequest('Validation failed', errors, AuthErrorCodes.VALIDATION_ERROR)
        );
      }
      return next(error);
    }
  };
