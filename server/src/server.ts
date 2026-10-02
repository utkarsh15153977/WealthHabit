import app from './app.js';
import { env } from './config/index.js';
import { prisma } from './config/prisma.js';
import { startServer } from './lifecycle.js';

void startServer({
  listen: () =>
    app.listen(env.PORT, () => {
      console.log(`Server running on http://localhost:${env.PORT}`);
      console.log(`Environment: ${env.NODE_ENV}`);
      console.log(`API Base: http://localhost:${env.PORT}/api`);
      console.log(`Health: http://localhost:${env.PORT}/api/health`);
    }),
  prisma,
  exit: (code) => process.exit(code),
});
