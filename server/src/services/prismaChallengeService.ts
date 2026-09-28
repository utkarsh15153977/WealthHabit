import { Challenge, ChallengeParticipant, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { startOfUtcDay } from '../utils/date.js';
import { calculateChallengeProgress } from '../utils/challengeProgress.js';
import { AuditActions, recordAuditEvent } from './auditLogService.js';
import {
  CreateChallengeInput,
  ListChallengesQuery,
  UpdateChallengeInput,
} from '../schemas/challengeSchemas.js';
import type {
  ChallengeData,
  ChallengeRequirementData,
  ChallengeStatusData,
} from '../types/challenge.js';

function utcDayIso(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

export type ChallengeWithRequirements = Prisma.ChallengeGetPayload<{
  include: { requirements: true };
}>;

export function deriveChallengeStatus(
  challenge: Pick<Challenge, 'startDate' | 'endDate' | 'isActive'>,
  today: Date
): ChallengeStatusData {
  const start = startOfUtcDay(challenge.startDate).getTime();
  const end = startOfUtcDay(challenge.endDate).getTime();
  const current = startOfUtcDay(today).getTime();

  if (current < start) {
    return 'UPCOMING';
  }
  if (current > end) {
    return 'ENDED';
  }
  return challenge.isActive ? 'ACTIVE' : 'ENDED';
}

export function toRequirementData(
  requirement: ChallengeWithRequirements['requirements'][number]
): ChallengeRequirementData {
  return {
    id: requirement.id,
    challengeId: requirement.challengeId,
    name: requirement.name,
    description: requirement.description,
    frequency: requirement.frequency as ChallengeRequirementData['frequency'],
    target: requirement.target,
    unit: requirement.unit,
    createdAt: requirement.createdAt,
  };
}

/**
 * Challenge progress/status are always DERIVED. The legacy participant
 * columns (progress, status, completedAt) are never read or written here —
 * they cannot contradict the computed state because they are not exposed.
 */
export function toChallengeData(
  challenge: ChallengeWithRequirements,
  participant: ChallengeParticipant | null,
  progress: ChallengeData['participation']['progress']
): ChallengeData {
  const today = startOfUtcDay(new Date());

  return {
    id: challenge.id,
    name: challenge.name,
    description: challenge.description,
    type: challenge.type as ChallengeData['type'],
    category: challenge.category,
    difficulty: challenge.difficulty as ChallengeData['difficulty'],
    points: challenge.points,
    startDate: challenge.startDate,
    endDate: challenge.endDate,
    isActive: challenge.isActive,
    status: deriveChallengeStatus(challenge, today),
    createdAt: challenge.createdAt,
    updatedAt: challenge.updatedAt,
    requirements: challenge.requirements.map(toRequirementData),
    participation: participant
      ? {
          joined: true,
          joinedAt: participant.joinedAt,
          status: progress ? progress.status : 'JOINED',
          progress,
        }
      : {
          joined: false,
          joinedAt: null,
          status: 'NOT_JOINED',
          progress: null,
        },
  };
}

export async function findChallenge(id: string): Promise<ChallengeWithRequirements | null> {
  return prisma.challenge.findUnique({
    where: { id },
    include: { requirements: { orderBy: { createdAt: 'asc' } } },
  });
}

/**
 * Admin challenge creation writes the mutation and its audit event in one
 * transaction, so the audit trail can never disagree with the database.
 */
export async function createChallenge(
  input: CreateChallengeInput,
  actorUserId: string
): Promise<ChallengeWithRequirements> {
  return prisma.$transaction(async (tx) => {
    const challenge = await tx.challenge.create({
      data: {
        name: input.name,
        description: input.description ?? '',
        category: input.category ?? 'general',
        difficulty: input.difficulty ?? 'MEDIUM',
        points: input.points ?? 0,
        startDate: input.startDate,
        endDate: input.endDate,
        requirements: {
          create: input.requirements.map((requirement) => ({
            name: requirement.name,
            description: requirement.description ?? null,
            frequency: requirement.frequency,
            target: requirement.target ?? 1,
            unit: requirement.unit ?? null,
          })),
        },
      },
      include: { requirements: { orderBy: { createdAt: 'asc' } } },
    });

    await recordAuditEvent(
      {
        actorUserId,
        action: AuditActions.ADMIN_CHALLENGE_CREATED,
        entityType: 'Challenge',
        entityId: challenge.id,
        metadata: {
          name: challenge.name,
          type: challenge.type,
          category: challenge.category,
          startDate: utcDayIso(challenge.startDate),
          endDate: utcDayIso(challenge.endDate),
          requirementCount: challenge.requirements.length,
          isActive: challenge.isActive,
        },
      },
      tx
    );

    return challenge;
  });
}

export async function updateChallenge(
  challenge: ChallengeWithRequirements,
  input: UpdateChallengeInput,
  actorUserId: string
): Promise<ChallengeWithRequirements> {
  return prisma.$transaction(async (tx) => {
    const data: Prisma.ChallengeUpdateInput = {};

    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.category !== undefined) data.category = input.category;
    if (input.difficulty !== undefined) data.difficulty = input.difficulty;
    if (input.points !== undefined) data.points = input.points;
    if (input.startDate !== undefined) data.startDate = input.startDate;
    if (input.endDate !== undefined) data.endDate = input.endDate;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const updated = await tx.challenge.update({
      where: { id: challenge.id },
      data,
      include: { requirements: { orderBy: { createdAt: 'asc' } } },
    });

    // Operational metadata only: which fields changed, plus the activation
    // transition when it changed. Activation is a normal PATCH field, so it
    // is audited as ADMIN_CHALLENGE_UPDATED rather than a redundant action.
    const changedFields = Object.keys(input);
    const activationChanged =
      input.isActive !== undefined && input.isActive !== challenge.isActive;
    const metadata: Prisma.InputJsonObject = activationChanged
      ? {
          name: updated.name,
          changedFields,
          previousIsActive: challenge.isActive,
          newIsActive: input.isActive,
        }
      : { name: updated.name, changedFields };

    await recordAuditEvent(
      {
        actorUserId,
        action: AuditActions.ADMIN_CHALLENGE_UPDATED,
        entityType: 'Challenge',
        entityId: challenge.id,
        metadata,
      },
      tx
    );

    return updated;
  });
}

/**
 * Deletion uses the schema's own cascade rules (requirements, participants
 * and requirement→habit mappings cascade; user FinancialHabits are the
 * referenced side of a mapping and are never deleted). The audit event is
 * written in the same transaction, after counting participants from the
 * still-consistent state.
 */
export async function deleteChallenge(
  challenge: Pick<Challenge, 'id' | 'name' | 'type'>,
  actorUserId: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const participantCount = await tx.challengeParticipant.count({
      where: { challengeId: challenge.id },
    });

    await tx.challenge.delete({ where: { id: challenge.id } });

    await recordAuditEvent(
      {
        actorUserId,
        action: AuditActions.ADMIN_CHALLENGE_DELETED,
        entityType: 'Challenge',
        entityId: challenge.id,
        metadata: {
          name: challenge.name,
          type: challenge.type,
          participants: participantCount,
        },
      },
      tx
    );
  });
}

