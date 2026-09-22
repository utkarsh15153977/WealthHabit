import { Request, Response } from 'express';
import { HealthResponse } from '../types/api.js';

export const healthCheck = (_req: Request, res: Response<HealthResponse>) => {
  res.json({
    success: true,
    message: 'WealthHabit API is running',
  });
};