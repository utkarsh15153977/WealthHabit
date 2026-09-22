import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/logger.js';
import healthRoutes from './routes/healthRoutes.js';

const app = express();

app.use(helmet());

app.use(cors({
  origin: env.CLIENT_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(morgan(env.isDevelopment ? 'dev' : 'combined'));
app.use(requestLogger);

app.use('/api', healthRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;