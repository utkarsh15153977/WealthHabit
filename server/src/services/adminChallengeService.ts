import { Challenge, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { addUtcDays, startOfUtcDay } from '../utils/date.js';
import { calculateChallengeProgress } from '../utils/challengeProgress.js';
import {
  deriveChallengeStatus,
  toRequirementData,
} from './prismaChallengeService.js';
import type { ListAdminChallengesQuery } from '../schemas/adminChallengeSchemas.js';
import type { ChallengeRequirementData } from '../types/challenge.js';
import type {
  AdminChallengeDetail,
  AdminChallengeListResult,
  AdminChallengeSummary,
} from '../types/adminChallenge.js';

const DEFAULT_PAGE_SIZE = 20;

type AdminChallengeDetailRow = Prisma.ChallengeGetPayload<{
  include: {
    requirements: {
      orderBy: { createdAt: 'asc' };
      include: { _count: { select: { mappings: true } } };
    };
    _count: { select: { participants: true } };
  };
}>;

function challengeNotFound(): AppError {
  return AppError.notFound(
    'Challenge not found',
    ApiErrorCodes.CHALLENGE_NOT_FOUND
  );
}

function activeWindowClause(today: Date): Prisma.ChallengeWhereInput {
  return {
    startDate: { lte: today },
    endDate: { gte: today },
    isActive: true,
  };
}

/**
 * Derived-status filter with the exact UTC calendar semantics of
 * `deriveChallengeStatus`/the public challenge list — the admin `status`
 * filter and the returned `status` field can never disagree.
 */
function statusClause(
  status: 'UPCOMING' | 'ACTIVE' | 'ENDED',
  today: Date
): Prisma.ChallengeWhereInput {
  if (status === 'UPCOMING') {
    return { startDate: { gt: today } };
  }
  if (status === 'ACTIVE') {
    return activeWindowClause(today);
  }
  return {
    startDate: { lte: today },
    OR: [{ endDate: { lt: today } }, { isActive: false }],
  };
}

/**
 * Persisted-activation filter, independent of the derived status:
 * `active=true` is the live window, `active=false` is its exact negation.
 */
function activationClause(
  active: 'true' | 'false',
  today: Date
): Prisma.ChallengeWhereInput {
  if (active === 'true') {
    return activeWindowClause(today);
  }
  return {
    OR: [
      { startDate: { gt: today } },
      { endDate: { lt: today } },
      { isActive: false },
    ],
  };
}

/**
 * Composes every requested filter as an AND of independent clauses so
 * status/activation OR-groups never clobber each other.
 */
function buildWhere(
  query: ListAdminChallengesQuery,
  today: Date
): Prisma.ChallengeWhereInput {
  const clauses: Prisma.ChallengeWhereInput[] = [];
  const search = query.search ? query.search.trim() : undefined;

  if (search) {
    clauses.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  if (query.type) {
    clauses.push({ type: query.type });
  }
  if (query.status) {
    clauses.push(statusClause(query.status, today));
  }
  if (query.active) {
    clauses.push(activationClause(query.active, today));
  }
  if (query.dateFrom) {
    clauses.push({ startDate: { gte: startOfUtcDay(query.dateFrom) } });
  }
  if (query.dateTo) {
    clauses.push({
      startDate: { lt: addUtcDays(startOfUtcDay(query.dateTo), 1) },
    });
  }

  return clauses.length > 0 ? { AND: clauses } : {};
}

function toBase(
  challenge: Challenge,
  today: Date
): Omit<AdminChallengeSummary, 'requirementCount' | 'participants'> {
  return {
    id: challenge.id,
    name: challenge.name,
    description: challenge.description,
    category: challenge.category,
    difficulty: challenge.difficulty as AdminChallengeSummary['difficulty'],
    points: challenge.points,
    type: challenge.type as AdminChallengeSummary['type'],
    startDate: challenge.startDate.toISOString(),
    endDate: challenge.endDate.toISOString(),
    isActive: challenge.isActive,
    status: deriveChallengeStatus(challenge, today),
    createdAt: challenge.createdAt.toISOString(),
    updatedAt: challenge.updatedAt.toISOString(),
  };
}

/**
 * Derived participation stats for one challenge: total participants plus
 * how many currently satisfy the derived completion rule (100% of
 * eligible periods). All data is read from the existing derived-progress
 * machinery — nothing is persisted, and every query is batched
 * (4 flat queries regardless of participant count, no N+1).
 */
async function computeParticipantStats(
  challenge: Pick<AdminChallengeDetailRow, 'id' | 'startDate' | 'endDate'>,
  requirements: ChallengeRequirementData[],
  today: Date
): Promise<{ total: number; completed: number }> {
  const participants = await prisma.challengeParticipant.findMany({
    where: { challengeId: challenge.id },
    select: { id: true },
  });
  const total = participants.length;
  if (total === 0) {
    return { total: 0, completed: 0 };
  }

  const participantIds = participants.map((participant) => participant.id);
  const mappings = await prisma.challengeParticipantHabit.findMany({
    where: { participantId: { in: participantIds } },
    select: { participantId: true, requirementId: true, habitId: true },
  });
  const mappingByParticipantRequirement = new Map(
    mappings.map((mapping) => [
      `${mapping.participantId}:${mapping.requirementId}`,
      mapping.habitId,
    ])
  );

  const habitIds = [...new Set(mappings.map((mapping) => mapping.habitId))];
  const habits =
    habitIds.length > 0
      ? await prisma.financialHabit.findMany({
          where: { id: { in: habitIds } },
          select: { id: true, startDate: true, endDate: true },
        })
      : [];
  const habitById = new Map(habits.map((habit) => [habit.id, habit]));

  const windowFrom = startOfUtcDay(challenge.startDate);
  const endDateDay = startOfUtcDay(challenge.endDate).getTime();
  const todayDay = today.getTime();
  const windowTo =
    endDateDay < todayDay ? new Date(endDateDay) : new Date(todayDay);

  const completionsByHabit = new Map<string, Date[]>();
  if (habitIds.length > 0 && windowFrom.getTime() <= windowTo.getTime()) {
    const rows = await prisma.habitCompletion.findMany({
      where: {
        habitId: { in: habitIds },
        completionDate: { gte: windowFrom, lte: windowTo },
      },
      select: { habitId: true, completionDate: true },
    });
    for (const row of rows) {
      const existing = completionsByHabit.get(row.habitId);
      if (existing) {
        existing.push(row.completionDate);
      } else {
        completionsByHabit.set(row.habitId, [row.completionDate]);
      }
    }
  }

  let completed = 0;
  for (const participant of participants) {
    const habitsByRequirement = new Map<
      string,
      { id: string; startDate: Date; endDate: Date | null } | null
    >();
    for (const requirement of requirements) {
      const habitId = mappingByParticipantRequirement.get(
        `${participant.id}:${requirement.id}`
      );
      const habit = habitId ? habitById.get(habitId) : undefined;
      habitsByRequirement.set(requirement.id, habit ?? null);
    }

    const progress = calculateChallengeProgress({
      challenge: {
        id: challenge.id,
        startDate: challenge.startDate,
        endDate: challenge.endDate,
      },
      requirements,
      habitsByRequirement,
      completionsByHabit,
      today,
    });
    if (progress.completed) {
      completed += 1;
    }
  }

  return { total, completed };
}

export async function listAdminChallenges(
  query: ListAdminChallengesQuery
): Promise<AdminChallengeListResult> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const today = startOfUtcDay(new Date());
  const where = buildWhere(query, today);

  const [challenges, total] = await prisma.$transaction([
    prisma.challenge.findMany({
      where,
      include: {
        _count: { select: { participants: true, requirements: true } },
      },
      // Deterministic order, matching the public challenge list.
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.challenge.count({ where }),
  ]);

  return {
    challenges: challenges.map((challenge) => ({
      ...toBase(challenge, today),
      requirementCount: challenge._count.requirements,
      participants: { total: challenge._count.participants },
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getAdminChallengeDetail(
  challengeId: string
): Promise<AdminChallengeDetail> {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    include: {
      requirements: {
        orderBy: { createdAt: 'asc' },
        include: { _count: { select: { mappings: true } } },
      },
      _count: { select: { participants: true } },
    },
  });

  if (!challenge) {
    throw challengeNotFound();
  }

  const { requirements, ...identity } = challenge;
  const today = startOfUtcDay(new Date());
  const requirementData = requirements.map(toRequirementData);
  const participants = await computeParticipantStats(
    identity,
    requirementData,
    today
  );

  return {
    ...toBase(identity, today),
    requirementCount: requirements.length,
    requirements: requirements.map((requirement) => ({
      id: requirement.id,
      name: requirement.name,
      description: requirement.description,
      frequency: requirement.frequency as ChallengeRequirementData['frequency'],
      target: requirement.target,
      unit: requirement.unit,
      mappedParticipants: requirement._count.mappings,
    })),
    participants,
  };
}
