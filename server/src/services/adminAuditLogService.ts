import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { addUtcDays, startOfUtcDay } from '../utils/date.js';
import type { ListAuditLogsQuery } from '../schemas/adminAuditLogSchemas.js';
import type {
  AdminAuditLogActor,
  AdminAuditLogEntry,
  AdminAuditLogListResult,
} from '../types/adminAuditLog.js';

const DEFAULT_PAGE_SIZE = 20;

/**
 * Search resolves matching users first (actor email/name via relation, target
 * via `entityId`), so the lookup is bounded instead of scanning the whole
 * user table. Metadata search is intentionally not supported: it would need
 * raw SQL over the JSON column.
 */
const SEARCH_USER_LOOKUP_LIMIT = 1000;

const actorSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
} satisfies Prisma.UserSelect;

type ActorRecord = Prisma.UserGetPayload<{ select: typeof actorSelect }>;

const logSelect = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  metadata: true,
  createdAt: true,
  actor: { select: actorSelect },
} satisfies Prisma.AuditLogSelect;

type SelectedLog = Prisma.AuditLogGetPayload<{ select: typeof logSelect }>;

/**
 * Metadata keys that are never echoed back, whatever a future writer might
 * store. Catches passwordHash, refreshTokenHash, accessToken, cookies,
 * secrets, API keys, JWTs and similar credential-shaped names.
 */
const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|hash|cookie|authorization|credential|api[-_]?key|private|jwt|bearer/i;

const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_STRING = 500;
const MAX_METADATA_ARRAY = 50;
const MAX_METADATA_KEYS = 50;

/**
 * Shapes stored metadata into a stable, bounded, credential-free value before
 * it leaves the server. The current writers only store status/role transitions
 * (`targetUserId`, `from`, `to`, `revokedSessions`), but the response contract
 * must hold even if a future writer passes something larger or sensitive.
 */
function sanitizeAuditMetadata(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (value === null || value === undefined) {
    return null;
  }
  return sanitizeMetadataValue(value, 0);
}

function sanitizeMetadataValue(value: Prisma.JsonValue, depth: number): Prisma.JsonValue | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value.length > MAX_METADATA_STRING
      ? `${value.slice(0, MAX_METADATA_STRING)}...`
      : value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_METADATA_DEPTH) {
      return '[truncated]';
    }
    return value
      .slice(0, MAX_METADATA_ARRAY)
      .map((item) => sanitizeMetadataValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= MAX_METADATA_DEPTH) {
      return '[truncated]';
    }
    const sanitized: Record<string, Prisma.JsonValue> = {};
    let kept = 0;
    for (const [key, entry] of Object.entries(value)) {
      if (kept >= MAX_METADATA_KEYS) {
        break;
      }
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        continue;
      }
      sanitized[key] =
        entry === undefined ? null : sanitizeMetadataValue(entry as Prisma.JsonValue, depth + 1);
      kept += 1;
    }
    return sanitized;
  }
  return null;
}

function toActor(record: ActorRecord | null | undefined): AdminAuditLogActor | null {
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    email: record.email,
    firstName: record.firstName,
    lastName: record.lastName,
  };
}

function toEntry(log: SelectedLog, targetById: Map<string, ActorRecord>): AdminAuditLogEntry {
  return {
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    actor: toActor(log.actor),
    target: log.entityId ? toActor(targetById.get(log.entityId)) : null,
    metadata: sanitizeAuditMetadata(log.metadata),
    createdAt: log.createdAt.toISOString(),
  };
}

function searchUserWhere(search: string): Prisma.UserWhereInput {
  return {
    OR: [
      { email: { contains: search, mode: 'insensitive' } },
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
    ],
  };
}

/**
 * ADMIN-facing audit-log query. Read-only by construction: this service only
 * ever calls `findMany`/`count` (plus one bounded user lookup for search and
 * one for target resolution). Rows are ordered `createdAt DESC, id DESC` and
 * the response contains only safe actor/target identities and sanitized
 * metadata — never credentials, tokens or financial values. A deleted actor
 * (nullable FK, `onDelete: SetNull`) or an unresolvable target yields `null`
 * instead of failing the page.
 */
export async function listAuditLogs(
  query: ListAuditLogsQuery
): Promise<AdminAuditLogListResult> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const search = query.search ? query.search.trim() : undefined;

  const where: Prisma.AuditLogWhereInput = {};

  if (query.action) {
    where.action = query.action;
  }
  if (query.actorUserId) {
    where.actorUserId = query.actorUserId;
  }
  if (query.entityId) {
    where.entityId = query.entityId;
  }

  if (query.dateFrom || query.dateTo) {
    const range: Prisma.DateTimeFilter = {};
    if (query.dateFrom) {
      range.gte = startOfUtcDay(query.dateFrom);
    }
    if (query.dateTo) {
      range.lt = addUtcDays(startOfUtcDay(query.dateTo), 1);
    }
    where.createdAt = range;
  }

  if (search) {
    const or: Prisma.AuditLogWhereInput[] = [
      { actor: { is: searchUserWhere(search) } },
      { action: { contains: search, mode: 'insensitive' } },
    ];
    const matchedUsers = await prisma.user.findMany({
      where: searchUserWhere(search),
      select: { id: true },
      take: SEARCH_USER_LOOKUP_LIMIT,
    });
    or.push({ entityId: { in: matchedUsers.map((user) => user.id) } });
    where.OR = or;
  }

  const [logs, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      select: logSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const targetIds = [
    ...new Set(
      logs
        .map((log) => log.entityId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ];

  const targets = targetIds.length
    ? await prisma.user.findMany({
        where: { id: { in: targetIds } },
        select: actorSelect,
      })
    : [];

  const targetById = new Map(targets.map((target) => [target.id, target]));

  return {
    auditLogs: logs.map((log) => toEntry(log, targetById)),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
