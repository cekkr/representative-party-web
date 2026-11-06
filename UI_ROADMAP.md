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
scope and Create action before the feed, with the topic filter next to results
and the compose form in the supporting rail. Forum has searchable article rows,
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

**Current.** `/petitions` serves a scoped, stage-filtered and paginated list with
full proposal cards, plus a deliberation feed and a compose/filter/delegate rail.
Existing proposal cards carry evidence, votes, discussion, revisions, and
moderation controls. Item-id writes check the stored proposal's lane and return
to the resulting group scope after success. Public lanes allow outsiders to
browse, with group membership required for proposal participation.
[Controller](src/modules/petitions/http/petitions.js) ·
[Template](src/modules/petitions/templates/petitions.html) ·
[Proposal view](src/interfaces/http/views/petitionView.js)

**Target.** Let `/petitions` browse summary cards. A proposal title opens its
focused workspace in the same module. Use an explicit read URL such as
`/petitions?proposal=<id>&view=discussion` as the implementation starting point.
In a group lane carry `group=<id>`, and keep existing POST endpoints and
authorization. Implement lookup by stable record id after resolving the viewer's
scope. Reuse the read gate on every selected view and its partial equivalent.
A scoped record must stay inaccessible outside its permitted lane. Preserve
existing fragment links and keep a return link to the filtered list. Build
the return link from recognized scope and filter fields.

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

**Current.** `/groups` combines a branch tree, category directory, creation,
elections, and policy controls. Discussion and proposal lanes reuse their own
routes with `?group=` when enabled. [Group template](src/modules/groups/templates/groups.html) ·
[Scope resolver](src/modules/groups/groupScope.js)

**Target.** Keep the tree and category directory as discovery views. On opening
a group, show **parent lineage → group name/description → membership, visibility
and viewer role → available join or manage action → workspace links**. Follow
the Citizen OS split between group content and people. Link to the existing
scoped Discussion and Proposals lanes. Give Members and Decisions distinct
areas within the group, and show governance settings only to eligible viewers.
Retain contextual requests in the source scope, name the destination before a
promotion is confirmed, and preserve the item, history, and audit trail after
the move. Group lineage describes structure. The UI derives membership and
authority separately for every group.

### Other record pages

Use the same header–workspace–context hierarchy where it shortens the path
through a record. A People profile leads with identity and role, followed by
delegation coverage, votes, and activity. A governance change shows the
current rule alongside the proposed change and gives the decision its own
attributed entry. A live organization case leads with its state, review date,
and original attributed source, then acknowledgement and case history. The
searchable case queue is secondary. The organization preview has a persistent
preview label and its own navigation context.


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

**Current.** Notifications has an inbox and local preferences, with a Mark all
read action and proposal links where available. **Target.** Follow Citizen OS's
activity rows with a timestamp, scope, a clear unread cue, and a short event
description. Preserve Mark all read. Resolve authorized target links through the
owning module, including a proposal's actual scope and record view. A notification
can remain readable after its source becomes inaccessible, using only the
permitted event details. Offer explicit paging or a load-more link with a real
GET destination. [Activity row reference](thirds/citizenos-fe/src/app/shared/components/activity/activity.component.html) ·
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
| [Discussion](src/modules/discussion/templates/discussion.html) `/discussion` | Persistent scope header and compose jump, topic filter beside the feed, scoped empty states, and a supporting compose rail. | Refine authored rows and stable links as part of the conversation slice. |
| [Forum](src/modules/forum/templates/forum.html) `/forum` | Searchable article rows and category-aware compose rail. A [focused article](src/modules/forum/templates/forum-thread.html) shows attributed replies oldest-first with evidence and a reply form. Posting returns to the same article. | Apply the collection and reply patterns to other conversation surfaces where appropriate. |
| [Social](src/modules/social/templates/social.html) `/social/feed` | Wall, typed follows and filters, compose, and media controls. | Distinct post and media states, visible audience, and accessible compose with one scroll path. |
| [Proposals](src/modules/petitions/templates/petitions.html) `/petitions` | Rich cards, deliberation feed, compose and filters. Item-id writes use stored-lane access and redirect grouped actions to the resulting scope. | Summary collection plus selected proposal workspace with Overview, Discussion, History, and Ballot as applicable. |
| [Groups](src/modules/groups/templates/groups.html) `/groups` | Group tree, categories, elections, roles, and settings. | Browse plus focused group identity, links to scoped lanes, Members and Decisions views, and contextual management. |
| [Delegation](src/modules/delegation/templates/delegation.html) `/delegation` | Overview, incoming and personal ballots, preferences, effective chains, and recommendations. | Task rows with topic, named holder, deadline/resolution, and scoped proposal link. Put recommendations and chain explanations in supporting sections. |
| [People](src/modules/delegates/templates) `/delegates` | Searchable directory and profile with coverage, votes, and activity. | Summary cards or rows, then a record header with readable accountability sections and separate endorsement context. |
| [Governance](src/modules/governance/templates/governance.html) `/governance` | Constitution, change proposals, decisions, and propose rail. | State the current rule and proposed change together, then show the attributed decision and its effect. |
| [Notifications](src/modules/notifications/templates/notifications.html) `/notifications` | Inbox and local preferences. | Activity rows with explicit unread state and permitted destination, with preferences in supporting context. |
| [Profile](src/modules/profile/templates/profile.html) `/profile` | Session and handle, provider-local fields, and Interface controls. | Identity summary followed by clearly separated, labelled settings sections and inline feedback. |
| [Organization cases](src/modules/organization/templates/organization-cases.html) `/organization` | Linked source, case and acknowledgement workflow, searchable queue. | Case header, original source and evidence, acknowledgement/history, and a secondary queue. Retain provider-local scope. |
| [Organization preview](src/modules/organization/templates/coordination.html) `/organization?view=preview` | Labelled illustrative inbox, pressure map, and operating map. | Persistent preview identity, Scenario B examples, and a clear return to the live case workspace. |
| [Admin](src/modules/admin/templates/admin.html) `/admin` | Anchored sections in a single column with grouped partials. | Keep the settings workspace single-column. Apply visual hierarchy and fix narrow Composer overlap while retaining gates and anchor links. |
| [Wallet handoff and result](src/modules/auth/templates) | Offer and result panels in the shared shell. | Focused form-page hierarchy with visible QR, wallet link, hash-only privacy guarantee, and a clear return or recovery action. |


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
| Social | `social-wall`, `social-compose`, `social-controls`, `social-follows` |
| Forum | Browse `forum-threads`, `forum-compose`. Focused article `forum-replies`. Both use the `forum` page key. The article and heading stay visible outside optional sections. |
| Discussion | `discussion-feed`, `discussion-compose`, `discussion-filters`, `discussion-topics`. Scope and page heading sit outside these panels. |
| Proposals | `petitions-active`, `petitions-discussion`, `petitions-compose`, `petitions-filters`, `petitions-delegates` |
| Organization | Live `organization-case-work`, `organization-case-queue`. Preview `coordination-workspace`, `pressure-inbox`, `pressure-map`, `operating-map`. |
| Delegation | `delegation-overview`, `delegation-inbox`, `delegation-my-ballots`, `delegation-current`, `delegation-effective`, `delegation-set`, `delegation-recommendations` |
| People | `delegate-directory-list`, `delegate-directory`, `delegate-profile-summary`, `delegate-profile-endorsements`, `delegate-profile-delegations`, `delegate-profile-votes`, `delegate-profile-history` |
| Groups | `groups-list`, `groups-categories`, `groups-create` |
| Governance | `governance-overview`, `governance-proposals`, `governance-propose` |
| Notifications | `notifications-inbox`, `notifications-preferences` (controller-rendered) |
| Profile | `profile-interface`, `profile-summary`, `profile-fields` |
| Admin | `circle-settings`, `governance-settings`, `modules`, `composer`, `rate-limits`, `social-media`, `upload-cleanup`, `structure-manager`, `provider-profiles`, `topic-gardener-review`, `federation-gossip`, `provider-blind`, `admin-audit`, `ops-metrics`, `metrics-retention`, `admin-transactions`, `outbound-delivery`, `transaction-summaries`, `extensions`, `session-overrides` |
| Auth/core task panels | `auth-eudi`, `verification-complete`, `error-message`, `module-disabled`, `admin-required`. These panels sit outside member Sections. |

