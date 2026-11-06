# UI Roadmap

Citizen OS is the design reference for the Web Organization Framework. Follow its
division into an application shell, browseable collections, focused workspaces,
and task-specific forms. Use its visual hierarchy to make it obvious where to read,
where to act, and which details belong to the current record. The framework's
communication kernel remains useful with Discussion, Forum, and Notifications alone.
Optional modules add destinations and actions according to their existing gates.

**Current** means the behavior and HTML already shipped. **Target** describes work
to implement. The product roadmap owns feature sequencing, and the agent handbook
owns implementation invariants. [Product roadmap](ROADMAP.md) · [AGENTS.md](AGENTS.md)

## Reference checkout

The [pinned Citizen OS frontend](https://github.com/citizenos/citizenos-fe/tree/36e44a5c22651586b39b72d5b2a6c971b0236cb5)
lives in `thirds/citizenos-fe`. The links below point to templates and styles in
that checkout. Refresh the source references when updating the pin.

```sh
git submodule update --init -- thirds/citizenos-fe
```

Use the source to inspect element order, layout variants, component states, and
styling. Implement those patterns in the framework's SSR templates, shared view
helpers, `app.css`, and optional `app.js` enhancements. Upstream Angular, APIs,
assets, and CSS stay outside our build and runtime. Review upstream license terms
before proposing any direct reuse.

| Upstream reference | Pattern to follow |
| --- | --- |
| [App root](thirds/citizenos-fe/src/app/app.component.html), [desktop nav](thirds/citizenos-fe/src/app/core/components/nav/nav.component.html), [mobile nav](thirds/citizenos-fe/src/app/core/components/nav-mobile/nav-mobile.component.html) | One shell around changing route content. Create, personal work, discovery, and account utilities have different positions. Phone navigation emphasizes frequent destinations and separates contextual actions. |
| [Dashboard](thirds/citizenos-fe/src/app/core/components/dashboard/dashboard.component.html), [My Topics](thirds/citizenos-fe/src/app/my-topics/my-topics.component.html), [topic card](thirds/citizenos-fe/src/app/public-topics/components/topicbox/topicbox.component.html) | Short collections with headings and View all links on Home. The full list adds search and filters. Cards have a linked title, compact context, and a separate activity footer. |
| [Topic workspace](thirds/citizenos-fe/src/app/topic/topic.component.html), [topic tabs](thirds/citizenos-fe/src/app/topic/components/topic-tabs/topic-tabs.component.html), [group workspace](thirds/citizenos-fe/src/app/group/group.component.html) | Stable record context, a narrow section switcher, one active task, and separate supporting information. A group keeps its identity and visibility above its Topics and Members views. |
| [Arguments](thirds/citizenos-fe/src/app/topic/components/topic-arguments/topic-arguments.component.html), [argument card](thirds/citizenos-fe/src/app/topic/components/argument/argument.component.html), [argument form](thirds/citizenos-fe/src/app/topic/components/post-argument/post-argument.component.html) | Discussion header and filters precede typed, authored entries. Replies stay with their parent. The form asks for the kind of contribution, then subject and text. |
| [Ballot](thirds/citizenos-fe/src/app/topic/components/topic-vote-cast/topic-vote-cast.component.html), [activity](thirds/citizenos-fe/src/app/core/components/activity-feed/activity-feed.component.html) | Deadline and voting context, an editable ballot or a readback, then outcomes where available. Activity can be tied to a specific group or topic. |

## 1. Shell, navigation, and page header

**Current.** The shell has a skip link to one main landmark, a compact status
strip, and a grouped 200 px desktop rail with jump search. At 900 px and below,
the topbar shows the current location, frequent actions, and a native Menu
disclosure. The same gated navigation model feeds both layouts. Home and
Discussion have persistent page headings and contextual actions. Enhanced
navigation updates the shell and focuses the destination heading or anchor.
[Shell template](src/modules/core/templates/partials/shell.html) ·
[Navigation model](src/interfaces/http/views/navigation.js)

**Target.** Keep a single gated navigation model and give it the organization of
Citizen OS. A desktop rail starts with deployment identity and a contextual Create
entry, followed by grouped work destinations and then profile and operator utilities.
Group destinations by the work a member recognizes, with Conversation, Organization,
Civic governance, and Federation/operations where enabled. Keep Discussion, Forum,
and Notifications easy to find regardless of civic configuration. The current
destination uses a visible label and `aria-current="page"`, with keyboard jump
search as a second way to reach destinations and existing anchors.

On phones, put the deployment label, current location, and navigation disclosure
in a compact top row. Surface only the high-frequency actions that fit there,
such as Inbox and a route-specific Create link. The disclosure exposes the full
gated navigation in normal focus order. Use a labelled native disclosure or a
button with an associated region. The links remain reachable with JavaScript off.
Reuse the same account, module, and role filtering for every entry point.

The shell owns skip-to-content, one main landmark, and a compact status surface.
Retain Circle enforcement, validation/preview, handle, ledger/actor/discussion
counts, and gossip ingest. The route owns the following order inside main.

1. Optional backlink or lineage breadcrumb.
2. One `<h1>`, with scope, visibility, or lifecycle state where it changes the
   meaning of the page.
3. One primary action for the current task and viewer, then secondary actions in
   a short row or labelled disclosure. Create links jump to or open the existing
   compose form.
4. Section links or filters when needed, followed by the selected content.
   Secondary context follows content in source order.

Keep the `.page-grid`, `.page-main`, and `.page-aside` contract. The shell's
available inline width determines when the aside stacks beneath the content.
Keep the existing 700 px `shell-main` container rule and viewport fallback until
a replacement passes the same reachability checks. Use normal page scroll. A
fixed-height affordance can pin itself, and the expanded compose form scrolls
with the document. Use `minmax(0, 1fr)` for flexible columns and wrap long titles,
handles, and evidence URLs. Avoid CSS order changes that put keyboard focus in a
different sequence from the visible layout. [Current grid](src/public/app.css) ·
[Compose reachability test](tests/ui.test.js)

## 2. Home, collections, and discovery

**Current.** Home leads with its workspace heading and real conversation
previews, followed by enabled work lanes and supporting context. Circle-wide
discussion and proposal previews exclude group lanes. Discussion puts its
scope and Create action before the feed, with a native disclosure for searching
text and evidence and filtering a topic subtree. The compose form stays in the
supporting rail. Home and Discussion link to individual contributions, where
the stored lane controls access and the return link restores the search and page.
Social places follow filters above updates and shows the audience at the point of
sending. Forum has searchable article rows,
a category field in the compose rail, and a focused reading view linked directly
from Home and the results. Search and page survive opening an article, replying,
and returning to the collection. [Home partials](src/modules/home/templates/partials) ·
[Discussion partials](src/modules/discussion/templates/partials) ·
[Forum templates](src/modules/forum/templates)

**Target.** Follow Citizen OS's collection pattern. Home begins with a short
workspace header, then small named collections with a few real entries and a
link to the full destination. Use Conversation first and enabled group or civic
work next. Each entry has a stable link. Use a meaningful first-use action when
there is no activity. Keep diagnostics compact and below the member's work.

A full collection reads **title and scope → available create action → search,
filters and active selections → result list → pagination**. Use native GET
forms and carry the active query and group through paging, refresh, and browser
Back. Use compact filter disclosure on phones. Distinguish the empty workspace
from zero matches and offer a different recovery for each. Give cards a common
reading order with a title link, state and scope text, a short excerpt when
useful, and a footer for activity and counts.

| Collection | Layout and entry anatomy |
| --- | --- |
| Home, proposal browse, People, and group browse | A grid of summary cards when their titles and metadata fit. Use two or three columns only where the container has room, and one column on phones. Each card has one title link. Secondary actions are separate controls. |
| Discussion and Forum | Single-column feed or row list, newest thread first. Title or content preview, shared avatar and byline, date, topic, and meaningful state. Place reply/activity counts on the trailing edge when there is room. |
| Social | Single-column wall. Byline, audience and time, body and media, then item actions. Keep locked media and request/report controls adjacent to the media. Show destination beside Send. |
| Notifications and delegate work queues | One readable row per event or task. Lead with what happened or needs action, then record link, scope, time/deadline, and a text cue for unread or pending. Return to the same place after marking a row read. |

Keep filters that change collection membership near the result list. The rail
holds supporting topics, follows, or short compose controls. An expanded,
multi-section create/edit task can use the normal main flow with a return
link to its collection. Member-facing seeded pages use real Scenario A content
for every displayed count and card.

Use a list even when cards render as a grid. Each item has one title link and
an independent footer. This is the proposal variant of the collection card.

```html
<ul class="collection-grid">
  <li>
    <article class="record-card">
      <header>
        <p class="record-stage">Open for deliberation</p>
        <h2><a href="/petitions?proposal=42">Conditional intramoenia</a></h2>
        <p>Healthcare / Waiting lists</p>
      </header>
      <!-- Short description or evidence summary -->
      <footer><!-- Attributed activity and permitted counts --></footer>
    </article>
  </li>
</ul>
```

## 3. Focused workspaces

Citizen OS separates the topic's identity and context from its selected work area.
Use that hierarchy for a proposal and a group first. A workspace has a stable
header, a labelled navigation strip, a selected content area, and optional
supporting facts. At narrow widths the same sections are reachable from wrapping
links. Keep the action and facts needed to complete the selected task in its main
content. Place additional context after it or in an ordinary disclosure.

Treat navigation and lifecycle as separate data. A member may read Discussion
while the proposal is in Voting. Render the current view using a labelled
`<nav>` and `aria-current="page"` on its selected GET link. Render stage as text in
the persistent header. Use a fragment for movement within a document. Use a GET
view when switching the server-rendered workspace. Browser Back restores the
previous view and scope. Keep existing anchor links and bookmarks working.

### Proposals

**Current.** `/petitions` is a stage-filtered, paginated collection of summary
cards with an attributed deliberation feed. Its title links open
`/petitions?proposal=<id>` with Overview, Discussion, History, and Ballot
available as server-rendered sections. The links carry the collection stage and
page, and a group proposal's URL carries its current lane. The stored lane and
replication visibility gate every read before rendering or redirecting. Old
scoped URLs for moved records resolve to the current lane for authorized
readers. The collection retains each card's original `#petition-<id>` anchor.

Overview contains the proposal outline, evidence, quorum progress, and eligible
signing, revision, moderation, and promotion actions. Discussion contains
oldest-first contributions, parent-claim links, and the argument map. History
links the exact frozen revision to its ballot. Ballot separates the frozen text,
personal choice or delegation state, and outcome. Moderation and quorum-driven
voting both record a frozen snapshot. Legacy ballots can identify that a
snapshot is unavailable. Successful writes return to the applicable record
view. Public lanes allow outsiders to browse, with membership required for
participation.
[Controller](src/modules/petitions/http/petitions.js) ·
[Workspace template](src/modules/petitions/templates/petition-workspace.html) ·
[Proposal view](src/interfaces/http/views/petitionView.js)

**Target.** Add richer discussion filters, field-level recovery for ordinary HTML
forms, and more explicit timing and delegation context in Ballot as the
underlying workflow supports it. Keep these region contracts.

| Region | Required order and contents |
| --- | --- |
| Persistent header | Back to scoped proposals → topic breadcrumb → title → Circle/group and visibility → actual stage → one eligible next action. Show a compact primary cue for quorum, open discussion, ballot status, or outcome as applicable. |
| Overview | Summary → problem, proposed action, impact, risks, and implementation → canonical evidence → quorum progress and eligible signing action → link to history. |
| Discussion | Deliberation state and any explanatory notice → compact stance/filter summary → oldest-first notes and argument branches → contribution form when allowed. |
| History | Attributed revisions and meaningful diffs → selected/frozen revision metadata → link to the corresponding evidence or ballot. |
| Ballot | Frozen text or exact revision link and deadline if set → personal ballot state and eligible action → aggregate result when permitted. |
| Details rail | Author/date, topic, group scope, provenance, and supporting links. Keep relevant ballot/delegation facts inside the Ballot view too. |

Use the existing draft, deliberation, vote, and terminal states when selecting
visible links and actions. Use a status explanation for an unavailable task
where members benefit from understanding its prerequisite. Authority to sign,
edit, moderate, freeze, or vote comes from the server's existing gates. Scenario A
should make it easy to see why a proposal moved from the first draft, through a
reply-driven revision, to the exact text put to a vote.

Illustrative SSR structure for a selected view. The shell supplies main and the
status strip. Reuse the existing opt-in key on the corresponding logical panel.

```html
<header class="workspace-heading">
  <a href="/petitions">Back to proposals</a>
  <p>Healthcare / Waiting lists</p>
  <h1>Conditional intramoenia</h1>
  <p>Circle proposal · Open for deliberation</p>
  <a href="#proposal-comment">Add a contribution</a>
</header>
<nav aria-label="Proposal sections">
  <a href="?proposal=42&amp;view=overview">Overview</a>
  <a href="?proposal=42&amp;view=discussion" aria-current="page">Discussion</a>
  <a href="?proposal=42&amp;view=history">History</a>
</nav>
<div class="page-grid">
  <div class="page-main">
    <section class="panel" id="petitions-discussion"
             aria-labelledby="proposal-discussion-title"
             data-composer-section="petitions-discussion"
             data-section-label="Proposal discussion">
      <h2 id="proposal-discussion-title">Deliberation</h2>
      <!-- Chronological notes and reply branches -->
      <form id="proposal-comment" method="post" action="/petitions/comment">
        <input type="hidden" name="petitionId" value="42">
        <!-- Stance, related claim, and evidence fields -->
        <label for="comment-content">Contribution</label>
        <textarea id="comment-content" name="content" required></textarea>
        <button type="submit">Post contribution</button>
      </form>
    </section>
  </div>
  <aside class="page-aside" aria-label="Proposal details">
    <!-- Authorship, scope, and supporting links -->
  </aside>
</div>
```

### Groups

**Current.** `/groups` lists linked group summaries in branch order and a
linked category directory. Open `/groups?group=<id>` for the group heading,
parent lineage, membership, lane visibility, and an eligible join or leave action.
Overview links to readable, enabled Discussion and Proposals lanes and to child
groups. Members shows the roster to group members and eligible managers. Decisions
shows delegate elections and preferred delegates, with voting and election
management gated separately. Group admins and eligible Circle moderators can open
Settings. Group form submissions redirect to the relevant section in both HTML
flows. The source lane names the destination before a promotion is approved.
[Browse template](src/modules/groups/templates/groups.html) ·
[Workspace template](src/modules/groups/templates/group-workspace.html) ·
[Scope resolver](src/modules/groups/groupScope.js)

**Target.** Add search and pagination when the group directory needs them, and
make the decision context easier to scan as more elections accumulate. Keep
contextual promotion requests in the source lane. Group lineage describes
structure. Membership and authority are checked independently for each group.

### Other record pages

**Current.** `/delegates` has a People heading, a GET search above the results,
and a grid of person cards with one `@handle` title link, role, and delegation
count. A search with no matches offers a way back to everyone. An empty
directory explains how members appear. `/delegates/<hash>` opens a record with
avatar, `@handle` and hash cue, role and status, bio, and one primary action:
Delegate to the member, or Edit your profile for your own record. Delegate
pre-fills the existing form at `/delegation#delegation-set`, which still
resolves and gates the target on POST. Overview, Delegations, Votes, Activity,
and Endorsements are GET views with `aria-current`. Activity lists only
proposals the viewer could open, linked to their record. Counts use the same
lane check. Endorsements link group names and label recommendations and
elections as advisory. The deliberation score sits in a disclosure. A Details
rail carries role, status, last activity, and endorsement counts.

`/governance` leads with its heading and a primary Propose a change action.
Unverified visitors see the verification path. Section links jump to Current
rules, Change proposals, and Decisions. Current rules are a term/value grid
with units. Each open proposal shows its byline and reason, then a table of
the current rule beside the proposed value. Each decision names proposer and
decider with a semantic date. An approved change shows its Before and After
values, and an approved or rejected decision has a coloured edge plus its
text label.

`/organization` leads with a Cases heading and a link to the labelled preview.
The selected case has a record header with state, voice type, review date, and
an attributed opening. The original message follows under its own heading.
Acknowledgement is either the form or an ordered history of opening and
acknowledgement. The searchable queue sits in the rail.
[People controller](src/modules/delegates/http/delegates.js) ·
[Governance controller](src/modules/governance/http/governance.js) ·
[Case view](src/modules/organization/caseView.js)

`/organization?view=preview` opens with a Back to live cases link and an
Organization workspace preview heading. A Preview label, the line
“Illustrative data — nothing here is saved”, and an Open the live case queue
action sit in that persistent header, outside the optional panels, so hiding
sections cannot make the preview look live.

**Target.** Add pagination to People when a directory outgrows one page. Give
governance proposals their own focused record view when member ratification
lands. Give the organization case a dedicated record URL with history beyond
acknowledgement as the lazy layer stores arrive. Replace the preview's
illustrative cases with Scenario B examples.

### Settings and task pages

**Current.** `/profile` follows the People record header: avatar, `@handle`,
role and Verified state, and one View your public profile action when People
is enabled. A guest sees a Profile heading and the Verify action instead of
empty forms. Fragment links reach three labelled sections: Public handle,
Provider-local fields, and Interface defaults. Each form posts to
`/profile#<section>`, so the ordinary and enhanced flows both return to the
section they changed. A confirmation is a `role="status"` line and a rejection
is a `role="alert"` summary with an id. The handle input and provider fields
reference their hint and error through `aria-describedby` and keep the typed
value. The Session rail shows the handle, role, an 8-character hash cue,
verification date, and Circle enforcement, never the full blinded hash.
[Profile controller](src/modules/profile/http/profile.js) ·
[Form feedback](src/interfaces/http/views/formFeedback.js)

The wallet handoff is a single reading column: heading, numbered steps, the
Open wallet link with its copyable fallback, then the QR. The link comes first
in source order because a phone cannot scan its own screen. The Hash-only
guarantee and Circle policy follow, then Refresh this request (same pending
session) and Start a new request. The result page reads You are verified,
offers Choose your handle first, shows only the hash cue that was stored, and
links Social only when that module is on. A failed callback explains what
happened and offers Start a new verification.
[Auth templates](src/modules/auth/templates) ·
[Recovery page](src/modules/core/templates/error.html)

**Target.** Apply the same section header and inline feedback to admin
settings. Add a translated wallet-not-installed hint once the verifier reports
that state.


## 4. Participation, ballots, and activity

### Contributions and replies

Follow the Citizen OS discussion panel with a tinted heading, a short state
summary, and the list immediately below. Put the first available action in the
header as a jump link. Read discussion notes and replies oldest-first, with the
form after the notes. A note or argument has a stable id and the following order.

1. Shared avatar, `@handle`, short blinded-hash cue, and semantic
   `<time datetime="…">`. Show a small Edited link when there is an attributable
   edit history. Use deterministic `dd/mm/yyyy` display in Scenario A.
2. Labelled stance and a short heading when supplied. Use “In reply to” with
   the parent claim's title or excerpt and a link to that claim.
3. Claim text and its evidence. Keep links close to the text they support.
4. Permalink, reply action, and eligible item actions. Keep expanded replies
   with their parent in a nested list and cap visual indentation on phones.

Citizen OS uses different alignments for pro and con. Use aligned cards with a
quiet edge or tint and a visible stance label, so chronology and relationships
stay readable when the cards stack. Keep the argument map as another way to read
the same deliberation. Present reactions and stance counts as discussion
signals. Use the shared actor, evidence, topic, and provenance renderers.
[Argument styling](thirds/citizenos-fe/src/assets/styles/_arguments.scss) ·
[Shared view helpers](src/interfaces/http/views/shared.js)

Use the upstream form's progression from contribution type to text. Group
existing stance choices in a labelled `<fieldset>` where appropriate, then show
the claim title, response text, related claim, and evidence fields that the
current task supports. Show the destination before Submit. If a submission is
rejected, preserve safe inputs and associate the error with the field or the
form summary. Closed discussion is a readable state with a reason.

### Ballot states

Use Citizen OS's separate casting, submitted, and outcome blocks as the
presentation model. A single ballot workspace keeps the proposal title,
frozen revision, and timing context above the applicable personal state.
A separately labelled outcome block uses the existing tally and its visibility
policy. A chart may accompany exact counts and accessible labels.

| Member's state | Personal block and action |
| --- | --- |
| Voting open, eligible, no existing choice | Explain the decision and show the existing ballot choices as labelled native controls. Show when a delegation would apply. |
| Direct vote recorded | Read back the actual vote. Where a change is allowed, preselect the current choice in the edit form. |
| Delegated and pending | Show the named holder, matching topic and deadline if any, with the direct override available under the existing policy. Keep pending outside yes, no, and abstain. |
| Delegated and resolved | Explain the chain and resulting choice or lapse. Apply the shared ballot resolution, including the rules for an unresolvable or lapsed ballot. |
| Voting closed or member ineligible | Show the reason and the outcome or next step the viewer is allowed to see. Render read-only state without actionable ballot controls. |

Keep the signed ballot envelope, validation, and tally logic in the domain
layer. Distinguish a recommendation from a delegated ballot and a pending
delegated ballot from a counted abstention. Read back an override from the
server and give the member a link to the same record after the POST.
[Vote template reference](thirds/citizenos-fe/src/app/topic/components/topic-vote-cast/topic-vote-cast.component.html) ·
[Ballot resolution](src/modules/delegation/delegatedBallots.js)

### Activity and recovery

**Current.** Notifications uses paginated activity rows with a timestamp,
explicit unread cue, permitted proposal links, and local preferences. Mark all
read returns to the same inbox page. Proposal activity opens the appropriate
Discussion, Ballot, or Overview view through the same scope gate. A notification
can remain readable after its source becomes inaccessible. Its proposal
details and link are withheld. Delegation queues use the same access gate and
link to the exact Ballot. **Target.** Extend record resolution to non-proposal
activity and add scoped labels where the source supports them.
[Activity row reference](thirds/citizenos-fe/src/app/shared/components/activity/activity.component.html) ·
[Notification controller](src/modules/notifications/http/notifications.js)

| Interaction | SSR and enhanced behavior |
| --- | --- |
| Switch views or filter | Use a real link or GET form. Keep ordinary navigation, history, and link behavior. Keep selected view, current scope, and active filters visible. On a partial swap, focus the destination heading or requested anchor. |
| Submit a change | Use a real POST form with the clicked button's name and value, including `event.submitter` in enhancement. Show progress without obscuring context and prevent repeated activation while pending. |
| Mutation succeeds | Return the canonical GET location, with permitted scope and an item anchor as applicable. Full and partial flows resolve to the same page. Keep focus at the changed record or confirmation. |
| Validation or transport failure | Keep safe entered values and explain how to recover. If the write outcome is uncertain, check the record through GET before offering a retry. Announce errors and keep them beside the relevant controls. |
| Sign-in required, forbidden, or module off | Render the applicable server gate and a safe next action. Keep permission and lane checks authoritative for reads and writes. |

Keep `data-partial` and enhanced HTML navigation scoped to HTML destinations.
Use `<button>` for mutations and disclosures, `<a href>` for destinations,
and `<details>` for optional context where it fits. Handle focus and expanded
state when a disclosure is enhanced. The accessible result should be available
with the ordinary server-rendered link or form. [Browser enhancements](src/public/app.js) ·
[Module gates](src/interfaces/http/views/moduleGate.js)

## 5. Visual system

**Current.** The shared shell and pilot pages use the revised slate and blue
tokens, a pale light canvas with white panels, stepped dark surfaces, 16 px
panel corners, and solid and outlined action treatments. The context rail
defaults to 288 px where the available width permits two columns. The existing
theme, accent, and density preferences apply to the new foundations.

Use Citizen OS's pale canvas, white working panels, slate text, and blue links
as the target for the light palette. Use the same relationships in dark mode
with a cool dark canvas, stepped surfaces, legible blue links, and restrained
borders. Work within the framework's existing accent, theme, and density
preferences. Use the existing blue preset for reference captures, and check
the default accent and other presets as part of the change.

The values below describe the pinned reference and a starting point for
implementation. Express the target using semantic tokens and verify the
rendered result in both themes.

| Element | Citizen OS source values | Framework target |
| --- | --- | --- |
| Canvas and text | Light canvas `#f1f7fc`, working surface `#fff`, inset `#f9fbfd`, slate text `#2c3b47`, rule `#e1e7ee`, link `#1168a8`. [Theme maps](thirds/citizenos-fe/src/assets/styles/_themes.scss) | Give the working panel one step of contrast against the canvas. Use the border and spacing to group information. Use a subdued inset for background facts. Blue link treatment should be distinguishable from body text and stay visible in both themes. |
| Page frame and panels | 24 px outer gutter, 16 px at tablet width. 16 px panel radius, 24 px typical inset, 16 px internal gap. [Global styles](thirds/citizenos-fe/src/styles.scss) | Start with an 8/16/24/32 px spacing rhythm. Use a 16 px panel radius, 8 px for nested cards, and 16 px narrow padding. Apply member density to chrome and spacing while preserving readable type and controls. |
| Type | Noto Sans. 14/20 px UI text, 28/32 and 24/28 px headings, 16/32 px long-form topic text. [Global styles](thirds/citizenos-fe/src/styles.scss) | Use the provider-local system stack at comparable sizes. Compact metadata remains secondary. Use roomier leading and a readable measure of about 65–75 characters for proposal and forum prose. Let headings, translated labels, and large text wrap. |
| Action hierarchy | Rounded 48/40/32 px button families, with filled, outlined, soft, and quiet treatments. Default filled action is dark slate with blue hover. [Button styles](thirds/citizenos-fe/src/assets/styles/_buttons_new.scss) · [Theme maps](thirds/citizenos-fe/src/assets/styles/_themes.scss) | Use a solid primary treatment, outlined secondary actions, and quiet text or icon utilities with accessible names. Target 44–48 px hit areas for prominent touch controls and flexible height for long labels. Keep focus visible on every variant. |
| Desktop work area | 200 px desktop nav. Topic uses a reading column capped at 872 px, a 288 px supporting rail, and 32 px between them. [Nav styles](thirds/citizenos-fe/src/app/core/components/nav/nav.component.scss) · [Topic layout](thirds/citizenos-fe/src/app/topic/topic.component.scss) | Start at 24–32 px between the reading column and a context rail around 288 px where the content container can fit it. Use 16 px between rail blocks. Keep the existing container-driven stack for narrower work areas. |
| Responsive navigation | Desktop starts at 1025 px. Phone styles apply through 560 px, with a 56 px bottom navigation variant. [Media mixins](thirds/citizenos-fe/src/assets/styles/_mixins.scss) · [Mobile nav styles](thirds/citizenos-fe/src/app/core/components/nav-mobile/nav-mobile.component.scss) | Use compact navigation and a short set of frequent destinations. Keep the section switcher in flow and labelled. The shared Menu disclosure collapses the desktop rail at 900 px. The work area still stacks by available width. Check short viewports before adopting fixed navigation. |
| Stage and stance | Discussion blue, voting green, ideation amber, follow-up pink. Topic tabs use a thin active underline. Discussion and voting use tinted heading bands. [Topic tabs](thirds/citizenos-fe/src/app/topic/components/topic-tabs/topic-tabs.component.scss) · [Argument panel](thirds/citizenos-fe/src/app/topic/components/topic-arguments/topic-arguments.component.scss) · [Ballot panel](thirds/citizenos-fe/src/app/topic/components/topic-vote-cast/topic-vote-cast.component.scss) | Map draft to a quiet neutral or amber cue, deliberation to blue, voting to green, and closed to neutral. Use coloured edges, tint, or underline with an explicit label and readable ink. Keep warning, denied, provenance, and workflow meanings distinct. |
| Summary cards | Topic cards separate a state band, title/summary area, and activity footer. Group cards lead with their identity and summary. [Topic card styles](thirds/citizenos-fe/src/app/public-topics/components/topicbox/topicbox.component.scss) · [Group card styles](thirds/citizenos-fe/src/app/my-groups/components/groupbox/groupbox.component.scss) | Adopt the repeated anatomy and allow height to follow content. Media is optional. Use a bounded title/summary preview with the full content in the linked view. Keep primary links and secondary controls in a predictable order. |

Retune the HSL semantic layer in `:root` and keep components theme-agnostic.
Use `--primary-ink` on tinted accent surfaces and the channel tokens for
alpha variants. Match the light and system-light blocks. Preserve the current
dark default and apply `data-theme`, `data-ui-accent`, and `data-ui-density` to
`<html>` on first paint. Use text or shape as well as colour for active,
selected, unread, locked, and lifecycle states. Check WCAG AA contrast with
the rendered ink and background. Retain visible focus rings, reduced-motion
support, and large-text reflow. [Theme and component CSS](src/public/app.css) ·
[Appearance vocabulary](src/interfaces/http/views/interfaceSettings.js)

## 6. Surface and template map

New views are targets. Existing paths, module gates, and stable ids are the
starting point for implementation.

| Owner | Current | Target |
| --- | --- | --- |
| [Core shell and topbar](src/modules/core/templates/partials) | Grouped desktop rail, native compact Menu, current location, skip target, and shared status. | Extend the page-heading and contextual action pattern as each surface is converted. |
| [Home](src/modules/home/templates/home.html) `/` | Persistent workspace heading, scoped conversation previews first, and supporting access and operator sections. | Refine previews into named destination collections with consistent cards and direct links to their full views. |
| [Discussion](src/modules/discussion/templates/discussion.html) `/discussion` | Scope header, searchable feed with topic-subtree filters, scoped empty states, and focused contributions with evidence and gated actions. | Add reply relationships and use contribution links in authorized activity. |
| [Forum](src/modules/forum/templates/forum.html) `/forum` | Searchable article rows and category-aware compose rail. A [focused article](src/modules/forum/templates/forum-thread.html) shows attributed replies oldest-first with evidence and a reply form. Posting returns to the same article. | Apply the collection and reply patterns to other conversation surfaces where appropriate. |
| [Social](src/modules/social/templates/social.html) `/social/feed` | Attributed wall, adjacent follow filters, and native compose with audience and attachment controls. Direct media and replies follow the source audience. | Resolve social activity to permitted records and add inline recovery for ordinary forms. |
| [Proposals](src/modules/petitions/templates/petitions.html) `/petitions` | Summary collection with a nearby stage filter and scoped workspaces for Overview, Discussion, History, and Ballot. Reads and writes use the stored lane. | Refine discussion filters, ballot timing context, and SSR form recovery. |
| [Groups](src/modules/groups/templates/groups.html) `/groups` | Branch tree and category browse; focused Overview, Members, Decisions, and gated Settings with canonical scoped lane links. | Search and pagination for discovery and clearer activity within a group. |
| [Delegation](src/modules/delegation/templates/delegation.html) `/delegation` | Overview, incoming and personal ballot rows with topic, holder or owner, deadline and scoped Ballot links, plus preferences, effective chains, and recommendations. | Refine topic labels and place recommendations and chain explanations in supporting sections. |
| [People](src/modules/delegates/templates) `/delegates` | Search-led collection of person cards. Profile record header with one Delegate or Edit action, Overview, Delegations, Votes, Activity, and Endorsements views, and a Details rail. Activity respects proposal lanes. | Pagination once directories grow. Profile activity beyond proposals as those records gain lane-aware links. |
| [Governance](src/modules/governance/templates/governance.html) `/governance` | Heading with Propose action, current-rule grid, proposals with Current rule and Proposed values, attributed decisions with Before and After values, and propose rail. | A focused change record once members ratify changes. |
| [Notifications](src/modules/notifications/templates/notifications.html) `/notifications` | Paginated activity rows, unread state, scoped proposal links, Mark all read, and preferences in the rail. | Resolve other notification sources to their permitted records. |
| [Profile](src/modules/profile/templates/profile.html) `/profile` | Identity header with one action, section links, labelled Public handle, Provider-local fields, and Interface defaults sections with inline status and field errors, and a Session rail. | Optional provider-profile sync across devices. |
| [Organization cases](src/modules/organization/templates/organization-cases.html) `/organization` | Cases heading, case record header, original message with evidence, acknowledgement form or ordered history, and the searchable queue in the rail. | Case history beyond acknowledgement as layer stores arrive. Retain provider-local scope. |
| [Organization preview](src/modules/organization/templates/coordination.html) `/organization?view=preview` | Persistent preview header with backlink, Preview label, and live-queue action, then the illustrative inbox, pressure map, and operating map. | Scenario B examples in place of the generic illustrative cases. |
| [Admin](src/modules/admin/templates/admin.html) `/admin` | Anchored sections in a single column with grouped partials. The inactive Composer entry sits in the page flow on phones. | Apply the settings hierarchy while retaining gates, anchors, and the admin Composer workspace. |
| [Wallet handoff and result](src/modules/auth/templates) | Focused task pages: numbered steps, wallet link before QR, hash-only guarantee, refresh and restart recovery, a result page that leads to Choose your handle, and a recovery page for failed callbacks. | Wallet-not-installed guidance once the verifier reports it. |


## 7. Implementation and section compatibility

- Shared shell and navigation own the frame and links. Route controllers derive
  authorized state and the selected view. Module-owned templates and partials
  own markup and reading order. Use existing shared helpers for actor identity,
  status, context gates, topic breadcrumbs, evidence, pagination, preview, and
  provenance. Use browser enhancements after the ordinary HTML flow works.
  [Template renderer](src/interfaces/http/views/templates.js) ·
  [Context panels](src/interfaces/http/views/contextPanel.js) ·
  [Actor labels](src/interfaces/http/views/actorLabel.js)
- Preserve existing `data-composer-*`, `data-verbosity*`, `data-ui-setting`,
  `data-member-hidden`, and `data-partial` hooks. Member Interface settings
  remain in `person.uiSettings` when saved, with a browser-local overlay.
  Deployment defaults remain in admin Composer. Keep public anchors and the
  stable key for each existing logical panel. If a key changes, migrate both
  saved member and deployment layout preferences.
- A panel opts into Sections with a stable `data-composer-section` and a
  friendly `data-section-label`. Keep synthetic `panel-N` keys outside member
  Sections. Keep critical scope and page headings in persistent markup that
  remains visible when optional panels are hidden. Preserve SSR section
  visibility and let the active Composer manage the editing layout.
- Establish each layout on a real route before creating a reusable component.
  Share page headers, collections, status labels, and action anatomy when they
  have the same meaning. Keep workflow-specific evidence, voting, permissions,
  and moderation controls with their module.

### Current section inventory

The keys below are persisted identifiers. Some Profile and delegate-profile
keys have historical names, while their labels identify the content.

| Module | Explicit section keys |
| --- | --- |
| Home | `home-overview`, `home-lane-conversation`, `home-lane-governance`, `home-lane-federation`, `home-ops`. Workspace heading sits outside these panels. |
| Social | `social-wall`, `social-compose`, `social-controls`, `social-follows`. The header stays visible. Filters sit in the main column. |
| Forum | Browse `forum-threads`, `forum-compose`. Focused article `forum-replies`. Both use the `forum` page key. The article and heading stay visible outside optional sections. |
| Discussion | Browse `discussion-feed`, `discussion-compose`, `discussion-filters`, `discussion-topics`. The focused contribution uses the same `discussion` page key. Its heading, scope, and content stay visible outside optional panels. |
| Proposals | Browse `petitions-active`, `petitions-discussion`, `petitions-compose`, `petitions-filters`, `petitions-delegates`. Workspace `petition-overview`, `petitions-discussion`, `petition-history`, `petition-ballot`, `petition-details`. Both use the `petitions` page key. |
| Organization | Live `organization-case-work`, `organization-case-queue`. Preview `coordination-workspace`, `pressure-inbox`, `pressure-map`, `operating-map`. |
| Delegation | `delegation-overview`, `delegation-inbox`, `delegation-my-ballots`, `delegation-current`, `delegation-effective`, `delegation-set`, `delegation-recommendations` |
| People | Directory `delegate-directory` (search, now above the results), `delegate-directory-list`. Profile views: Overview `delegate-profile-summary`, Delegations `delegate-profile-endorsements`, Votes `delegate-profile-delegations`, Activity `delegate-profile-votes`, Endorsements `delegate-profile-history`. The record header, section links, and Details rail stay outside optional panels. |
| Groups | Browse `groups-list`, `groups-categories`, `groups-create`. Workspace `group-overview`, `group-members`, `group-decisions`, `group-settings`. All use the `groups` page key. Lineage, identity, membership, and section links stay outside optional panels. |
| Governance | `governance-overview` (current rules), `governance-proposals` (open changes and decisions), `governance-propose`. The heading and section links stay visible. |
| Notifications | `notifications-inbox`, `notifications-preferences` (controller-rendered) |
| Profile | `profile-interface` (Public handle), `profile-summary` (Provider-local fields), `profile-fields` (Interface defaults). The record header, section links, and Session rail stay outside optional panels. |
| Admin | `circle-settings`, `governance-settings`, `modules`, `composer`, `rate-limits`, `social-media`, `upload-cleanup`, `structure-manager`, `provider-profiles`, `topic-gardener-review`, `federation-gossip`, `provider-blind`, `admin-audit`, `ops-metrics`, `metrics-retention`, `admin-transactions`, `outbound-delivery`, `transaction-summaries`, `extensions`, `session-overrides` |
| Auth/core task panels | `auth-eudi`, `verification-complete`, `error-message`, `module-disabled`, `admin-required`. These panels sit outside member Sections. |

## 8. Delivery order and acceptance

| Slice | Implementation boundary | Acceptance |
| --- | --- | --- |
| 1. Shell and visual foundations | Implemented the shared shell, semantic palette, responsive navigation, base panels and actions, and the Home and Discussion header pilot. | At 390 px and 800 × 600 px, find Discussion, Forum, and Notifications by keyboard with every civic module off. Jump to main and compose. Verify focus, saved settings, role/module gates, and the shared status facts in both themes. |
| 2. Conversation and collections | Discussion and Forum have searchable collections and focused views linked from Home. Social has in-flow compose, audience, follow filters, and attributed media states. | Find the waiting-list evidence and the free-mandate article in Scenario A. Open a contribution and return to the same search. Reply in Forum and send a media-only Social update with ordinary HTML. Confirm direct attachment and reply access. |
| 3. Proposal browse and workspace | Implemented the summary collection and four focused views behind the same full and partial read gate, with canonical POST destinations. | A deep link opens the ALPI proposal independently of list pagination. The exact frozen revision is discoverable from Ballot. A rebuttal leads to its claim, a no vote remains visible under its outcome policy, and a pending delegate can be overridden without counting it as an abstention. Test outsider read and mutation refusals against a members-only lane. |
| 4. Groups, activity, and other records | Focused group sections and lane links, explicit promotion destinations, proposal activity, and delegation deep links are implemented. People profiles, governance changes, and the case record use the header–sections–context pattern. | A promotion request shows the exact upper-level destination and the accepted item keeps its id and history. A permitted inbox link opens the right scope. On Scenario B, an ASL case retains the attributed source and durable acknowledgement; the preview is visibly separate. |
| 5. Admin and customization polish | Profile, wallet handoff, and the organization preview are converted, with shared inline form feedback. Next: apply the settings-section header and feedback to admin, then any component palette operations once variants are established on real routes. | Admin anchors and privileged controls remain reachable. Existing member-hidden panels and saved deployment layouts survive a reload, including a new route with a compatible view key. |

The proposal controller checks the stored group lane on deep reads, edits,
signatures, comments, stage changes, ballots, and promotions. Proposal alert and
delegate links resolve the same lane before including record details. Apply the
same read policy to remaining exports and activity consumers as they are
converted. [Group scope](src/modules/groups/groupScope.js) ·
[Proposal controller](src/modules/petitions/http/petitions.js) ·
[Optimization backlog](OPTIMIZATIONS.md)

### Slice 1 verification

The keyboard regression covers the compact shell at 390 px and 800 × 600
with optional civic modules disabled. It checks the skip link, the route and
compose destinations, the status facts, and focus after enhanced navigation.
The Scenario A walkthrough passed and refreshed the README captures. The pilot
pages were checked in light and dark at desktop, 800 px, 390 px, and 320 px,
including large text and reduced motion. The separate Scenario B review
covered the attributed source, acknowledged case, review date, and preview.

### Forum and proposal workspace verification

The Forum browser regression covers keyboard search, article focus, replies with
and without JavaScript, and returning to the same search. The Scenario A driver
finds the free-mandate article in the collection and captures the article with its
two attributed replies. Proposal regressions cover full and partial private reads,
forged scope fields, public read-only access, disabled lanes, scoped redirects,
inaccessible alert details, enhanced revision navigation, and an ordinary HTML
discussion submission. The Scenario A walkthrough follows the revised cap to the
frozen ballot and exercises the proposal alert read loop. A separate browser
pass checked the member surfaces in both themes at desktop, 800 × 600, 390 px,
and 320 px with large text.
[Forum browser regression](tests/ui.test.js) · [Proposal lane regression](tests/petition-scope.test.js)

### Discussion and Social verification

- [x] Discussion search checks body text, topic breadcrumbs, and evidence links
  in the selected lane. The parent topic includes its descendants. The browser
  test opens the waiting-list evidence at 320 px and returns to the selected
  query and topic with enhanced and ordinary HTML navigation.
- [x] Focused contribution links check current lane and preview visibility.
  Full and partial reads with a missing or forged lane hint withhold private
  content. Promotion writes use the same source gate. After promotion the
  same id resolves in its new lane.
- [x] Social compose uses a native disclosure in the normal scroll flow. Tests
  cover keyboard entry to compose and a media-only direct upload without
  JavaScript. Direct replies retain the conversation audience, and an outsider
  cannot reply to the original or view or report its media by id.
- [x] Stable section keys, theme tokens, and the Interface auto-collapse
  preference carry over. The compose test checks reachability at 800 × 600
  and the draft test keeps a filled disclosure open when scrolling past it.
- [x] The inactive admin Composer stays in the document flow at 320 px so
  it cannot cover member controls. Entering Composer still opens its tools.

The standing review walked the member surfaces in both themes at 1440 × 900,
800 × 600, 390 × 844, and 320 × 700. The smallest pass used large text and
reduced motion. The separate Scenario B pass covered the acknowledged case
and its evidence, the review date, and the preview at desktop and phone widths.

[Discussion access regression](tests/home.test.js) ·
[Composer overlay regression](tests/composer-overlay.test.js) ·
[Browser regressions](tests/ui.test.js)

### Group workspace verification

Scenario A opens the branch workspace, assigns a lane moderator in Members,
reads the ranked election result in Decisions, and follows the scoped Discussion
link. The lane moderator sees the exact parent destination before approval.
The browser regression checks focus after enhanced navigation and membership
changes with JavaScript off. HTTP coverage checks public and members-only lane
links, both HTML response modes, and Settings access after role changes.
The member surfaces were reviewed at 1440 × 900, 800 × 600, 390 × 844, and
320 × 700 in dark and light. The 320 px check opened group Settings disclosures
with larger text. The separate ASL case checks cover provider-local acknowledgement
and phone reflow.
[Group HTTP regression](tests/group-workspace.test.js) ·
[Promotion regression](tests/group-roles-promotion.test.js) ·
[Browser suite](tests/ui.test.js)

### People, governance, and case verification

HTTP regressions cover the People card anatomy and the search with no matches.
They also cover profile GET views, the unknown-view fallback, the Delegate
pre-fill, and the self-view Edit action. A members-only lane proposal stays out
of an outsider's profile counts and Activity but appears for its author.
Governance coverage checks the guest verification action, the current rule
beside the proposed value, and Before and After values on an approved decision.
The Scenario A walkthrough passed and refreshed the People, delegate profile,
and governance captures. A browser pass at 375 px in light and dark checked
the profile, Delegate handoff, Governance, and Cases with no horizontal
overflow. The existing Scenario B case regression covers the restructured
case record, its review date, and the acknowledgement. The Discussion browser
test now waits for the destination heading after an enhanced swap, which
removes an intermittent failure.
[Record workspace regression](tests/record-workspaces.test.js) ·
[Governance regression](tests/governance.test.js) ·
[Case regression](tests/organization-cases.test.js)

### Profile, wallet, and preview verification

HTTP regressions cover the guest and verified Profile headers, the stable
section keys behind the new anchors, the section-returning form actions, the
status line after a save, and the alert, `aria-invalid`, and kept value after
a rejected handle. They check that the rail shows the hash cue but not the
full hash. The wallet tests cover the steps, QR, deep link and fallback,
the privacy guarantee, refresh and restart links, the recovery page, and the
result page without Social when that module is off. The preview test checks
the persistent header. A browser pass on seeded Scenario A checked Profile in
dark at desktop, and the wallet handoff, preview, and an enhanced handle
rejection at 375 px in light with no horizontal overflow. The rejection
announced its error and returned focus to the handle section.
[Settings and task regression](tests/settings-task-pages.test.js)

### Review checklist for presentation changes

- [ ] Drive Scenario A using an isolated, seeded strict-Circle deployment. Walk
  the affected member surfaces as the relevant actors. Use English copy, Italian
  names and handles, and the canonical topics and evidence. Use a separate store
  and the Scenario B lens for `/organization`. Preserve each scenario's
  `[drive]`, `[fixture]`, and `[design]` status.
  [Standing UI review](principle-docs/UIReview.md) ·
  [Scenarios](principle-docs/SimulationScenarios.md) ·
  [Scenario A driver](scripts/party-journeys.js)
- [ ] Check wide desktop, 800 × 600, 390 px, and 320 px or equivalent zoom.
  Compare the reference composition with the implemented surface in light/blue
  and dark, then check default and saved accent/density, large text, and reduced
  motion. Inspect contrast, heading order, reflow, overflow, and visible focus.
- [ ] Operate navigation, disclosures, filters, compose, and the changed task by
  keyboard. Repeat core actions with partial navigation and with JavaScript off.
  Check permission refusals, disabled modules, stable deep links, a regular
  empty view, a filtered empty view, and failure/retry behavior where relevant.
- [ ] Run `npm run test:ui` and the nearest targeted tests. Update this file's
  current/target entry and inventory in the same task. Record open optimizations.
  [Browser suite](tests/ui.test.js) ·
  [Interface preferences](tests/interface-settings.test.js) ·
  [Deliberation order](tests/deliberation-order.test.js) ·
  [Delegated ballots](tests/delegated-ballots.test.js) ·
  [Group scope and promotion](tests/group-structure.test.js) ·
  [Case workflow](tests/organization-cases.test.js)
