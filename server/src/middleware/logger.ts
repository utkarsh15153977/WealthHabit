import { Request, Response, NextFunction } from 'express';
import { env } from '../config/index.js';

export const requestLogger = (req: Request, _res: Response, next: NextFunction) => {
  const start = Date.now();
  
  if (env.isDevelopment) {
    console.log(`${req.method} ${req.path}`);
  }

  _res.on('finish', () => {
    const duration = Date.now() - start;
    if (env.isDevelopment) {
      console.log(`${req.method} ${req.path} ${_res.statusCode} ${duration}ms`);
    }
  });

  next();
};