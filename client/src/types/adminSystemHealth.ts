export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

export type HealthEnvironment = 'development' | 'test' | 'production';

export interface ApplicationHealth {
  status: HealthStatus;
  service: string;
  environment: HealthEnvironment;
  uptimeSeconds: number;
}

export interface DatabaseHealth {
  status: HealthStatus;
  latencyMs: number | null;
  message: string | null;
}

export interface RuntimeMemoryUsage {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
}

export interface RuntimeHealth {
  status: HealthStatus;
  nodeVersion: string;
  uptimeSeconds: number;
  memory: RuntimeMemoryUsage;
}

export interface SystemHealthData {
  status: HealthStatus;
  generatedAt: string;
  application: ApplicationHealth;
  database: DatabaseHealth;
  runtime: RuntimeHealth;
}
