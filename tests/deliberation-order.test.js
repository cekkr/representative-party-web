import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderForum } from '../src/interfaces/http/views/forumView.js';
import { renderPetitionList } from '../src/interfaces/http/views/petitionView.js';

// Scenario A (A2.8, A3.6/A3.9/A3.11): a reply must read after what it answers, a rebuttal
// must name the claim it builds on, and a revision must carry an @handle byline.

const state = {
  settings: {},
  sessions: [
    { id: 's1', pidHash: 'hash-sofia', handle: 'sofia.bianchi', status: 'verified', role: 'delegate' },
    { id: 's2', pidHash: 'hash-tommaso', handle: 'tommaso.ricci', status: 'verified', role: 'person' },
    { id: 's3', pidHash: 'hash-marco', handle: 'marco.deluca', status: 'verified', role: 'delegate' },
  ],
  topics: [],
};

test('forum replies read oldest-first inside a thread', () => {
  // Stored newest-first, as the controller unshifts every entry.
  const entries = [
    { id: 'c2', parentId: 't1', content: 'ANSWER: the difference is who can compel.', authorHash: 'hash-sofia', createdAt: '2026-09-28T10:02:00.000Z' },
    { id: 'c1', parentId: 't1', content: 'QUESTION: is the pact a whip by another name?', authorHash: 'hash-tommaso', createdAt: '2026-09-28T10:01:00.000Z' },
    { id: 't1', title: 'Why software cannot engineer around the free-mandate rule', content: 'Art. 67.', authorHash: 'hash-sofia', createdAt: '2026-09-28T10:00:00.000Z' },
  ];
  const { threads } = renderForum(entries, null, state);
  assert.ok(threads.indexOf('QUESTION') > 0, 'the question renders');
  assert.ok(threads.indexOf('QUESTION') < threads.indexOf('ANSWER'), 'the answer follows the question');
});

test('proposal discussion runs oldest-first, names the parent claim, and puts the form after the notes', () => {
  const petition = {
    id: 'p1',
    title: 'Conditional intramoenia',
    summary: 'A cap.',
    status: 'discussion',
    quorum: 6,
    authorHash: 'hash-sofia',
    createdAt: '2026-09-28T09:00:00.000Z',
    versions: [
      { title: 'Conditional intramoenia', summary: 'A cap.', note: 'Answers the concerns', authorHash: 'hash-marco', createdAt: '2026-09-28T09:30:00.000Z' },
      { title: 'Conditional intramoenia', summary: 'A cap.', note: 'Initial draft', authorHash: 'hash-sofia', createdAt: '2026-09-28T09:00:00.000Z' },
    ],
  };
  const comments = [
    { id: 'n2', petitionId: 'p1', stance: 'support', argumentParentId: 'n1', argumentTitle: 'Argument note', content: 'REBUTTAL: attaches to the existing platform.', authorHash: 'hash-marco', createdAt: '2026-09-28T10:02:00.000Z' },
    { id: 'n1', petitionId: 'p1', stance: 'concern', argumentTitle: 'Regional competence', content: 'OBJECTION: Title V.', authorHash: 'hash-sofia', createdAt: '2026-09-28T10:01:00.000Z' },
  ];
  const html = renderPetitionList([petition], [], [], null, false, new Map([['p1', comments]]), {
    state,
    allowEditing: true,
  });

  const list = html.slice(html.indexOf('class="discussion-list"'));
  assert.ok(list.indexOf('OBJECTION') < list.indexOf('REBUTTAL'), 'the rebuttal follows the objection');
  assert.match(html, /Builds on “Regional competence”/, 'a rebuttal names the claim, not a raw node id');
  assert.doesNotMatch(html, /Builds on n1/);
  assert.doesNotMatch(html, /Argument: Argument note/, 'the stored placeholder is not shown as a claim title');
  assert.ok(
    html.indexOf('class="discussion-list"') < html.indexOf('action="/petitions/comment"'),
    'the comment form sits after the notes it contributes to',
  );

  assert.match(html, /@marco\.deluca/, 'a revision byline resolves to the @handle');
  assert.equal((html.match(/Initial draft/g) || []).length, 1, 'the first revision says "Initial draft" once');
});

test('the ballot select starts on the member’s current vote, not on abstain', () => {
  const petition = { id: 'p2', title: 'Frozen', summary: 'Text.', status: 'vote', quorum: 1, authorHash: 'hash-sofia', createdAt: '2026-09-28T09:00:00.000Z' };
  const votes = [{ petitionId: 'p2', authorHash: 'hash-marco', choice: 'yes', createdAt: '2026-09-28T10:00:00.000Z' }];
  const person = { pidHash: 'hash-marco', role: 'delegate', verified: true };
  const html = renderPetitionList([petition], votes, [], person, false, new Map(), { state });
  const select = html.slice(html.indexOf('name="choice"'), html.indexOf('</select>', html.indexOf('name="choice"')));
  assert.match(select, /<option value="yes" selected>/);
  assert.doesNotMatch(select, /<option value="abstain" selected>/);
  assert.match(html, />Change vote</);
});