## 8. Delivery order and acceptance

| Slice | Implementation boundary | Acceptance |
| --- | --- | --- |
| 1. Shell and visual foundations | Implemented the shared shell, semantic palette, responsive navigation, base panels and actions, and the Home and Discussion header pilot. | At 390 px and 800 × 600 px, find Discussion, Forum, and Notifications by keyboard with every civic module off. Jump to main and compose. Verify focus, saved settings, role/module gates, and the shared status facts in both themes. |
| 2. Conversation and collections | Forum browse and focused replies are implemented. Home links to individual articles. Discussion and Social still have collection and contribution refinements ahead. | In Scenario A, find the waiting-list evidence and open an attributed forum article from search. Follow replies in order and post one with and without enhancement. Retain the active search and scope through refresh and Back. |
| 3. Proposal browse and workspace | Direct writes now check the stored group lane. Next, apply the read gate to a canonical proposal GET URL for full and partial requests, then split browse, overview, deliberation, history, and ballot presentation. | A deep link opens the ALPI proposal independently of list pagination. The exact frozen revision is discoverable from Ballot. A rebuttal leads to its claim, a no vote remains visible under its outcome policy, and a pending delegate can be overridden without counting it as an abstention. Test outsider read and mutation refusals against a members-only lane. |
| 4. Groups, activity, and other records | Focused group sections and lane links, activity deep links, People and delegation, then governance and cases. | A promotion request shows the exact upper-level destination and the accepted item keeps its id and history. A permitted inbox link opens the right scope. On Scenario B, an ASL case retains the attributed source and durable acknowledgement; the preview is visibly separate. |
| 5. Admin and customization polish | Apply shared styling to settings, fix Composer overlap, and introduce any component palette operations only after variants are established on real routes. | Admin anchors and privileged controls remain reachable. Existing member-hidden panels and saved deployment layouts survive a reload, including a new route with a compatible view key. |

The proposal controller checks the stored group lane before edits, signatures,
comments, stage changes, ballots, and promotions. A submitted query or form
value cannot establish membership. Grouped actions now return to the resulting
lane. Once a focused view exists, redirect to the item itself and check the
current lane again when someone follows an old link after a move. Carry out the
focused read and activity visibility checks before publishing new deep links.
[Group scope](src/modules/groups/groupScope.js) ·
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

### Forum and proposal lane verification

The Forum browser regression covers keyboard search, article focus, replies with
and without JavaScript, and returning to the same search. The Scenario A driver
finds the free-mandate article in the collection and captures the article with its
two attributed replies. The proposal HTTP regression covers forged scope fields,
public and members-only lanes, a disabled lane, and full and partial group redirects.
[Forum browser regression](tests/ui.test.js) · [Proposal lane regression](tests/petition-scope.test.js)

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
