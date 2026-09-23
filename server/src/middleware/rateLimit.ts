import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request } from 'express';
import { env } from '../config/index.js';

const windowMs = 15 * 60 * 1000; // 15 minutes

const ipKeyGeneratorMiddleware = (req: Request): string =>
  ipKeyGenerator(req.ip ?? '');

export const authRateLimit = rateLimit({
  windowMs,
  max: env.isDevelopment ? 100 : 20,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGeneratorMiddleware,
});

export const apiRateLimit = rateLimit({
  windowMs,
  max: env.isDevelopment ? 500 : 100,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGeneratorMiddleware,
});