function activeWindowFilter(today: Date): Prisma.ChallengeWhereInput {
  return {
    startDate: { lte: today },
    endDate: { gte: today },
    isActive: true,
  };
}

export interface ChallengeListResult {
  challenges: ChallengeWithRequirements[];
  participations: Map<string, ChallengeParticipant>;
  progress: Map<string, ReturnType<typeof calculateChallengeProgress>> | null;
  page: number;
  pageSize: number;
  total: number;
  activeCount: number;
  joinedCount: number;
}

export async function listChallenges(
  userId: string,
  query?: ListChallengesQuery
): Promise<ChallengeListResult> {
  const page = query?.page ?? 1;
  const pageSize = query?.pageSize ?? 20;
  const today = startOfUtcDay(new Date());

  const where: Prisma.ChallengeWhereInput = {};

  if (query?.status === 'UPCOMING') {
    where.startDate = { gt: today };
  } else if (query?.status === 'ACTIVE') {
    Object.assign(where, activeWindowFilter(today));
  } else if (query?.status === 'ENDED') {
    where.startDate = { lte: today };
    where.OR = [{ endDate: { lt: today } }, { isActive: false }];
  }

  if (query?.active === 'true') {
    Object.assign(where, activeWindowFilter(today));
  } else if (query?.active === 'false') {
    where.OR = [
      ...(where.OR ?? []),
      { startDate: { gt: today } },
      { endDate: { lt: today } },
      { isActive: false },
    ];
  }

  if (query?.joined === 'true') {
    where.participants = { some: { userId } };
  } else if (query?.joined === 'false') {
    where.participants = { none: { userId } };
  }

  const [challenges, total, activeCount, joinedCount] = await prisma.$transaction([
    prisma.challenge.findMany({
      where,
      include: { requirements: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.challenge.count({ where }),
    prisma.challenge.count({ where: activeWindowFilter(today) }),
    prisma.challengeParticipant.count({ where: { userId } }),
  ]);

  const participations = await loadParticipations(
    userId,
    challenges.map((challenge) => challenge.id)
  );

  const progress =
    query?.includeProgress === 'true'
      ? await computeProgressForChallenges(challenges, participations)
      : null;

  return {
    challenges,
    participations,
    progress,
    page,
    pageSize,
    total,
    activeCount,
    joinedCount,
  };
}

export async function loadParticipations(
  userId: string,
  challengeIds: string[]
): Promise<Map<string, ChallengeParticipant>> {
  const map = new Map<string, ChallengeParticipant>();
  if (challengeIds.length === 0) {
    return map;
  }

  const rows = await prisma.challengeParticipant.findMany({
    where: { userId, challengeId: { in: challengeIds } },
  });
  for (const row of rows) {
    map.set(row.challengeId, row);
  }
  return map;
}

/**
 * Batched derived progress for a set of challenges: bounded by the number
 * of challenges passed in — participants, mappings, habits and completions
 * are each fetched with a single `IN` query (no N+1), and nothing is ever
 * written: completions are only read.
 */
export async function computeProgressForChallenges(
  challenges: ChallengeWithRequirements[],
  participantByChallenge: Map<string, ChallengeParticipant>
): Promise<Map<string, ReturnType<typeof calculateChallengeProgress>>> {
  const progress = new Map<string, ReturnType<typeof calculateChallengeProgress>>();
  const today = startOfUtcDay(new Date());

  const joined = challenges.filter((challenge) =>
    participantByChallenge.has(challenge.id)
  );
  if (joined.length === 0) {
    return progress;
  }

  const participantIds = joined.map(
    (challenge) => participantByChallenge.get(challenge.id)!.id
  );

  const mappings = await prisma.challengeParticipantHabit.findMany({
    where: { participantId: { in: participantIds } },
    select: { participantId: true, requirementId: true, habitId: true },
  });

  const habitIds = [...new Set(mappings.map((mapping) => mapping.habitId))];
  const habits =
    habitIds.length > 0
      ? await prisma.financialHabit.findMany({
          where: { id: { in: habitIds } },
          select: { id: true, startDate: true, endDate: true },
        })
      : [];
  const habitById = new Map(habits.map((habit) => [habit.id, habit]));

  let completionsByHabit = new Map<string, Date[]>();
  if (habitIds.length > 0) {
    const windowFrom = new Date(
      Math.min(...joined.map((challenge) => challenge.startDate.getTime()))
    );
    const windowTo = new Date(
      Math.max(
        ...joined.map((challenge) => {
          const end = startOfUtcDay(challenge.endDate).getTime();
          const todayTime = today.getTime();
          return end < todayTime ? end : todayTime;
        })
      )
    );

    if (windowFrom.getTime() <= windowTo.getTime()) {
      const rows = await prisma.habitCompletion.findMany({
        where: {
          habitId: { in: habitIds },
          completionDate: { gte: windowFrom, lte: windowTo },
        },
        select: { habitId: true, completionDate: true },
      });
      completionsByHabit = new Map();
      for (const row of rows) {
        const existing = completionsByHabit.get(row.habitId);
        if (existing) {
          existing.push(row.completionDate);
        } else {
          completionsByHabit.set(row.habitId, [row.completionDate]);
        }
      }
    }
  }

  for (const challenge of joined) {
    const participant = participantByChallenge.get(challenge.id)!;
    const habitsByRequirement = new Map<
      string,
      { id: string; startDate: Date; endDate: Date | null } | null
    >();

    for (const requirement of challenge.requirements) {
      const mapping = mappings.find(
        (candidate) =>
          candidate.participantId === participant.id &&
          candidate.requirementId === requirement.id
      );
      const habit = mapping ? habitById.get(mapping.habitId) : undefined;
      habitsByRequirement.set(requirement.id, habit ?? null);
    }

    progress.set(
      challenge.id,
      calculateChallengeProgress({
        challenge,
        requirements: challenge.requirements.map(toRequirementData),
        habitsByRequirement,
        completionsByHabit,
        today,
      })
    );
  }

  return progress;
}

/**
 * Joining is race-safe: the existing (challengeId, userId) unique
 * constraint is the authority — a concurrent duplicate hits P2002 and is
 * converted into an idempotent "already joined" result.
 */
export async function joinChallenge(
  challengeId: string,
  userId: string
): Promise<{ participant: ChallengeParticipant; alreadyJoined: boolean }> {
  try {
    const participant = await prisma.challengeParticipant.create({
      data: { challengeId, userId },
    });
    return { participant, alreadyJoined: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await prisma.challengeParticipant.findUnique({
        where: { challengeId_userId: { challengeId, userId } },
      });
      if (existing) {
        return { participant: existing, alreadyJoined: true };
      }
    }
    throw error;
  }
}

export async function leaveChallenge(
  challengeId: string,
  userId: string
): Promise<{ wasJoined: boolean }> {
  const result = await prisma.challengeParticipant.deleteMany({
    where: { challengeId, userId },
  });
  return { wasJoined: result.count > 0 };
}

export async function getParticipant(
  challengeId: string,
  userId: string
): Promise<ChallengeParticipant | null> {
  return prisma.challengeParticipant.findUnique({
    where: { challengeId_userId: { challengeId, userId } },
  });
}

/**
 * Maps the caller's own habit to one of the challenge's requirements.
 * Upsert on (participantId, requirementId): repeating with the same habit
 * is idempotent; a different habit replaces the previous mapping.
 */
export async function mapHabitToRequirement(input: {
  participantId: string;
  requirementId: string;
  habitId: string;
}): Promise<void> {
  await prisma.challengeParticipantHabit.upsert({
    where: {
      participantId_requirementId: {
        participantId: input.participantId,
        requirementId: input.requirementId,
      },
    },
    create: {
      participantId: input.participantId,
      requirementId: input.requirementId,
      habitId: input.habitId,
    },
    update: { habitId: input.habitId },
  });
}
