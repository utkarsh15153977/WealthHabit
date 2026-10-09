import { Router } from 'express';
import { healthCheck, readinessCheck } from '../controllers/healthController.js';
import { healthReadinessRateLimit } from '../middleware/rateLimit.js';

const router = Router();

// Liveness is dependency-free and stays free (rateLimit.test.ts asserts it
// carries no RateLimit headers); readiness runs a database probe, so it gets
// its own generous per-IP budget.
router.get('/health', healthCheck);
router.get('/health/ready', healthReadinessRateLimit, readinessCheck);

export default router;
