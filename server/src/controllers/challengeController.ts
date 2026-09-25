import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { startOfUtcDay } from '../utils/date.js';
import { findUserHabit } from '../services/prismaHabitService.js';
import {
  ChallengeDeleteData,
  ChallengeListData,
  JoinChallengeData,
  LeaveChallengeData,
  MapChallengeHabitData,
  ChallengeData,
} from '../types/challenge.js';
import {
  CreateChallengeInput,
  ListChallengesQuery,
  UpdateChallengeInput,
} from '../schemas/challengeSchemas.js';
import {
  ChallengeWithRequirements,
  computeProgressForChallenges,
  createChallenge,
  deleteChallenge,
  findChallenge,
  getParticipant,
  joinChallenge,
  leaveChallenge,
  listChallenges,
  loadParticipations,
  mapHabitToRequirement,
  toChallengeData,
  updateChallenge,
} from '../services/prismaChallengeService.js';

async function requireChallenge(id: string): Promise<ChallengeWithRequirements> {
  const challenge = await findChallenge(id);
  if (!challenge) {
    throw new AppError(
      'Challenge not found',
      404,
      undefined,
      ApiErrorCodes.CHALLENGE_NOT_FOUND
    );
  }
  return challenge;
}

/**
 * Participation window (UTC calendar semantics): the challenge must be
 * active and today must fall within [startDate, endDate], inclusive.
 */
function assertJoinWindow(challenge: ChallengeWithRequirements, today: Date): void {
  const start = startOfUtcDay(challenge.startDate);
  const end = startOfUtcDay(challenge.endDate);

  if (today.getTime() < start.getTime()) {
    throw new AppError(
      'Challenge has not started yet',
      400,
      undefined,
      ApiErrorCodes.CHALLENGE_NOT_STARTED
    );
  }
  if (today.getTime() > end.getTime()) {
    throw new AppError(
      'Challenge has ended',
      400,
      undefined,
      ApiErrorCodes.CHALLENGE_ENDED
    );
  }
  if (!challenge.isActive) {
    throw new AppError(
      'Challenge is not active',
      400,
      undefined,
      ApiErrorCodes.CHALLENGE_INACTIVE
    );
  }
}

async function buildChallengeData(
  challenge: ChallengeWithRequirements,
  userId: string
): Promise<ChallengeData> {
  const participations = await loadParticipations(userId, [challenge.id]);
  const participant = participations.get(challenge.id) ?? null;
  let progress = null;
  if (participant) {
    progress =
      (await computeProgressForChallenges([challenge], participations)).get(
        challenge.id
      ) ?? null;
  }
  return toChallengeData(challenge, participant, progress);
}

export async function listChallengesHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as ListChallengesQuery;
  const result = await listChallenges(userId, query);

  const challenges = result.challenges.map((challenge) =>
    toChallengeData(
      challenge,
      result.participations.get(challenge.id) ?? null,
      result.progress?.get(challenge.id) ?? null
    )
  );

  const data: ChallengeListData = {
    challenges,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    activeCount: result.activeCount,
    joinedCount: result.joinedCount,
  };

  res.json({ success: true, data });
}

export async function createChallengeHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const body = req.body as CreateChallengeInput;
  const challenge = await createChallenge(body);

  const data = await buildChallengeData(challenge, userId);
  res.status(201).json({ success: true, data: { challenge: data } });
}

export async function getChallengeHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const challenge = await requireChallenge(id);

  const data = await buildChallengeData(challenge, userId);
  res.json({ success: true, data: { challenge: data } });
}

export async function updateChallengeHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const challenge = await requireChallenge(id);

  const body = req.body as UpdateChallengeInput;
  const startDate = body.startDate ?? challenge.startDate;
  const endDate = body.endDate ?? challenge.endDate;
  if (endDate.getTime() < startDate.getTime()) {
    throw new AppError('End date must be on or after start date', 400, {
      'body.endDate': ['End date must be on or after start date'],
    });
  }

  const updated = await updateChallenge(challenge, body);
  const data = await buildChallengeData(updated, userId);
  res.json({ success: true, data: { challenge: data } });
}

