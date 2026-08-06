import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DELEGATED_CHOICE,
  buildDelegatedBallot,
  buildPetitionVoteIndex,
  getDelegateVoteWindowDays,
  listBallotsAwaitingDelegate,
  listDelegatedBallotsForOwner,
  listOwnersFollowingDelegate,
  readDelegatedBallot,
  resolveVoteChoice,
  tallyVotes,
} from '../src/modules/delegation/delegatedBallots.js';
import { runMigrations } from '../src/infra/persistence/migrations.js';

const DAY_MS = 1000 * 60 * 60 * 24;
const NOW = Date.parse('2026-08-06T12:00:00.000Z');

function delegatedVote({ authorHash, delegateHash, petitionId = 'p1', deadlineDays = 5, at = NOW }) {
  return {
    petitionId,
    authorHash,
    choice: DELEGATED_CHOICE,
    createdAt: new Date(at).toISOString(),
    delegate: {
      hash: delegateHash,
      via: 'direct',
      topic: 'energy',
      at: new Date(at).toISOString(),
      deadline: deadlineDays === null ? null : new Date(at + deadlineDays * DAY_MS).toISOString(),
    },
  };
}

function directVote({ authorHash, choice, petitionId = 'p1' }) {
  return { petitionId, authorHash, choice, createdAt: new Date(NOW).toISOString() };
}

function stateWith(votes, petitions = [{ id: 'p1', title: 'Grid upgrade', status: 'vote', topic: 'Energy' }]) {
  return { votes, petitions, settings: {} };
}

function resolveFor(state, vote, now = NOW) {
  const byAuthor = buildPetitionVoteIndex(state.votes).get(vote.petitionId) || new Map();
  return resolveVoteChoice(state, vote, { byAuthor, now });
}

test('a delegated ballot resolves through the delegate\'s own vote', () => {
  const ballot = delegatedVote({ authorHash: 'owner', delegateHash: 'delegate' });
  const state = stateWith([ballot, directVote({ authorHash: 'delegate', choice: 'yes' })]);

  const resolution = resolveFor(state, ballot);
  assert.equal(resolution.status, 'resolved');
  assert.equal(resolution.choice, 'yes');
  assert.equal(resolution.resolvedByHash, 'delegate');
});

test('a delegated ballot follows the chain transitively to a terminal direct vote', () => {
  const ballot = delegatedVote({ authorHash: 'owner', delegateHash: 'first' });
  const state = stateWith([
    ballot,
    delegatedVote({ authorHash: 'first', delegateHash: 'second' }),
    directVote({ authorHash: 'second', choice: 'no' }),
  ]);

  const resolution = resolveFor(state, ballot);
  assert.equal(resolution.status, 'resolved');
  assert.equal(resolution.choice, 'no');
  assert.equal(resolution.resolvedByHash, 'second');
  assert.equal(resolution.hops, 1);
});

test('a delegated ballot is pending inside the window and is not counted as an abstention', () => {
  const ballot = delegatedVote({ authorHash: 'owner', delegateHash: 'delegate' });
  const state = stateWith([ballot]);

  const resolution = resolveFor(state, ballot, NOW + 2 * DAY_MS);
  assert.equal(resolution.status, 'pending');
  assert.equal(resolution.choice, null, 'a pending ballot has no choice yet');
  assert.equal(resolution.daysLeft, 3);
  assert.equal(resolution.awaitingHash, 'delegate');

  const tally = tallyVotes(state, state.votes, { now: NOW + 2 * DAY_MS }).get('p1');
  assert.equal(tally.pending, 1);
  assert.equal(tally.abstain, 0, 'an open ballot must not inflate the abstentions');
  assert.equal(tally.delegated, 1);
});

test('a delegated ballot lapses to abstain once the window closes', () => {
  const ballot = delegatedVote({ authorHash: 'owner', delegateHash: 'delegate' });
  const state = stateWith([ballot]);

  const resolution = resolveFor(state, ballot, NOW + 6 * DAY_MS);
  assert.equal(resolution.status, 'lapsed');
  assert.equal(resolution.choice, 'abstain');

  const tally = tallyVotes(state, state.votes, { now: NOW + 6 * DAY_MS }).get('p1');
  assert.equal(tally.abstain, 1);
  assert.equal(tally.lapsed, 1);
  assert.equal(tally.pending, 0);
});

test('a zero-day window means the ballot waits indefinitely instead of lapsing', () => {
  const ballot = delegatedVote({ authorHash: 'owner', delegateHash: 'delegate', deadlineDays: null });
  const state = stateWith([ballot]);

  const resolution = resolveFor(state, ballot, NOW + 400 * DAY_MS);
  assert.equal(resolution.status, 'pending');
  assert.equal(resolution.daysLeft, null);
});

test('a member overriding replaces the delegated ballot entirely', () => {
  const ballot = delegatedVote({ authorHash: 'owner', delegateHash: 'delegate' });
  const state = stateWith([ballot, directVote({ authorHash: 'delegate', choice: 'yes' })]);
  assert.equal(resolveFor(state, ballot).choice, 'yes');

  // The controller replaces the previous vote by the same author; do the same here.
  const override = directVote({ authorHash: 'owner', choice: 'no' });
  state.votes = [override, ...state.votes.filter((vote) => vote.authorHash !== 'owner')];

  const tally = tallyVotes(state, state.votes, { now: NOW }).get('p1');
  assert.equal(tally.no, 1);
  assert.equal(tally.yes, 1);
  assert.equal(tally.delegated, 0, 'the delegated ballot is gone once overridden');
});

