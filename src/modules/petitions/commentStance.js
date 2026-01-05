const COMMENT_STANCES = [
  { value: 'support', label: 'Support' },
  { value: 'concern', label: 'Concern' },
  { value: 'question', label: 'Question' },
  { value: 'comment', label: 'General note' },
];

const STANCE_ALIASES = new Map([
  ['support', 'support'],
  ['pro', 'support'],
  ['for', 'support'],
  ['agree', 'support'],
  ['concern', 'concern'],
  ['con', 'concern'],
  ['against', 'concern'],
  ['oppose', 'concern'],
  ['question', 'question'],
  ['ask', 'question'],
  ['comment', 'comment'],
  ['note', 'comment'],
  ['neutral', 'comment'],
  ['info', 'comment'],
]);

const STANCE_LABELS = {
  support: 'Support',
  concern: 'Concern',
  question: 'Question',
  comment: 'Note',
};

export function listCommentStances() {
  return COMMENT_STANCES.slice();
}

export function normalizeCommentStance(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return STANCE_ALIASES.get(normalized) || 'comment';
}

export function getCommentStanceLabel(value) {
  const normalized = normalizeCommentStance(value);
  return STANCE_LABELS[normalized] || STANCE_LABELS.comment;
}