export async function deleteChallengeHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const { id } = req.params as { id: string };
  const challenge = await requireChallenge(id);

  await deleteChallenge(challenge.id);
  const data: ChallengeDeleteData = { message: 'Challenge deleted' };
  res.json({ success: true, data });
}

export async function joinChallengeHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const challenge = await requireChallenge(id);

  assertJoinWindow(challenge, startOfUtcDay(new Date()));

  const { alreadyJoined } = await joinChallenge(challenge.id, userId);
  const data: JoinChallengeData = {
    challengeId: challenge.id,
    joined: true,
    alreadyJoined,
  };
  res.status(alreadyJoined ? 200 : 201).json({ success: true, data });
}

export async function leaveChallengeHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const challenge = await requireChallenge(id);

  const { wasJoined } = await leaveChallenge(challenge.id, userId);
  const data: LeaveChallengeData = {
    challengeId: challenge.id,
    left: true,
    wasJoined,
  };
  res.json({ success: true, data });
}

export async function getChallengeProgressHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const challenge = await requireChallenge(id);

  const participations = await loadParticipations(userId, [challenge.id]);
  if (!participations.has(challenge.id)) {
    throw new AppError(
      'You have not joined this challenge',
      400,
      undefined,
      ApiErrorCodes.CHALLENGE_NOT_JOINED
    );
  }

  const progress =
    (await computeProgressForChallenges([challenge], participations)).get(
      challenge.id
    ) ?? null;
  if (!progress) {
    throw new AppError(
      'You have not joined this challenge',
      400,
      undefined,
      ApiErrorCodes.CHALLENGE_NOT_JOINED
    );
  }

  res.json({ success: true, data: progress });
}

export async function mapRequirementHabitHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id, requirementId } = req.params as {
    id: string;
    requirementId: string;
  };
  const challenge = await requireChallenge(id);

  const requirement = challenge.requirements.find(
    (candidate) => candidate.id === requirementId
  );
  if (!requirement) {
    throw new AppError(
      'Challenge requirement not found',
      404,
      undefined,
      ApiErrorCodes.CHALLENGE_NOT_FOUND
    );
  }

  const participant = await getParticipant(challenge.id, userId);
  if (!participant) {
    throw new AppError(
      'You have not joined this challenge',
      400,
      undefined,
      ApiErrorCodes.CHALLENGE_NOT_JOINED
    );
  }

  const body = req.body as { habitId: string };
  const habit = await findUserHabit(body.habitId, userId);
  if (!habit) {
    throw new AppError(
      'Habit not found',
      404,
      undefined,
      ApiErrorCodes.CHALLENGE_HABIT_NOT_FOUND
    );
  }
  if (!habit.isActive) {
    throw new AppError(
      'Habit is not active',
      400,
      undefined,
      ApiErrorCodes.CHALLENGE_HABIT_MISMATCH
    );
  }
  if (habit.frequency !== requirement.frequency) {
    throw new AppError(
      'Habit frequency does not match the challenge requirement',
      400,
      undefined,
      ApiErrorCodes.CHALLENGE_HABIT_MISMATCH
    );
  }
  const overlapsChallenge =
    habit.startDate.getTime() <= startOfUtcDay(challenge.endDate).getTime() &&
    (habit.endDate === null ||
      habit.endDate.getTime() >= startOfUtcDay(challenge.startDate).getTime());
  if (!overlapsChallenge) {
    throw new AppError(
      'Habit dates do not overlap the challenge period',
      400,
      undefined,
      ApiErrorCodes.CHALLENGE_HABIT_MISMATCH
    );
  }

  await mapHabitToRequirement({
    participantId: participant.id,
    requirementId: requirement.id,
    habitId: habit.id,
  });

  const data: MapChallengeHabitData = {
    mapping: { requirementId: requirement.id, habitId: habit.id },
  };
  res.json({ success: true, data });
}
