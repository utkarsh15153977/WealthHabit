import rateLimit from 'express-rate-limit';
import { env } from '../config/index.js';

const windowMs = 15 * 60 * 1000; // 15 minutes

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
});