test('a delegation cycle resolves to abstain instead of looping', () => {
  const ballot = delegatedVote({ authorHash: 'owner', delegateHash: 'a' });
  const state = stateWith([
    ballot,
    delegatedVote({ authorHash: 'a', delegateHash: 'b' }),
    delegatedVote({ authorHash: 'b', delegateHash: 'a' }),
  ]);

  const resolution = resolveFor(state, ballot);
  assert.equal(resolution.status, 'unresolved');
  assert.equal(resolution.reason, 'cycle');
  assert.equal(resolution.choice, 'abstain');

  const tally = tallyVotes(state, state.votes, { now: NOW }).get('p1');
  assert.equal(tally.unresolved, 3);
  assert.equal(tally.abstain, 3);
});

test('legacy delegate:<hash> votes still resolve', () => {
  const legacy = {
    petitionId: 'p1',
    authorHash: 'owner',
    choice: 'delegate:delegate-hash',
    createdAt: new Date(NOW).toISOString(),
  };
  const state = stateWith([legacy, directVote({ authorHash: 'delegate-hash', choice: 'yes' })]);

  assert.deepEqual(readDelegatedBallot(legacy)?.delegateHash, 'delegate-hash');
  const resolution = resolveFor(state, legacy);
  assert.equal(resolution.status, 'resolved');
  assert.equal(resolution.choice, 'yes');
});

test('migration 23 lifts legacy delegated votes into structured ballots without a retroactive deadline', () => {
  const { data } = runMigrations({
    data: {
      votes: [
        { petitionId: 'p1', authorHash: 'owner', choice: 'delegate:abc', createdAt: '2026-01-01T00:00:00.000Z' },
        { petitionId: 'p1', authorHash: 'other', choice: 'yes', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      settings: {},
    },
    meta: { schemaVersion: 22, migrations: [] },
  });

  assert.equal(data.votes[0].choice, 'delegate');
  assert.equal(data.votes[0].delegate.hash, 'abc');
  assert.equal(data.votes[0].delegate.deadline, null, 'a clock cannot be applied retroactively');
  assert.equal(data.votes[1].choice, 'yes', 'direct votes are untouched');
  assert.equal(data.settings.governance.delegateVoteWindowDays, 5);
});

test('the delegate inbox lists only ballots actually waiting on that delegate', () => {
  const state = stateWith(
    [
      delegatedVote({ authorHash: 'owner-a', delegateHash: 'delegate' }),
      delegatedVote({ authorHash: 'owner-b', delegateHash: 'someone-else' }),
      delegatedVote({ authorHash: 'owner-c', delegateHash: 'delegate', petitionId: 'p2' }),
    ],
    [
      { id: 'p1', title: 'Grid upgrade', status: 'vote' },
      { id: 'p2', title: 'Closed one', status: 'closed' },
    ],
  );

  const inbox = listBallotsAwaitingDelegate(state, 'delegate', { now: NOW });
  assert.equal(inbox.length, 1, 'closed proposals and other delegates are excluded');
  assert.equal(inbox[0].ownerHash, 'owner-a');
  assert.equal(inbox[0].petition.id, 'p1');
});

test('the inbox follows a chain to whoever it is actually stuck on', () => {
  const state = stateWith([
    delegatedVote({ authorHash: 'owner', delegateHash: 'first' }),
    delegatedVote({ authorHash: 'first', delegateHash: 'second' }),
  ]);

  assert.equal(listBallotsAwaitingDelegate(state, 'first', { now: NOW }).length, 0);
  const stuckOnSecond = listBallotsAwaitingDelegate(state, 'second', { now: NOW });
  assert.equal(stuckOnSecond.length, 2, 'both the owner and the first delegate are waiting on the terminal delegate');
});

test('a member sees the ballots they delegated with their resolution', () => {
  const state = stateWith([
    delegatedVote({ authorHash: 'owner', delegateHash: 'delegate' }),
    directVote({ authorHash: 'delegate', choice: 'no' }),
  ]);

  const rows = listDelegatedBallotsForOwner(state, 'owner', { now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].resolution.status, 'resolved');
  assert.equal(rows[0].resolution.choice, 'no');
  assert.equal(rows[0].open, true);
});

test('followers of a delegate are read before their vote lands, so they can be notified', () => {
  const state = stateWith([delegatedVote({ authorHash: 'owner', delegateHash: 'delegate' })]);

  const followers = listOwnersFollowingDelegate(state, { petitionId: 'p1', delegateHash: 'delegate', now: NOW });
  assert.deepEqual(followers.map((entry) => entry.ownerHash), ['owner']);
});

test('the delegate vote window reads from governance settings and defaults to 5 days', () => {
  assert.equal(getDelegateVoteWindowDays({ settings: {} }), 5);
  assert.equal(getDelegateVoteWindowDays({ settings: { governance: { delegateVoteWindowDays: 12 } } }), 12);
  assert.equal(
    getDelegateVoteWindowDays({ settings: { governance: { delegateVoteWindowDays: 0 } } }),
    0,
    '0 disables the deadline',
  );
});

test('buildDelegatedBallot stamps the deadline from the window', () => {
  const ballot = buildDelegatedBallot({ delegateHash: 'd', windowDays: 5, now: NOW });
  assert.equal(ballot.hash, 'd');
  assert.equal(Date.parse(ballot.deadline) - NOW, 5 * DAY_MS);

  const openEnded = buildDelegatedBallot({ delegateHash: 'd', windowDays: 0, now: NOW });
  assert.equal(openEnded.deadline, null);
});
