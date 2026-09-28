import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import {
  AdminUserIdParams,
  ListAdminUsersQuery,
  UpdateAdminUserRoleInput,
  UpdateAdminUserStatusInput,
} from '../schemas/adminUserSchemas.js';
import {
  getAdminUserDetail,
  listAdminUsers,
  updateAdminUserRole,
  updateAdminUserStatus,
} from '../services/adminUserService.js';

export async function listAdminUsersHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const query = (req.query ?? {}) as ListAdminUsersQuery;

  const result = await listAdminUsers(query);

  res.json({
    success: true,
    data: result,
  });
}

export async function getAdminUserHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const { id } = req.params as AdminUserIdParams;

  const result = await getAdminUserDetail(id);

  res.json({
    success: true,
    data: result,
  });
}

export async function updateAdminUserStatusHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const actorUserId = getAuthenticatedUserId(req);
  const { id } = req.params as AdminUserIdParams;
  const { status } = req.body as UpdateAdminUserStatusInput;

  const result = await updateAdminUserStatus(id, status, actorUserId);

  res.json({
    success: true,
    data: result,
  });
}

export async function updateAdminUserRoleHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const actorUserId = getAuthenticatedUserId(req);
  const { id } = req.params as AdminUserIdParams;
  const { role } = req.body as UpdateAdminUserRoleInput;

  const result = await updateAdminUserRole(id, role, actorUserId);

  res.json({
    success: true,
    data: result,
  });
}
