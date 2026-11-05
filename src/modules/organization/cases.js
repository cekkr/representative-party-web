import { randomUUID } from 'node:crypto';

import { evaluateAction } from '../circle/policy.js';
import { stampLocalEntry } from '../federation/replication.js';
import { sanitizeText } from '../../shared/utils/text.js';

export const CASE_VOICE_TYPES = {
  need: 'Fundamental need',
  concern: 'Constructive concern',
  advice: 'Advice & innovation',
  consultation: 'Resource consultation',
  dispute: 'Dispute',
};

export function canWorkWithCases(state, person) {
  return Boolean(person?.pidHash && evaluateAction(state, person, 'post').allowed);
}

// Discussions are provider-local today. Only attributed, validated posts from the
// shared discussion feed can supply a case. A case never widens its source's visibility.
export function isCaseSource(entry) {
  return Boolean(
    entry?.id && entry.content && entry.authorHash && entry.authorHash !== 'anonymous' &&
    !entry.groupId && !entry.parentId && !entry.petitionId &&
    entry.stance !== 'article' && entry.stance !== 'comment' &&
    (!entry.validationStatus || entry.validationStatus === 'validated')
  );
}

export function promoteCase(state, person, body) {
  const source = state.discussions.find((entry) => entry.id === body.sourceId);
  if (!isCaseSource(source)) return { status: 404, message: 'This discussion post is unavailable for case promotion.' };

  const existing = state.organizationCases.find((entry) => entry.sourceMessageId === source.id);
  if (existing) return { entry: existing };

  const summary = sanitizeText(body.summary, 120);
  const consequence = sanitizeText(body.consequence, 500);
  const voiceType = sanitizeText(body.voiceType, 24);
  if (!summary || !consequence || !Object.hasOwn(CASE_VOICE_TYPES, voiceType)) {
    return { status: 400, message: 'Enter a case summary and consequence, and choose a voice type.' };
  }

  const now = new Date().toISOString();
  const entry = stampLocalEntry(state, {
    caseId: randomUUID(),
    sourceMessageId: source.id,
    sourceChannel: 'discussion',
    voiceType,
    visibilityPolicy: 'attributed_provider_members',
    summary,
    consequence,
    scope: source.topicPath?.length ? [...source.topicPath] : [source.topic || 'General'],
    state: 'awaiting_acknowledgement',
    createdAt: now,
    updatedAt: now,
    reviewAt: null,
    createdBy: person.pidHash,
  });
  return { entry, cases: [entry, ...state.organizationCases] };
}

export function acknowledgeCase(state, person, body) {
  const existing = state.organizationCases.find((entry) => entry.caseId === body.caseId);
  if (!existing || !state.discussions.some((entry) => entry.id === existing.sourceMessageId && isCaseSource(entry))) {
    return { status: 404, message: 'This case is unavailable.' };
  }
  if (existing.acknowledgement) return { entry: existing };

  const note = sanitizeText(body.note, 500);
  const date = typeof body.reviewAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.reviewAt) && new Date(body.reviewAt);
  if (!note || !date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.reviewAt) {
    return { status: 400, message: 'Enter an acknowledgement and a valid review date.' };
  }

  const now = new Date().toISOString();
  const entry = {
    ...existing,
    state: 'acknowledged',
    updatedAt: now,
    reviewAt: body.reviewAt,
    acknowledgement: { note, actorHash: person.pidHash, at: now },
  };
  return { entry, cases: state.organizationCases.map((item) => item === existing ? entry : item) };
}
