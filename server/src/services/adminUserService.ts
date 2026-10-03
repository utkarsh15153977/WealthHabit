import { AccountStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { AuditActions, recordAuditEvent } from './auditLogService.js';
import type { ListAdminUsersQuery } from '../schemas/adminUserSchemas.js';
import type {
  AdminUserDetail,
  AdminUserListResult,
  AdminUserSummary,
} from '../types/adminUser.js';

const DEFAULT_PAGE_SIZE = 20;

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

type SelectedUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

/**
 * Status transitions supported by the existing account model.
 *
 * Login (`authController.login`) and every authenticated request
 * (`authenticate` middleware) gate solely on `status === ACTIVE`, and there is
 * no permanent soft-delete marker, so an admin can reactivate a
 * DEACTIVATED account by setting it back to ACTIVE. The only transition the
 * architecture does not express is DEACTIVATED -> SUSPENDED, which is
 * rejected as an unsupported transition.
 */
const allowedStatusTransitions: Record<AccountStatus, AccountStatus[]> = {
  [AccountStatus.ACTIVE]: [
    AccountStatus.ACTIVE,
    AccountStatus.SUSPENDED,
    AccountStatus.DEACTIVATED,
  ],
  [AccountStatus.SUSPENDED]: [
    AccountStatus.ACTIVE,
    AccountStatus.SUSPENDED,
    AccountStatus.DEACTIVATED,
  ],
  [AccountStatus.DEACTIVATED]: [
    AccountStatus.ACTIVE,
    AccountStatus.DEACTIVATED,
  ],
};

const ADMIN_USER_MUTATION_LOCK_KEY = 'wealthhabit:admin_user_mutations';

const ADMIN_USER_MUTATION_TIMEOUT_MS = 15_000;

export async function lockAdminUserMutations(
  tx: Prisma.TransactionClient
): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMIN_USER_MUTATION_LOCK_KEY})::bigint) IS NOT NULL AS "acquired"`;
}

async function lockAdminUserRow(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
}

async function countRemainingActiveAdmins(
  tx: Prisma.TransactionClient,
  excludeUserId: string
): Promise<number> {
  return tx.user.count({
    where: {
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
      id: { not: excludeUserId },
    },
  });
}

function toAdminUserSummary(user: SelectedUser): AdminUserSummary {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function userNotFound(): AppError {
  return AppError.notFound('User not found', ApiErrorCodes.USER_NOT_FOUND);
}

export async function listAdminUsers(
  query: ListAdminUsersQuery
): Promise<AdminUserListResult> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const search = query.search ? query.search.trim() : undefined;

  const where: Prisma.UserWhereInput = {};

  if (query.role) {
    where.role = query.role;
  }

  if (query.status) {
    where.status = query.status;
  }

  if (search) {
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users: users.map(toAdminUserSummary),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getAdminUserDetail(
  userId: string
): Promise<AdminUserDetail> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: userSelect,
  });

  if (!user) {
    throw userNotFound();
  }

  const [transactions, goals, assets, liabilities, habits, challenges] =
    await prisma.$transaction([
      prisma.transaction.count({ where: { userId } }),
      prisma.savingsGoal.count({ where: { userId } }),
      prisma.asset.count({ where: { userId } }),
      prisma.liability.count({ where: { userId } }),
      prisma.financialHabit.count({ where: { userId } }),
      prisma.challengeParticipant.count({ where: { userId } }),
    ]);

  return {
    user: toAdminUserSummary(user),
    counts: { transactions, goals, assets, liabilities, habits, challenges },
  };
}

export async function updateAdminUserStatus(
  userId: string,
  nextStatus: AccountStatus,
  actorUserId: string
): Promise<AdminUserDetail> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!target) {
    throw userNotFound();
  }

  if (userId === actorUserId && nextStatus !== AccountStatus.ACTIVE) {
    throw new AppError(
      'You cannot suspend or deactivate your own account',
      409,
      undefined,
      ApiErrorCodes.ADMIN_SELF_STATUS_CHANGE
    );
  }

  await prisma.$transaction(
    async (tx) => {
      await lockAdminUserMutations(tx);
      await lockAdminUserRow(tx, userId);

      const fresh = await tx.user.findUnique({
        where: { id: userId },
        select: { status: true, role: true },
      });

      if (!fresh) {
        throw userNotFound();
      }

      if (!allowedStatusTransitions[fresh.status].includes(nextStatus)) {
        throw new AppError(
          `Account status cannot change from ${fresh.status} to ${nextStatus}`,
          409,
          undefined,
          ApiErrorCodes.INVALID_STATUS_TRANSITION
        );
      }

      if (fresh.status === nextStatus) {
        return;
      }

      if (
        fresh.role === Role.ADMIN &&
        fresh.status === AccountStatus.ACTIVE &&
        nextStatus !== AccountStatus.ACTIVE
      ) {
        const remainingActiveAdmins = await countRemainingActiveAdmins(
          tx,
          userId
        );

        if (remainingActiveAdmins < 1) {
          throw new AppError(
            'The last active administrator cannot be suspended or deactivated',
            409,
            undefined,
            ApiErrorCodes.LAST_ADMIN_REQUIRED
          );
        }
      }

      await tx.user.update({
        where: { id: userId },
        data: { status: nextStatus },
      });

      const now = new Date();

      // Status is not data deletion: only authentication sessions are revoked,
      // financial and application records are never touched.
      const revoked = await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });

      await recordAuditEvent(
        {
          actorUserId,
          action: AuditActions.ADMIN_USER_STATUS_CHANGED,
          entityType: 'User',
          entityId: userId,
          metadata: {
            targetUserId: userId,
            from: fresh.status,
            to: nextStatus,
            revokedSessions: revoked.count,
          },
        },
        tx
      );
    },
    { timeout: ADMIN_USER_MUTATION_TIMEOUT_MS }
  );

  return getAdminUserDetail(userId);
}

export async function updateAdminUserRole(
  userId: string,
  nextRole: Role,
  actorUserId: string
): Promise<AdminUserDetail> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!target) {
    throw userNotFound();
  }

  if (target.role === nextRole) {
    return getAdminUserDetail(userId);
  }

  await prisma.$transaction(
    async (tx) => {
      await lockAdminUserMutations(tx);
      await lockAdminUserRow(tx, userId);

      const fresh = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (!fresh) {
        throw userNotFound();
      }

      if (fresh.role === nextRole) {
        return;
      }

      if (fresh.role === Role.ADMIN && nextRole === Role.USER) {
        // Server-side count of the administrators that would remain ACTIVE
        // after this demotion, evaluated while every other admin mutation is
        // blocked. The target is excluded so demoting somebody else's account
        // is never blocked by the target's own admin row.
        const remainingActiveAdmins = await countRemainingActiveAdmins(
          tx,
          userId
        );

        if (remainingActiveAdmins < 1) {
          throw new AppError(
            'The last administrator cannot be demoted',
            409,
            undefined,
            ApiErrorCodes.LAST_ADMIN_REQUIRED
          );
        }
      }

      await tx.user.update({
        where: { id: userId },
        data: { role: nextRole },
      });

      // Role changes need no session revocation: `authenticate` re-reads the
      // role from the database on every request.
      await recordAuditEvent(
        {
          actorUserId,
          action: AuditActions.ADMIN_USER_ROLE_CHANGED,
          entityType: 'User',
          entityId: userId,
          metadata: {
            targetUserId: userId,
            from: fresh.role,
            to: nextRole,
          },
        },
        tx
      );
    },
    { timeout: ADMIN_USER_MUTATION_TIMEOUT_MS }
  );

  return getAdminUserDetail(userId);
}
