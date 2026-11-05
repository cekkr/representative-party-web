# Simulation Scenarios

Status: reference scenarios and causal replay contract for development, testing,
and screenshots.

## Why this exists

A deployment with three posts and a proposal called "Test" proves nothing. The
screens render, the labels are correct, and nobody can tell whether the product
works — because there is no situation on screen that a real member would
recognise. Empty states and placeholder text hide exactly the defects that
matter: a delegation chain nobody can read, a pressure cue with no composition
behind it, a vote whose tally means nothing because one person cast all of it.

This document defines two situations rich enough to break things, and scripts
them as ordered actions bound to real routes and real field names. Use them to
replay a deployment from empty state, to write tests, and to produce screenshots
that show the product doing its job. A final database that happens to contain
the expected records is not a successful simulation: the interactions that
caused those records, and what each actor could observe after each one, are the
test.

The two scenarios are deliberately **kept apart**. They exercise different
halves of the framework and must not be merged into one deployment:

| | Scenario A | Scenario B |
| --- | --- | --- |
| Reference | `RepresentativeParties.md` | `OrganizationPressureManagement.md` |
| Subject | A political party deliberating and deciding | A health authority sensing and responding |
| Actor label | `person` (verified natural person) | `user` (authorized staff) |
| Enforcement | Circle strict — one person = one voice | Observing — identity verified, attribution limited |
| Core question | *Who decided, and can they be held to it?* | *What is the organization failing to perceive?* |
| Fails if | Voting is trusted before deliberation exists | Structure is imposed before communication earns it |

---

## Ground rules

**Institutions and people are fictional; the rules of the world are real.** The
party, the health authority, and every person in them are invented. No real
party, ASL, official, or clinical incident is depicted, and nothing in these
fixtures should be presented as a record of one. This matters beyond taste:
seeded content ends up in screenshots, ledgers, and gossip envelopes, where a
plausible fake record about a real institution is a liability.

The *norms, mechanisms, and debates*, however, are the real Italian ones, cited
by name: laws and sentenze do not rot the way news does, and they are what makes
the fixture recognisable to an Italian reader. So `L. 120/2007` (intramoenia),
`L. 86/2024` and `sent. 192/2024` (autonomia differenziata), `DM 77/2022` (Case
della Comunità and COT), `D.lgs. 24/2023` (whistleblowing) appear as themselves.
Quantities are realistic orders of magnitude tied to their source year — update
them when reseeding; never present them as live statistics.

**These scenarios' in-app copy is in English — conversation, case text, topic
categories, and group names.** What stays Italian is the world the deployment
lives in: people's names and handles, institutions, legal terms and citations,
`€` amounts, and `dd/mm/yyyy` dates. This makes every screenshot readable for an
English-language product review without pretending that the laws or institutions
are generic. Tests and journey scripts assert on the English fixture strings.
Scenario A's topics are an English category hierarchy (`Healthcare / Waiting
lists`, `Labour / Minimum wage`, …), so topic-scoped delegation, the group
directory and breadcrumbs all resolve against one tree. Evidence links use the
fictional domains `example.rcn.it` / `esempio.aslvalsereno.it` — real norms are
cited by name in the text instead of by URL, so nothing rots.

---

## Conventions

Each action is written as:

> **A3.2** `@handle` — `POST /route` — `field=value`
> → what must be observable afterwards

Action ids are stable. A test that references **A3.2** should keep referencing
the same act even if the surrounding prose changes. New actions extend the
numbering; they never renumber existing acts.

Each scenario declares a canonical phase schedule. Within one scheduled phase,
document order is causal. The numeric suffix is a stable identifier, not a
sorting instruction: later additions may therefore appear as **A3.11** before
**A3.7** when that is where the new interaction belongs in the phase.

Three labels mark what the codebase can do with an action **today**:

- **[drive]** — a test can perform this through the real interface and assert
  the immediate result and resulting state transition.
- **[fixture]** — the data exists, but only as a hardcoded template; a test can
  assert what renders, not the workflow that produced it. It is snapshot
  coverage, never evidence that the corresponding interaction works.
- **[design]** — described by the principle doc, not yet built. Listed so the
  scenario stays whole and so the gap is legible. Do not write a test for it.

## Execution contract — one actor, one event, one observable delta

The scenario runner is a deterministic multi-actor simulation. Here, an
**agent** means one test actor with its own identity, session, observations, and
local memory. It does not mean an LLM, and it is not allowed privileged access
to application state. The provider operator, every named user/person, every
supporting quorum participant, and every peer provider are separate agents.
`@caso-4471` is a protected relay identity, not a hidden alias for another
agent.

### Independent actor state

Each agent owns, at minimum:

- a stable actor id and deterministic credential seed;
- its own wallet/authentication flow and `circle_session` cookie jar;
- its own browser context or equivalent isolated HTTP client;
- only the record ids, handles, messages, and facts it has actually observed;
- its own notification/inbox cursor and last-seen view state.

Contexts may be closed and restored from that same agent's saved session to
keep a large run affordable, but two agents must never share a cookie, pending
wallet offer, local storage, or remembered record id. The orchestrator may
choose whose turn is next; it may not act for them, copy hidden ids into their
memory, or turn one authenticated session into several apparent people.

### Decisions come from observed state

Each cast entry supplies the agent's stable role and motivation; the current
surface supplies the facts it can act on. The action text is the expected
decision, not permission for the orchestrator to post a prepared payload behind
the agent's back. A deterministic runner can express the turn as:

```text
observation[t] = observe(agent, world[t])
interaction[t] = decide(profile, memory[t], observation[t], simulatedTime[t])
world[t+1]     = applyThroughRealInterface(world[t], interaction[t])
memory[t+1]    = learn(memory[t], observation[t], response[t])
```

`decide` may be an ordinary test state machine; no generative model is required.
It must return at most one interaction and may use only the agent's profile,
memory, current observation, and clock. If Giulia has not observed the petition
id, if a signer cannot see the proposal, or if an affected user has not refreshed
their notifications, the next action is not yet justified and the step fails.
This is what makes the replay a calculation over real intermediate state rather
than a script that installs a predetermined final graph.

### Fresh ground

Every conformance replay starts with a fresh store for exactly one scenario.
Before event 1, setup may create the database schema, signing material, virtual
clock, provider bootstrap identity, and the deployment configuration in **A.0**
or **B.0**. It may not insert discussions, cases, signatures, ballots,
delegations, notifications, audit entries, or end-state aggregates.

`scripts/seed-demo.js`, adapter writes, imported JSON, and domain-helper calls
may still support previews or focused unit tests, but a run that uses them to
materialize scenario state is not a scenario conformance run. A **[fixture]**
may be mounted for render testing in a separate run; it must never be counted as
a completed **[drive]** event or silently satisfy a later event's precondition.

### The event loop

Run phases in the scenario's declared order, then run actions from top to bottom
inside each phase. For every **[drive]** action:

1. **Select one agent.** Resolve the named actor and restore only that actor's
   state. Phrases such as “each member”, “eight members”, or “250+ members”
   expand into one scheduled event per concrete agent before replay begins.
   Explicit clock advances and scheduler ticks instead select the named system
   control; they never impersonate a user.
2. **Observe the precondition.** The acting agent reaches the real surface and
   discovers any needed id or state there. Assert that the action is currently
   possible; do not assume the end-state fixture.
3. **Perform one interaction.** Submit one form, follow one link, cast one
   ballot, or make one protocol request through the production boundary named
   by the action. A batch API call that impersonates several actors is not one
   interaction.
4. **Settle deterministically.** Wait for the response and the bounded work it
   legitimately triggers: persistence, audit append, notification delivery, or
   gossip. Clock advances and scheduler ticks are explicit trace events, never
   hidden sleeps or direct edits to timestamps.
5. **Observe from the ground.** The acting agent checks the returned surface.
   Every affected agent then independently refreshes its own inbox or relevant
   view before the test claims that it was notified or can see the change.
6. **Assert the delta.** Check the immediate effect, the previous state that
   must remain intact, relevant policy/privacy negatives, and the audit or
   envelope entry. Aggregate counters must equal the events replayed so far,
   not merely their final target. A read-only test auditor may inspect the
   store, logs, or envelopes for these assertions, but its findings never enter
   an agent's memory or supply a later interaction id.
7. **Append the trace and continue.** A failed assertion stops the replay at
   that event and preserves the store, actor id, before/after observations, and
   trace prefix needed to reproduce it.

System reactions such as “quorum moves the proposal to discussion” are caused
by the preceding user event. Record and assert them as derived transitions; do
not call an internal status function to manufacture them. The baseline replay
is serialized so every consequence has an unambiguous cause. Race and
concurrency tests are valuable, but they are separate schedules replayed after
the canonical step-by-step one passes.

### Trace and checkpoint requirements

The runner should emit one machine-readable trace entry per event with at least:

```text
sequence · scenario action id · concrete child id · simulated time · actor id
observed precondition · interaction · response · observable delta
affected agents · assertions · audit/envelope references
```

Compound actions retain their stable parent id and gain deterministic child ids,
for example `A3.3/sign-001` … `A3.3/sign-250`. A checkpoint is a replay cache,
not test truth: a run resumed at a checkpoint must retain the full trace prefix,
and CI must periodically prove that the same checkpoint can be rebuilt from an
empty store. Screenshots are captured from the agent who is meant to see the
state at that exact step, not from an omniscient admin after the scenario ends.

### What counts as passing

A scenario passes only when all of its currently **[drive]** events have been
replayed, their step-local assertions pass, and the end state can be explained
as the fold of those recorded deltas. A final-state assertion is still useful
as a checksum, but it cannot replace the event trace. **[fixture]** render checks
and **[design]** gaps are reported separately so a green screenshot run cannot
be mistaken for executable workflow coverage.

---

# Scenario A — Rete Civica Nazionale

*Reference: `principle-docs/RepresentativeParties.md`*

A fictional Italian party of ~18,000 members that adopted the platform to decide
its own positions. It is the thesis under load: liquid delegation, deliberation
before voting, and soft-power accountability inside a legal order that forbids
the imperative mandate (art. 67 Cost.).

## A.0 Deployment profile

```bash
ENFORCE_CIRCLE=true                 # civic bundle: person = verified natural person
CIRCLE_POLICY_ID=rete-civica-nazionale
DATA_MODE=hybrid                    # regional providers gossip; ledger is auditable
DATA_VALIDATION_LEVEL=strict
DATA_PREVIEW=false                  # a party ledger renders nothing uncertified
```

Modules on: `petitions`, `votes`, `delegation`, `groups`, `social`, `federation`,
`topicGardener`. Organization-operations modules stay **off** — a party is not
an employer, and `/organization` would be noise here.

Governance defaults (`/governance`, admin `intent=governance`):
`quorum 250` · `discussion window 14d` · `vote window 7d` ·
`vote method majority` · `delegationDecayDays 180`.

The method stays `majority` on purpose: proposal ballots are yes/no/abstain today,
and publishing `condorcet` would claim a count the code does not perform. Switch it
when multi-method ballots land (ROADMAP Phase 3).

The decay setting is not decoration. It is the answer to the super-delegate
problem (`RepresentativeParties.md` §2.4, §6.2.1): delegated power lapses unless
renewed, so influence has to be re-earned rather than accumulated once and held.
**A7** exercises it.

The ring: the scenario assumes three providers — `rcn-nord` (the one being
replayed), `rcn-sud`, and, in **A10**, a rogue node. Everything through **A9**
works on a single provider; **A10** needs the second one.

Canonical replay order:

```text
A1 arrival → A2 conversation → A4 conflict/group formation → A5 election
→ A6 delegation → A7 decay/renewal → A3 proposals/freeze/vote
→ A8 accountability → A9 governance change → A10 federation
```

This deliberately runs **A3** after **A7**, even though its specification is
presented earlier to keep the document's product narrative readable. The main
vote can then resolve real, already-aged delegation state. A runner that simply
sorts action ids would cast `choice=auto` before those delegations exist and
would be testing a different world.

## A.1 Cast

Sixteen named actors carry the narrative: fifteen civic participants and one
provider operator. They are enough for delegation to form chains rather than
pairs and for conflicts to have two credible sides, but they are **not** enough
to fake a quorum of 250.

| Handle | Role | Who they are | Why they are in the fixture |
| --- | --- | --- | --- |
| `@giulia.ferrero` | person | Nurse, Torino | Raises the waiting-list case from the inside |
| `@marco.deluca` | delegate | Health economist, Bologna | Accumulates delegation — the super-delegate risk |
| `@sofia.bianchi` | delegate | Constitutional lawyer, Roma | Delegate on institutional topics only |
| `@ahmed.ben.salah` | person | Warehouse worker, Prato | Minimum wage from the receiving end |
| `@elena.rossi` | moderator | Party secretary, Milano | Opens votes; her freezes are attributed |
| `@paolo.greco` | person | Retired teacher, Lecce | Phygital: assisted verification, low activity |
| `@chiara.moretti` | delegate | Energy engineer, Brindisi | Local siting conflict, technical authority |
| `@luca.esposito` | person | Restaurant owner, Napoli | Opposes minimum wage — the dissent must exist |
| `@anna.conti` | person | Student, Padova | Ius scholae, high social-lane activity |
| `@davide.villa` | person | Farmer, Cuneo | Land use; delegates almost everything |
| `@irene.fabbri` | delegate | Municipal councillor, Firenze | Elected group delegate in **A5** |
| `@tommaso.ricci` | person | Software developer, Trento | Autonomia differenziata from a rich region |
| `@nadia.hamdi` | person | GP, Palermo | Autonomia from a region that loses |
| `@stefano.lombardi` | person | Union rep, Taranto | Overlaps and conflicts with `@chiara.moretti` |
| `@valentina.sanna` | person | Researcher, Cagliari | Fact-checks; files evidence |
| `@rcn.provider` | admin | Provider operator | Runs the node; never decides policy |

The replay manifest therefore adds a deterministic **supporting quorum cohort**
of at least 235 fictional natural-person agents. Together with the fifteen
named civic participants, this yields at least 250 independently authenticated
potential signers. Supporting agents need stable actor ids and distinct blinded
identities, sessions, and event choices; they do not need invented biographies
or public handles merely to decorate a screenshot. The manifest records which
named people sign and which supporting agents complete the quorum.

The cohort is test infrastructure for scale, not a bulk seed. **A1.1** is
replayed separately for every cohort member, and **A3.3** emits one signature
event per signer. A runner may page their contexts out between turns, but may
not create one session and reuse it 235 times or insert 235 ledger rows through
the adapter.

Two role facts the fixture must preserve, because they are the whole argument of
the thesis:

- `@elena.rossi` is a **moderator**, not an oracle. She can open a vote. She
  cannot decide one, and every freeze she performs is attributed to her.
- `@rcn.provider` is an **admin**. Admin is an *operational* role — modules,
  keys, policy — not a political one. If the provider can move a vote, the party
  does not own its own decisions.

## A.2 Topics

Structural Italian debates, each chosen because it stresses something specific.
Each is a subcategory under an English parent (`Healthcare`, `Labour`,
`Institutions`, `Energy`, `Citizenship`, `Environment`), so a member can delegate
a whole parent and have it reach every subcategory beneath it — narrowest match
first (see `topicMatch.js`).
Each carries its **realtà di riferimento** — the actual norms and numbers the
fictional members argue about — so seeded content reads like Italy, not like
lorem ipsum with Italian words.

| Category | Debate | Stresses |
| --- | --- | --- |
| `Labour / Minimum wage` | Statutory minimum wage | Direct material interest on both sides |
| `Institutions / Differentiated autonomy` | Regional differentiated autonomy | Splits the party geographically, not ideologically |
| `Healthcare / Waiting lists` | Public healthcare waiting lists | Expertise vs lived experience |
| `Energy / Energy transition` | Energy transition and plant siting | Delegation conflict: national good, local cost |
| `Citizenship / Ius scholae` | Citizenship through schooling | Values, not numbers — resists delegation |
| `Environment / Land consumption` | Land consumption | Long-tail: few members, real stakes |

**Realtà di riferimento:**

- `Labour / Minimum wage` — the 2023 unified opposition bill set 9 €/h gross as the
  floor; the CNEL istruttoria (2023) counted **over 900 deposited CCNL**, with
  the ~20 largest covering the great majority of employees — the fight is less
  about contract count than about expired renewals and sub-threshold sectors
  (vigilanza, multiservizi, some terziario). Direttiva (UE) 2022/2041 does not
  oblige a statutory minimum where collective coverage is high; the contested
  question is whether *effective* coverage qualifies.
- `Institutions / Differentiated autonomy` — art. 116 c.3 Cost.; L. 86/2024 ("legge
  Calderoli"); the LEP (livelli essenziali delle prestazioni) as the
  precondition everyone cites and nobody has financed; **sent. 192/2024** struck
  parts of the law; **sent. 10/2025** ruled the total-repeal referendum
  inadmissible. The debate survives all of it — which is why it is in the
  fixture.
- `Healthcare / Waiting lists` — PNGLA priority classes **U/B/D/P = 72h / 10 / 30–60 / 120
  days**; intramoenia (ALPI) bounded by L. 120/2007 — private in-house activity
  may not exceed institutional volumes, a constraint everyone knows and audits
  weakly; DL 73/2024 conv. L. 107/2024 added the national AGENAS platform and
  mandatory disdetta systems.
- `Energy / Energy transition` — aree idonee (d.lgs. 199/2021 + DM 2024),
  commissari straordinari and compensazioni territoriali for strategic plants,
  CER (comunità energetiche rinnovabili, DM CACER 2024) as the bottom-up
  counterweight.
- `Citizenship / Ius scholae` — L. 91/1992 is still the law; the ius scholae proposals tie
  citizenship to a five-year school cycle; the **giugno 2025 referendum**
  (residency 10→5 years) failed quorum at ~30% turnout with ~65% yes among
  voters. Unfinished by design.
- `Environment / Land consumption` — ISPRA/SNPA 2024: ~72 km² consumed in 2023, ~20 hectares a
  day, ~2,3 m²/s; the national framework bill has been stalled for over a
  decade; the EU target is net zero by 2050.

`Institutions / Differentiated autonomy` earns its place by cutting across the party the wrong
way. `@tommaso.ricci` (Trento) and `@nadia.hamdi` (Palermo) are on the same side
of every other topic and opposite sides of this one. A fixture where all
disagreement is one-dimensional cannot show whether the interface helps.

## A.3 Act 1 — Members arrive, and are counted once

**A1.1** each civic participant, named and supporting — `GET /auth/eudi` →
follow the callback — **[drive]**
→ a session exists; the store holds a **blinded hash only**, never a codice
fiscale. This is the "one person = one voice without a PII honeypot" claim, and
it is checkable: grep the store for raw identifiers and find none.
*Realtà:* the OIDC4VP flow simulates what IT-Wallet (live on the IO app since
December 2024: patente, tessera sanitaria, carta europea della disabilità) and
the EUDI Wallet (Reg. (UE) 2024/1183) are making ordinary. The scaffold is the
same handshake with the production wallet swapped in.

**A1.2** each named civic participant — `POST /profile` — `intent=handle`,
`handle=giulia.ferrero` (Giulia's event; use the cast handle for each other
agent) — **[drive]**
→ `@giulia.ferrero` renders everywhere the hash would. A raw hash surfacing as
identity is a bug.

**A1.3** `@marco.deluca`, `@sofia.bianchi`, `@chiara.moretti`, `@irene.fabbri` —
`POST /profile` — `intent=profile-attributes`, `publicBio=...` — **[drive]**
→ delegates carry a public bio. `publicBio` is **provider-local** and must never
appear in a gossip envelope — **A10.4** asserts its absence.

**A1.4** `@paolo.greco` — assisted verification at a local party office — **[design]**
→ The digital divide (`RepresentativeParties.md` §10.1) is a first-class
requirement, and today there is no assisted-enrolment path: someone else's
wallet cannot vouch for Paolo without breaking one-person-one-voice. Keep him in
the fixture as the member the system currently serves worst.

**A1.5** `@rcn.provider` — `POST /admin` — `intent=session`, `sessionRole=delegate` for the four delegates; `sessionRole=moderator` for `@elena.rossi` — **[drive]**
→ roles are assigned by an operator and visible. Note the smell the fixture
deliberately records: **role assignment is a provider act**, which is a live
tension with privilege-free genesis. A party whose secretary is appointed by
whoever holds the server is not self-governing. See **A9**.

**A1.6** `@comitato-riviera` — verifies a session, claims a handle, starts posting calls to action — **[drive]**
→ it is an association's account, not a natural person. `@rcn.provider` sets
`intent=session`, `sessionBanned=true`; every gate now blocks it with a visible
message rather than a silent failure.
→ this is the **exclusion principle** made concrete (`AGENTS.md`: no
org/bot/service accounts may hold handles or act). The fixture needs one such
account *because* the temptation is structural: every Italian party has satellite
committees and associations that would love a voting handle. One person = one
voice dies quietly the day the first comitato gets one.

## A.4 Act 2 — Conversation before any vote

The order matters. A proposal drafted before this act exists is exactly the
failure mode the README names: shipping voting before conversation.

### The waiting-list thread (`Healthcare / Waiting lists`)

**A2.1** `@giulia.ferrero` — `POST /discussion` — **[drive]**
`topic=Healthcare / Waiting lists`, `stance=concern`,
`content=In my department, the first available non-urgent cardiology appointment is 14 months away. Patients who can afford it use intramoenia and are seen within two weeks. Same building, same doctors, same day.`
`evidenceLinks=https://example.rcn.it/waiting-lists/survey-2026`
→ a concrete, checkable claim from someone with standing to make it.

**A2.2** `@marco.deluca` — `POST /discussion` — `topic=Healthcare / Waiting lists`, `stance=support` — **[drive]**
`content=The CUP data I aggregated across three regions confirm it: for priority classes D and P, exceeding PNGLA waiting times is the rule, not the exception. And where the public service runs late, intramoenia in the same specialty runs on time. This is not a local anomaly; it is an economic equilibrium.`
→ expertise *corroborating* lived experience, not overriding it.

**A2.6** `@valentina.sanna` — `POST /discussion` — `topic=Healthcare / Waiting lists`, `stance=neutral` — **[drive]**
`content=Is the 14-month figure a median or a worst case? That changes everything: a median describes the system, while a worst case describes a queue. Before we build a proposal on it, we need the distribution, not an anecdote.`
→ the fixture must contain someone checking, not only asserting.

**A2.11** `@nadia.hamdi` — `POST /discussion` — `topic=Healthcare / Waiting lists`, `stance=concern` — **[drive]**
`content=From general practice: I prescribe priority class B, which means 10 days under the PNGLA. The CUP offers me 96 days, or the paid pathway in the same building. The priority class has become a statement of intent.`
→ the same failure seen from the territory. Two professions, one mechanism.

**A2.12** `@giulia.ferrero` — `POST /discussion` — `topic=Healthcare / Waiting lists`, `stance=neutral` — **[drive]**
`content=@valentina.sanna Median, not worst case: an internal survey of 14 health authorities, March 2026, with the method attached. The worst cases are far beyond that.`
`evidenceLinks=https://example.rcn.it/waiting-lists/survey-method`
→ the fact-check loop **closes**: question asked, method published, thread
moves on. A deliberation culture is exactly this exchange being normal.
→ note the gap the fixture makes visible: the `@mention` here notifies nobody —
mention notifications exist only in the social lane today (`social_mention`),
so Valentina finds this answer by rereading the thread. Logged in
`OPTIMIZATIONS.md`; when discussion mentions notify, this act gains the
assertion.

### The minimum-wage thread (`Labour / Minimum wage`)

**A2.3** `@luca.esposito` — `POST /discussion` — `topic=Labour / Minimum wage`, `stance=concern` — **[drive]**
`content=Nine euros gross per hour for a restaurant with four seasonal employees means either raising prices by 12% or closing in November. I am not against a minimum wage; I am against doing it without looking at hospitality's real margins.`
→ **the dissent must be reasonable.** A fixture whose opposition is a strawman
proves nothing about deliberation.

**A2.4** `@ahmed.ben.salah` — `POST /discussion` — `topic=Labour / Minimum wage`, `stance=support` — **[drive]**
`content=At my warehouse, the pirate contract pays €6.40 an hour. That is not competition on margins; it is competition over who will accept less. The minimum wage does not close honest businesses; it closes the ones that survive like this.`
→ the reply that makes the disagreement real. Both are true at once. This is
the pair the interface has to hold without flattening.

**A2.9** `@valentina.sanna` — `POST /discussion` — `topic=Labour / Minimum wage`, `stance=neutral` — **[drive]**
`content=CNEL figures, 2023 review: more than 900 CCNL agreements are filed, but the 20 most used cover the vast majority of employees. The problem is not the number of contracts; it is renewals expired for years and pay scales below €7 in security, multiservices, and parts of the tertiary sector. Any proposal must say what it does about THIS.`
→ the researcher reframes the fight with the actual CNEL finding. Evidence
changes what the proposal will have to address.

**A2.10** `@marco.deluca` — `POST /discussion` — `topic=Labour / Minimum wage`, `stance=neutral` — **[drive]**
`content=EU context: Directive 2022/2041 does not require a statutory minimum where collective-agreement coverage is high. The real question is whether our EFFECTIVE coverage — weighted for expired renewals — meets that standard. If it does not, a statutory minimum is not ideology; it is compliance.`
→ the economist supplies the frame the debate actually happens in.

### The split that isn't left-right (`Institutions / Differentiated autonomy`)

**A2.5** `@tommaso.ricci` and `@nadia.hamdi` — `POST /discussion` ×3 — **[drive]**
- Tommaso, `stance=support`: `Healthcare administration in the special-autonomy and benchmark regions shows that local fiscal responsibility can work. The problem is not autonomy; it is doing it without LEP.`
- Nadia, `stance=concern`: `Without funded LEP, autonomy locks in historic spending: those who have always had less continue to have less, only this time by contract. The Constitutional Court said this clearly in judgment 192/2024 — it is not a technical detail.`
- Tommaso, `stance=neutral`: `You are right about LEP, and I admit it: without funding, my position does not stand up. But that means the fight is for LEP, not against autonomy itself.`
→ a member **concedes a point in public and survives**. The most load-bearing
post in the fixture: deliberation that never changes anyone's position is
theatre, and screenshots should be able to show the opposite happening.

### The rest of the map

**A2.16** `@anna.conti` — `POST /discussion` — `topic=Citizenship / Ius scholae`, `stance=proposal` — **[drive]**
`content=The June 2025 referendum on reducing the residency requirement from 10 to 5 years missed quorum with about 30% turnout — but about 65% of those who voted said yes. And ius scholae was not even on the ballot: under Law 91/1992, five years of schooling in Italy count for nothing. I propose that we take this to the assembly.`
→ the topic that resists delegation: values, not parameters. Watch **A6.8**.

**A2.17** `@davide.villa` — `POST /discussion` — `topic=Environment / Land consumption`, `stance=concern` — **[drive]**
`content=ISPRA reports about 20 hectares of land consumed per day, 2.3 square metres per second. The national law has been stalled for more than ten years. Meanwhile, my municipality is sealing yet another agricultural area for logistics. Does anyone besides me work on this?`
→ **the long tail**: one member, one post, a real stake. The principle docs
promise the small topic is not buried by volume; the fixture needs one to check.

### The social lane stays social

**A2.7** `@anna.conti` and others — `POST /social/post`, `POST /social/follow` — **[drive]**
`targetHandle=...`, `type=circle|interest|info|alerts`
→ ~20 short posts, ~30 typed follow edges. Small talk, referendum-night
commentary, links to the forum pieces. If a screenshot cannot show at a glance
that a social post is not a vote, the lane separation has failed.

**A2.13** `@anna.conti` — `POST /social/post` with a photo (multipart), then `@luca.esposito` — `GET /social/media/{id}?view=1` — **[drive]**
→ the banchetto photo from referendum night uploads **locked by default**;
Luca's view request notifies Anna (`/notifications`); the media never leaves the
provider. Provider-local media with view-on-request is a *policy* claim — this
is its fixture.

**A2.14** `@luca.esposito` — `POST /social/post` — `reshareOf=<id of Sofia's article post>`, `content=Read this before talking about an "imperative mandate" at the bar.` — **[drive]**
→ a reshare with commentary. Note the code's own rule: reply and reshare are
mutually exclusive (`conflicting_intent`) — a test should assert the 400, not
just the happy path.

**A2.15** `@rcn.provider` sets `rateLimitOverrides` to `discussion_post:60:6`; `@anna.conti` posts a seventh time inside the window — **[drive]**
→ 429 with a human message, no CAPTCHA anywhere. Identity-based throttling is
the anti-spam story (`AGENTS.md`); the fixture must include one member actually
hitting it on referendum night, because that is when it will happen for real.

**A2.8** `@sofia.bianchi` — `POST /forum` — **[drive]**
`title=Why software cannot engineer around the free-mandate rule`
`content=` art. 67 Cost.; the M5S/Rousseau experience as the cautionary tale the
platform is built against; soft power as the only constitutional path.
→ plus a `POST /forum/comment` (`parentId=...`) from `@tommaso.ricci` asking
how §9.3's "ethical pact" differs from a party whip — the comment a reader
would actually leave.

**A2.18** the topic gardener proposes merging stray tags (`health`, `public-health`) into `Healthcare / Waiting lists`; `@rcn.provider` reviews in `/admin` — **[drive]**, with `src/infra/workers/topic-gardener/server.py` running and its URL configured
→ rename/merge suggestions appear with previews; accept records topic history;
discussions keep their threads. Members named their topics freely and the
garden stays tidy **with a human gate** — never silently.

Volume target: **≥30 discussion posts across all 6 topics, ≥20 social posts,
≥3 forum articles with comments.** Below that, topic filters, the gardener, and
pagination all render as empty chrome.

These are event counts, not permission to generate a final dataset. The replay
manifest expands the remaining discussion/social/forum volume into concrete
child events with stable actor, intent, content, and simulated time. Each is
submitted and observed separately. If that manifest has only the named examples
above and bulk-inserts the rest, the volume target is uncovered and the replay
must report it as such.

## A.5 Act 3 — A proposal earns its way to a vote

**A3.1** `@giulia.ferrero` — `POST /petitions` — **[drive]**
```
title=Conditional intramoenia: an ALPI cap wherever PNGLA windows are missed
quorum=250
summary=In specialties where public-service waiting times exceed PNGLA priority
        classes, intramoenia activity in the same specialty falls to 15% of
        public-service volumes until those times return to compliance.
problem=Law 120/2007 already prohibits ALPI from exceeding public-service
        volumes, but the constraint is aggregated and weakly checked. The
        result: the same facility delivers in two weeks, for payment, what it
        delivers free of charge in fourteen months. This is not a waiting list;
        it is a pricing mechanism.
proposedAction=A 15% cap per specialty, tied to the national platform's
        monitoring (Law 107/2024), with automatic suspension once waiting times
        return to the U/B/D/P priority classes.
impact=Patients without the means to pay regain access within statutory time
        limits; the existing constraint becomes verifiable by specialty.
risks=Specialists may leave for the fully private sector; the cap must be paired
        with incentives for public-service activity, not sanctions alone.
implementationPlan=Measure at three months on the national platform; trial the
        cap in two pilot health authorities at six months; review at twelve.
evidenceSummary=RCN survey of 14 health authorities (March 2026); review of
        AGENAS monitoring; legal framework: Laws 120/2007 and 107/2024.
evidenceLinks=https://example.rcn.it/waiting-lists/survey-2026
```
→ The `problem` field now does the honest thing: it names the law that already
exists and says *why it fails* — the proposal tightens a weak constraint rather
than inventing a new right. That is what a credible Italian policy draft looks
like, and the structured outline is what forces the distinction.

**A3.2** `@marco.deluca` — `POST /petitions/update` — **[drive]**
revises the cap to 20% after modelling specialist retention; revision history
and a diff must be inspectable.
→ **the draft changed, and who changed it is on the record.**

**A3.3** 250+ concrete signer agents — `POST /petitions/sign` —
`petitionId=...` — **[drive]**
→ quorum moves the proposal to `discussion` **on its own**. No moderator
touches it. If quorum were discretionary the signatures would be theatre.
→ Replay `A3.3/sign-001` through `A3.3/sign-250` in order. After signature
249, the acting agent and a separate observer must still see the pre-quorum
state. Signature 250 is the single cause of the transition; only then may the
proposal render as `discussion`. Every signature must carry a distinct session
and blinded identity.

**A3.10/preferences** `@giulia.ferrero` —
`POST /notifications/preferences` — `notifyProposalComments=on` — **[drive]**
→ preference persistence is asserted before another person comments. This is
the first child event of stable parent **A3.10**; it is not bundled with the
later inbox read.

**A3.4** `@luca.esposito` — `POST /petitions/comment` — `stance=concern` — **[drive]**
`content=If the cap bites, specialists will move to accredited private providers and public-service waits will worsen. The risk is written into the proposal itself: what concretely offsets it?`

**A3.10/observe** `@giulia.ferrero` — `GET /notifications` — **[drive]**
→ in her own restored context, Giulia observes the alert caused by **A3.4**.
The orchestrator may not infer delivery from Luca's successful response.

**A3.10/read** `@giulia.ferrero` — `POST /notifications/read` — **[drive]**
→ the same notification becomes read and remains tied to Giulia's verified
handle. Parent **A3.10** now proves the full preference → event → observation →
read loop as three interactions by two agents.

**A3.5** `@valentina.sanna` — `POST /petitions/comment` — `stance=question`, `factCheck=yes` — **[drive]**
`content=The survey covers 14 health authorities out of more than 100: is that a sufficient sample for a national cap? I request a review of the sampling method.`
→ a fact-check request on a specific claim, not a vibe.

**A3.6** `@sofia.bianchi` — `POST /petitions/comment` — `stance=concern`, `argumentTitle=Regional competence` — **[drive]**
`content=Healthcare organization is a regional competence under Title V: a national cap by specialty risks a conflict of competences. The realistic lever is national monitoring plus recovery plans, not a uniform constraint.`
→ the argument-map node a constitutional lawyer would actually write.

**A3.9** `@marco.deluca` — `POST /petitions/comment` — `stance=support`, `argumentParentId=<A3.6's node>` — **[drive]**
`content=That is why the proposal attaches to the existing national platform under Law 107/2024: no new competence, only conditions tied to monitoring already in place.`
→ a **rebuttal in the tree, not a new thread**. The argument map is only worth
its code if the fixture contains an actual pro/con exchange under one node.

**A3.11** `@giulia.ferrero` — `POST /petitions/update` — **[drive]**
`risks` and `implementationPlan` revised to answer **A3.4** (institutional-activity
incentives funded before the cap bites) and **A3.5** (sampling method annexed).
→ **deliberation visibly changed the text.** Version history now shows: draft →
economist's cap revision → author's response to the concerns. That chain *is*
the deliberative workbench thesis (§4.3); a fixture without it shows a comment
box, not deliberation.

**A3.7** `@elena.rossi` — `POST /petitions/status` — `status=vote`, `confirmFreeze=yes` — **[drive]**
→ the text freezes, **attributed to her, with a revision id**. Votes are cast
against text that cannot move underneath them. The author cannot do this
(verified: `/petitions/status` requires `moderate`).

**A3.8** members — `POST /petitions/vote` — `choice=yes|no|abstain|auto` — **[drive]**
→ each vote is a signed envelope. `choice=auto` resolves through delegation —
that is where **A6** and **A7** land. Luca votes `no` and the tally shows it:
a unanimous fixture would hide whatever the tally view gets wrong about
minorities.

**A3.12** `@ahmed.ben.salah` — `POST /petitions` — **[drive]**
`title=An effective €9 floor tied to collective-agreement coverage`,
`quorum=250`
→ the first draft answers Luca's margin concern in **A2.3** rather than erasing
it, and its evidence summary cites the effective-coverage question in **A2.10**.
Populate the remaining structured outline fields through the visible form from
those observed discussion facts; do not clone **A3.1** through storage.

**A3.13** `@ahmed.ben.salah` — `POST /petitions/update` — **[drive]**
→ after independently reopening and observing Valentina's **A2.9** evidence,
Ahmed revises the proposal to distinguish deposited CCNL count, effective
coverage, and expired sub-threshold contracts. The revision diff names the
evidence-driven change.

**A3.14** 250 concrete signer agents — `POST /petitions/sign` — **[drive]**
→ expand to `A3.14/sign-001` … `A3.14/sign-250`. The proposal remains `draft`
through signature 249 and moves to `discussion` only on 250, under the same
distinct-agent and step-local counter assertions as **A3.3**.

**A3.15** `@davide.villa` — `POST /petitions` — **[drive]**
`title=Stop net land consumption around the Cuneo logistics corridor`,
`quorum=250`
→ the long-tail concern in **A2.17** becomes a visible draft without pretending
that local salience has already produced national support.
Populate its structured outline through the form from **A2.17** and the
`Environment / Land consumption` reference facts above.

**A3.16** 41 concrete signer agents — `POST /petitions/sign` — **[drive]**
→ expand to `A3.16/sign-001` … `A3.16/sign-041`; assert the counter after every
signature and assert that the proposal remains `draft` after number 41. The
missing 209 signatures are meaningful state, not setup left for later.

Stage-diversity target: these three proposals finish in different stages — the
intramoenia proposal in `vote`, `Labour / Minimum wage` in `discussion`, and
`Environment / Land consumption` in `draft` below quorum. **A4.1** (specified in the next section
but replayed earlier by the canonical phase schedule) creates a fourth,
conflict-focused proposal; none may be preloaded to obtain this arrangement.

## A.6 Act 4 — A conflict that delegation cannot resolve by itself

**A4.1** `@chiara.moretti` — `POST /petitions` — `title=Coastal regasification terminal: national position` — **[drive]**
`summary=` national energy security, the extraordinary-commissioner powers, and
territorial compensation provided by current law; the floating regasification
terminal should be accepted with negotiated conditions, not simply endured.

**A4.2** `@stefano.lombardi` — `POST /petitions/comment` — `stance=concern` — **[drive]**
`content=My members live two kilometres from the quay. The benefit is national; the cost is theirs: the view, fishing, and perceived risk. Compensation must not be negotiated AFTER the national position; it must be negotiated into it.`
→ **Both are right.** `Energy / Energy transition` exists in the fixture to hold a
conflict with no correct answer, only an accountable one.

**A4.3** `@chiara.moretti` — `POST /groups` — `action=create`, `name=Energy and Territory Circle`, `topics=Energy / Energy transition, Environment / Land consumption` — **[drive]**
`description=CER, suitable areas, strategic plants: where the national meets the local.`
→ the second group. One group cannot show a group *list*, and the two groups
run **opposite election policies** (see A4.4 vs A5.3) — the contrast is the
fixture.

**A4.4** `@chiara.moretti` and `@stefano.lombardi` — `POST /groups/delegate` — `groupId=...`, `topic=Energy / Energy transition`, `delegateHash=<own>`, `priority=80` / `priority=60` — **[drive]**
→ **priority-mode cachet**: the group publishes ranked delegate preferences
without any election (`electionMode=priority`, the default). Chiara outranks
Stefano on paper; his members now have a reason to look at **A6.5**'s conflict
prompt. Both mechanisms — priority and vote — must exist in the replayed state or
the group-policy separation is untested.

## A.7 Act 5 — Groups, and choosing people

**A5.1** `@irene.fabbri` — `POST /groups` — `action=create`, `name=Public Healthcare Circle`, `topics=Healthcare / Waiting lists, Labour / Minimum wage` — **[drive]**
**A5.2** eight members — `POST /groups` — `action=join` — **[drive]**
**A5.3** `@irene.fabbri` — `POST /groups/policy` — `electionMode=vote`, `conflictRule=prompt_user` — **[drive]**
→ `prompt_user` is the honest setting: when recommendations clash the member
chooses. `highest_priority` would decide silently on their behalf.

**A5.4** `@irene.fabbri` — `POST /groups` — `action=startElection`, `topic=Healthcare / Waiting lists`, `candidates=marco.deluca,giulia.ferrero,valentina.sanna` — **[drive]**

**A5.5** nine members — `POST /groups` — `action=voteElection`, `electionId=...`, `candidateHash=...`, `secondChoiceHash=...`, `thirdChoiceHash=...` — **[drive]**
→ the ballots are part of the fixture, because the arithmetic is the test:

| Ballots | 1st | 2nd |
| --- | --- | --- |
| 4 | `marco.deluca` | — |
| 3 | `giulia.ferrero` | `valentina.sanna` |
| 2 | `valentina.sanna` | `giulia.ferrero` |

Round 1: Marco 4, Giulia 3, Valentina 2 → Valentina eliminated. Round 2: her
two ballots transfer to Giulia → **Giulia 5, Marco 4**.
→ the election is **decided on transfers, and the first-preference leader
loses**. The economist with the most delegated weight in the party loses a
group election to the frontline nurse — Alaska-style transfers doing exactly
what they exist to do. Assert: winner `giulia.ferrero`, method `vote`, rounds 2.

**A5.6** `@irene.fabbri` — `POST /groups` — `action=closeElection`, `electionId=...` — **[drive]**
→ winner, method, and round count surface on the card; the group's delegate
cachet for `Healthcare / Waiting lists` updates to Giulia automatically.

**A5.7** the group's recommendation reaches a member — **[drive]**
→ it is **advisory**. A member who ignores it is not overridden. Group cachets
inform; they never bind (`AGENTS.md`: "Recommendations are advisory").

**A5.8** `@luca.esposito` — `POST /groups` — `action=leave` — **[drive]**
→ he joined to argue the employer's case and found the group too
sector-specific. Leaving is unceremonious and total: the card flips back to
Join, his ballot history stays (cast votes are facts), and no recommendation
reaches him again. Exit must be as cheap as entry or groups become parties
inside the party.

## A.8 Act 6 — Liquid delegation, and being able to read it

**A6.1** `@davide.villa` — `POST /delegation` — `intent=set`, `topic=Healthcare / Waiting lists`, `delegateHash=marco.deluca` — **[drive]**
**A6.2** `@paolo.greco` — `POST /delegation` — `intent=set`, `topic=Healthcare / Waiting lists`, `delegateHash=giulia.ferrero` — **[drive]**
**A6.3** `@giulia.ferrero` — `POST /delegation` — `intent=set`, `topic=Healthcare / Waiting lists`, `delegateHash=marco.deluca` — **[drive]**
→ **transitive chain**: `@paolo.greco → @giulia.ferrero → @marco.deluca`.
`/delegation` must state plainly where Paolo's vote ends up. A chain a member
cannot read is a chain they cannot revoke, and revocability is the entire
mechanism (§2.2.2).

**A6.4** `@davide.villa` — `POST /delegation` — `intent=set` on five topics — **[drive]**
→ the member who delegates nearly everything. Legitimate, and the thing to
watch.

**A6.5** conflict — the Public Healthcare Circle cachet now recommends `@giulia.ferrero` (the election winner, per vote-mode policy); `@davide.villa`'s manual choice is `@marco.deluca` — `POST /delegation/conflict` — **[drive]**
→ with `conflictRule=prompt_user`, **he chooses** — and he keeps Marco, against
the election result. The prompt names both sources and why each is suggested
(election-winner metadata included). Advisory-vs-binding stops being a doc
claim exactly here: a member overrides a formal election and the system's only
job is to make sure he did it knowingly.

**A6.6** `@marco.deluca` accumulates delegations across `Healthcare / Waiting lists`,
`Labour / Minimum wage`, `Energy / Energy transition` — **[drive]**
→ **the super-delegate, on purpose.** §2.4 says this is the model's most serious
failure mode and the German Pirate Party observed it for real. The fixture must
*contain* it, or nothing tests the mitigation.

**A6.7** — soft cap on concentrated delegated weight — **[design]**
→ §6.2.1 pairs decay with soft caps. Decay exists; caps do not. Recorded as a
gap, not a test.

**A6.8** `@anna.conti` — `POST /delegation` — `intent=clear`, `topic=Citizenship / Ius scholae` — **[drive]**
→ she had delegated the topic to Sofia; after the assembly debate (**A2.16**)
she clears it to vote in person. Some questions do not delegate — the interface
must make taking a vote *back* one gesture, because §2.2.2's revocability
promise is measured at exactly this moment.

## A.9 Act 7 — Power that lapses

**A7.1** advance past `delegationDecayDays=180` — **[drive]**
→ `@davide.villa`'s un-renewed delegations **lapse** and drop out of
resolution. Influence is not a possession.

**A7.2** `@davide.villa` — `POST /delegation` — `intent=renew`, `topic=Healthcare / Waiting lists` — **[drive]**
→ renewed deliberately, one topic. He does not renew the other four.
→ the difference between 5 delegations and 1 after decay is the mechanism
working. `/delegation` shows freshness pills; a test asserts resolution changes.

## A.10 Act 8 — Accountability without compulsion

**A8.1** `GET /delegates/{hash}` for `@marco.deluca` — **[drive]**
→ delegation counts, vote history, group endorsements, public bio, advisory
deliberation score — and, after **A5.5**, a lost election on the record next to
the accumulated delegations. That juxtaposition is the §9.3.2 dashboard doing
its job.
→ The score is **advisory and must stay so**. A binding score would be an
imperative mandate wearing a number.

**A8.4** `GET /delegates` — search `sanna` — **[drive]**
→ the People directory finds Valentina by handle fragment, shows role and
delegation counts. Members discover delegates by *browsing people*, never by
pasting hashes; the delegation form's datalist draws from the same directory.

**A8.2** `GET /transactions` — **[drive]**
→ every draft, revision, signature, status change, vote, and delegation
override, attributed to a blinded hash.
→ this *is* the accountability dashboard of §9.3.2: not a promise of obedience,
but a record no one can quietly rewrite. Soft power, per §9.3.

**A8.5** `GET /votes/ledger` — **[drive]**
→ the signed envelopes export: issuer, policy id/version, petitionId,
authorHash, choice, signature. Verify one against `CIRCLE_PUBLIC_KEY`. This is
the artifact a losing side audits instead of crying fraud — the E2E-verifiability
claim of §3.2 in its current, honest scope.

**A8.3** `@elena.rossi` votes against the platform's own outcome — **[drive]**
→ **nothing stops her.** The record shows it; the party responds politically at
re-selection. Art. 67 is intact. A fixture that cannot express this has misread
the thesis: the model's compliance with the free mandate is not incidental, it
is the design.

## A.11 Act 9 — Governance changes itself

**A9.1** `@tommaso.ricci` — `POST /governance/proposals` — **[drive]**
`governanceProposalTitle=Reduced quorum for proposals with regional impact`
`governanceProposalQuorumDefault=120`
`governanceProposalReason=A land-consumption proposal in one municipality cannot reasonably collect 250 national signatures: a uniform quorum kills the long tail.`
→ a member proposes changing the constitution's defaults — motivated by
Davide's stalled `Environment / Land consumption` draft, which is the fixture proving his point.

**A9.2** `@rcn.provider` — `POST /admin` — `intent=governance-proposal-decision` — **[drive]**
→ accepted; defaults update; the decision enters public history.
→ **The tension is the point, and the fixture should not hide it.** A provider
admin approving the party's constitutional defaults is the "rented land"
problem of §3.4 reappearing one layer up. Today it is admin-gated. Whether that
should become a member vote is a live design question — see **A1.5**.

## A.12 Act 10 — The ring

A party that lives on one server is one seizure away from not existing. The
hybrid profile assumes regional providers gossiping a shared ledger. These acts
are driven by the node tests (`p2p`, `gossip-policy`, ring consistency) rather
than by `user-journeys.js`.

**A10.1** `@rcn.provider` — `/admin` — add peer `https://sud.example.rcn.it` (`peerJoin`), enable gossip push/pull — **[drive]**
→ `/admin` shows the peer with capability hints (modules + data mode); `/health`
records ledger hash snapshots per peer (match/mismatch).

**A10.2** a member verifies on `rcn-sud`; the uniqueness entry gossips to `rcn-nord` — **[drive]**
→ the same natural person cannot verify twice across the ring. One person = one
voice is a *ring* property, not a server property, and this is where it is
enforced or lost.

**A10.3** a rogue node with `CIRCLE_POLICY_ID=lista-x` pushes gossip at `rcn-nord` — **[drive]**
→ **rejected on policy id/version mismatch**; peer health records the failure;
repeated attempts quarantine the peer. Federation without this check is an
injection vector, not resilience.

**A10.4** inspect every gossip envelope leaving `rcn-nord` — **[drive]**
→ no `publicBio`, no contact fields, no provider-local attributes — only ledger
hashes, capability hints, and signed envelopes. What is provider-local **stays**
provider-local; **A1.3** made the promise, this act checks it.

## A.13 End state

A reviewer opening this deployment should find: 15 named civic participants
with handles, the provider operator, and a supporting cohort yielding at least
250 independently authenticated potential signers, plus one **banned org
account** with a visible gate message · 6 live
topics tended by a reviewed gardener merge · ≥30 discussion posts including a
closed fact-check loop and a public concession · ≥20 social posts with typed
follows, one reshare, one locked photo with a view request, one rate-limit hit ·
3 forum articles with comments · at least 4 proposals, including the staged
`draft`/`discussion`/`vote` trio and the open conflict proposal from **A4.1** ·
at least 541 independently replayed signatures (250 + 250 + 41), with one
proposal below quorum on purpose · a frozen text with an attributed freeze and
a 3-revision history that answers its own deliberation · a ranked
election **won on transfers against the first-preference leader** · a
priority-mode cachet coexisting with a vote-mode one · a readable 3-hop
delegation chain · a conflict prompt resolved against the election winner ·
lapsed and renewed delegations · a populated audit log and a verifiable vote
ledger · two federated providers agreeing on one ledger, and a rogue one
quarantined.

No screen should be empty. Every number on screen should have a story behind it
that a member could recount.

---

# Scenario B — ASL Val Sereno

*Reference: `principle-docs/OrganizationPressureManagement.md`*

A fictional Azienda Sanitaria Locale: ~4,200 staff, one presidio ospedaliero
(DEA di I livello), four distretti, thirty-one RSA and outpatient sites. It
adopted the platform as a **shared inbox**. Nothing else. Every structure below
had to earn its place.

Healthcare is here as the stress test (§ *Healthcare as a stress test*): urgent,
expert, legally exposed, and unforgiving of a tool that mistakes a clinical
judgement for a poll.

## B.0 Deployment profile

```bash
ENFORCE_CIRCLE=false                # staff are authorized, not "verified persons"
DATA_MODE=centralized               # patient-adjacent context does not gossip
DATA_VALIDATION_LEVEL=strict
DATA_PREVIEW=false
```

Modules on at event 0: `coordination` only. This is intentionally a usable
shared inbox, not a preassembled organization model.

`protectedVoice`, `responsibilities`, `sectors`, `hierarchies`, `authority`,
`funds`, `mediation`, `pressureAnalytics`, and `impactTracking` all begin
**off** and are enabled by the explicit provider-agent events below, one at a
time. `petitions`, `votes`, `delegation`, `groups`, and `federation` remain off
for the entire scenario.

That module list is a claim worth stating aloud: **an ASL does not vote on
clinical decisions.** §*Non-goals* — "voting on every operational or expert
decision", "replacing emergency command". A deployment that turns on `votes`
here has misunderstood the product. The organization layers are switched on
only after an interaction demonstrates why each is needed — the adoption
staircase, walked rather than installed as final state.

Canonical replay order is the written order: `B1 → B2 → B3 → B4 → B5 → B6`.
Skipped **[design]** and separately mounted **[fixture]** items remain visible
as gaps in the trace; they do not disappear and they do not create state for a
later **[drive]** event.

The actor label is `user`, not `person`. Verifying that Nadia is authorized
staff is not the same as publishing that a concern came from Nadia.

One legal boundary, stated up front because Italian law states it: the
protected-voice path **is not** the whistleblowing channel. D.lgs. 24/2023
obliges the ASL to run a dedicated internal channel and preserves the external
ANAC one; segnalazioni that fall under it belong there, and the platform's copy
must say so rather than absorb them (**B3.3**).

## B.1 Cast

| Handle | Role | Position | Why they are in the fixture |
| --- | --- | --- | --- |
| `@n.calabrese` | user | Infermiera, Pronto Soccorso | Raises the boarding case at 03:40 |
| `@r.ferrara` | user | Coordinatore infermieristico (caposala) | The overloaded intermediary |
| `@dott.marino` | user | Direttore U.O.C. Medicina d'Urgenza | Keeps the clinical decision right |
| `@l.deangelis` | user | Bed manager di presidio | The node the mirror reveals |
| `@dott.ssa.vitale` | user | Direzione medica di presidio | Approves the pilot inside existing policy |
| `@f.gallo` | user | Farmacia ospedaliera | Release timing owner |
| `@s.pellegrino` | user | Logistica e trasporti | Delivery capacity |
| `@dott.sa.rizzo` | user | Risk manager / sicurezza del paziente | Holds the stop condition |
| `@a.bruno` | user | Direzione amministrativa | Envelope and ceiling |
| `@m.serra` | user | OSS, RSA Distretto 3 | Long-tail: small site, real need |
| `@g.lombardo` | user | MMG, Distretto 2 | Territorial view the hospital lacks |
| `@t.russo` | user | Infermiera di comunità, COT Distretto 2 | The DM 77 side of the boarding chain |
| `@caso-4471` | protected | *Protected case identity* | Dispute intake — never resolves to a person |
| `@rsu.valsereno` | user | RSU / union rep | Present when staff load is the issue |
| `@asl.provider` | admin | IT / provider operator | Enables layers; decides nothing clinical |

`@caso-4471` is the load-bearing entry. It is **not a pseudonym for a real
handle in the fixture** — no mapping exists to reveal. If a test can walk from
`@caso-4471` to a staff member, protected voice is broken.

## B.2 Sectors

Views over one canonical case, never copies (§*Sectors and dynamic structure*):

`pronto-soccorso` · `medicina-urgenza` · `farmacia-ospedaliera` · `logistica` ·
`sicurezza-paziente` · `distretto-2` · `distretto-3` · `rsa-vs-nord` ·
`direzione-amministrativa` · `personale-benessere`

Each case↔sector link states *why*: origin · owner · affected · consulted ·
safeguard · constraint · observer.

## B.3 The cases

Four cases, one per voice type and one per visibility level — the matrix the
interface claims to support. These map onto `ORGANIZATION_TEMPLATE_CASES` in
`src/modules/organization/organizationTemplate.js`, field for field, and are
intended to **replace** the current care-cooperative placeholders. Each carries
its realtà di riferimento.

### B-1 `boarding-pronto-soccorso` — Fundamental need — Role-visible

```
title:        Patients on trolleys in the ED for more than 24 hours because no beds are available
sender:       Emergency Department — night shift
subject:      Prolonged boarding: 11 patients waiting for admission at 03:40
voiceType:    Fundamental need
visibility:   Role-visible
sourceChannel: Email
pressureType: Chronic
pressureState: Crystallized
trend:        Increasing at weekends
scope:        Emergency Department · Emergency Medicine · Hospital Medical Directorate
request:      Review admission flow and bed availability at weekends.
consequence:  Older patients remain on trolleys for more than 24 hours; triage
              reassesses patients it cannot admit; the risk shifts onto the shift.
dependency:   Supported discharge, Medicine beds, district COT and ADI capacity,
              and RSA availability must be considered together.
emailBody:    At 03:40 we have 11 patients waiting for a bed, four for more than
              24 hours, including two people over eighty. This is not a spike:
              it is the fourth consecutive weekend. Triage keeps reassessing
              patients we cannot admit.
impactBaseline: 4 consecutive weekends · median admission wait 19h · peak 27h
impactTarget:   Median below 8h without shifting the wait onto community services
impactMeasure:  Triage→admission time, reassessments per patient, nursing overtime
```

*Realtà:* boarding is the documented chronic failure of Italian PS — SIMEU has
censused thousands of boarded patients on single national survey days, and the
literature ties boarding beyond ~8h to worse outcomes. The structural backdrop
is DM 70/2015 (bed standards at 3,7/1000) meeting DM 77/2022's still-maturing
territorial layer (COT, Case della Comunità, ADI at 10% of over-65s as the PNRR
target): the exit path from the ward is the constraint, which is why
`@t.russo`'s COT sits in the dependency line. **Crystallized**, not Critical —
it recurs, it is worked around, nobody is surprised any more, and that is
precisely why it never gets fixed. `impactTarget` carries the anti-displacement
clause because "success" that relocates the wait onto `@g.lombardo`'s district
is not success (§*Impact tracking*).

### B-2 `liste-attesa-cup` — Advice & innovation — Fully attributed

```
title:        CUP cancellation recovery: rapid recall list
sender:       @g.lombardo — GP, District 2
voiceType:    Advice & innovation
visibility:   Fully attributed
pressureType: Acute
pressureState: Flowing
request:      Automatically recall patients after cancellations within 48 hours
              for priority class B.
consequence:  About 9% of specialist slots remain unused while stated waiting
              times exceed PNGLA limits.
```

*Realtà:* the mechanics are those of L. 107/2024 — CUP unici, mandatory disdetta
handling, the national AGENAS platform — and the ~10% no-show rate every CUP
knows. Deliberately **Flowing** and low-stakes: the fixture must show the system
working normally, or the pressure cue is just an alarm that is always on. Fully
attributed because Giovanni *wants* the credit — a legitimate choice, not a
default.

### B-3 `farmaci-alto-costo` — Resource consultation — Department-visible

```
title:        Consultation on the spending ceiling for high-cost oncology drugs
sender:       Administrative Directorate
voiceType:    Resource consultation
visibility:   Department-visible
amount:       €2,400,000 remaining annual budget
ceiling:      €150,000 without a resolution by the Director General
fundsState:   Options visible · no allocation
consequence:  The choice changes time to treatment access, not only cost.
```

*Realtà:* the frame is the fondo nazionale farmaci innovativi (~€1,2 mld/anno),
AIFA's monitoring registries, and managed-entry agreements (payment-by-result)
— the world in which an ASL actually reasons about a CAR-T or a new oncologic.
The case makes §*Money and resource handling* concrete — and its limit
explicit. Ward staff can show consequences accounting cannot see; accounting can
show constraints wards cannot see. **The decision still belongs to the person
the law authorizes** — the delibera is the Direttore Generale's, and the
interface makes the constraint legible without democratising it.

### B-4 `conflitto-turni-rsa` — Dispute — Protected

```
title:        Recurring dispute over night coverage in the RSA
sender:       @caso-4471 (protected case identity)
voiceType:    Dispute
visibility:   Protected relay
pressureType: Oscillating
pressureState: Crystallized
consequence:  One care assistant covers 42 residents at night; the shift dispute
              has replaced the discussion about staffing levels.
```

*Realtà:* regional minutaggio standards (assistance minutes per guest per week)
are the yardstick night cover is measured against, and the national nursing
shortage (FNOPI estimates above 60,000 missing) is why the roster cannot simply
be thickened. The dispute is **not** the case. The staffing level is.
§*Mediation and pacification* is explicit that pacification is not suppression:
mediation here must not become a way to settle the interpersonal friction and
leave 42 residents with one OSS. **B4.4** tests exactly that.

## B.4 Acts

### B1 — The inbox, alone

**B1.1** `@n.calabrese` — email arrives in the shared inbox — **[fixture]**
**B1.2** `@r.ferrara` — reads, replies, sets a response boundary — **[design]**
→ Invariant 1: *communication must work alone.* No case, no owner, no taxonomy.
The ASL could stop here and have gained something.

**B1.3** the corroborating signals — `POST /discussion`, topic `pronto-soccorso` — **[drive]**
→ the messaging kernel records four real messages from three
different shifts:
- `@n.calabrese` (Sat 21/02, `stance=concern`): the 03:40 email above, posted;
- `@r.ferrara` (Sat 28/02): `Confirmed from Saturday's shift: 9 waiting at 02:00, median 17 hours. I had to move a trolley into the examination corridor.`
- `@n.calabrese` (Sat 07/03): `Third weekend: 12 waiting, one patient over ninety at 26 hours. Triage reassessments have become our main activity.`
- `@l.deangelis` (Sat 14/03): `From bed management: on Saturday I have zero Medicine beds until Monday discharges. The problem is not the ED; it is that the hospital does not discharge patients at weekends.`
→ **volume=4 has four entries behind it.** When `pressureAnalytics` renders
"4 corroborating signals", these are them. The bed manager's post is the pivot:
the person the actual-flow mirror will later expose as the bottleneck is
already, visibly, the one explaining it.

**B1.4** `@r.ferrara` — `POST /discussion`, topic `pronto-soccorso`, `stance=neutral` — **[drive]**
`content=Received and logged. I am taking this to the admissions-flow group with the medical directorate: a response by Monday 12:00, with an owner and scope. In the meantime, report EVERY weekend, even if it feels repetitive — recurrence IS the data.`
→ acknowledgement with a stated boundary, as a message anyone can read. The
*tracked* response boundary (a field with a clock on it) stays **[design]**;
the social fact of the promise is replayable today.
→ note for the kernel's own backlog: `/discussion` is flat — the acknowledgement
cannot thread under the signal it answers. Scenario B is the deployment that
makes that gap visible (logged in `OPTIMIZATIONS.md`).

### B2 — A message becomes a case

**B2.1** `@r.ferrara` promotes B-1 to a voice case — **[design]**
→ Invariant 2: *structure is earned by use.* Four weekends is the evidence.
**B2.2** the original email stays visible — **[fixture]**
→ Invariant 3: *the source is never rewritten.* Assert the `emailBody` still
renders verbatim beside every added layer.

**B2.3** `@r.ferrara` opens a Fundamental need case from the attributed
`@n.calabrese` discussion post in **B1.3** — **[drive]**
→ `POST /organization`, `intent=promote`. The first boarding post stays in
the shared feed. The case renders the same author, text, and evidence from the
source id. A repeated promotion opens the existing case.

**B2.4** `@r.ferrara` records an acknowledgement and a review date —
**[drive]**
→ `POST /organization`, `intent=acknowledge`. The case records who acknowledged
it and when to revisit it. The acknowledgement and source survive a restart.
The end-to-end assertions live in `tests/organization-cases.test.js` and use a
separate provider store.

### B3 — Safe voice

**B3.4** `@asl.provider` — `POST /admin` — `intent=modules`,
`protectedVoice=true` — **[drive]**
→ before this event, the protected route is unavailable and the ordinary inbox
still works. After it, the module registry and navigation report protected
voice enabled while all other organization layers remain off. This does not
manufacture a working intake path: **B3.1** stays **[design]**, and the replay
reports the toggle and workflow statuses separately.

**B3.1** `@caso-4471` arrives through the protected path — **[design]**
**B3.2** reveal policy is stated: who may reveal, under what condition, with
what authorization and audit trail — **[design]**
→ Invariant 8. The UI must never print "anonymous email": SMTP and provider
logs keep metadata the interface cannot erase. **This is prohibited copy** and a
test should grep for it.

**B3.3** the whistleblowing boundary — **[design]**, with a grep-testable copy rule today
→ intake copy must direct segnalazioni within D.lgs. 24/2023's scope (illeciti,
frodi, violazioni) to the ASL's dedicated internal channel or ANAC, and say
that the protected-voice path does not replace them or their legal protections.
§*Non-goals*: "hiding legal, safety, or regulatory obligations behind
mediation". The honest sentence is one line; its absence is a compliance bug.

### B4 — Layers, one at a time

**B4.7** `@asl.provider` — `POST /admin` — `intent=modules`, `sectors=true` —
toggle **[drive]** / case-source comparison **[fixture]**
→ enable the first case lens only after the corroborating messages in **B1.3**
and the case-promotion need in **B2.1** exist. The inbox and source messages
must be byte-for-byte unchanged; the new sector links are views over them, not
copies.

**B4.1** `@asl.provider` — `POST /admin` — `intent=modules`,
`responsibilities=true` — toggle **[drive]** / relationship rendering
**[fixture]**
→ `@dott.marino` is outcome owner; `@f.gallo` and `@s.pellegrino` hold action
commitments; `@dott.sa.rizzo` holds the stop condition; `@t.russo` is consulted
for the territorial exit path; ward and pharmacy leads are informed.
→ Invariant 6: assignment without acknowledgement is not ownership. Six
distinct relationships that must **not** collapse into one "assignee".

**B4.2** `@asl.provider` — `POST /admin` — `intent=modules`,
`hierarchies=true` — toggle **[drive]** / flow-map rendering **[fixture]**
```
formalFlow: Nurse → nursing coordinator → Emergency Medicine director → Hospital Medical Directorate
actualFlow: Night-shift nurse ↔ nursing coordinator ↔ bed manager (@l.deangelis)
```
→ The gap **is the finding.** The formal chart is not a lie and the actual flow
is not automatically legitimate; the mirror exists to reveal that
`@l.deangelis`, who appears on no reporting line for this problem, is the node
every weekend actually routes through — the same person whose **B1.3** post
already explained why. Overloaded intermediaries are found here, not in the
org chart.

**B4.3** `@asl.provider` — `POST /admin` — `intent=modules`,
`authority=true` — toggle **[drive]** / grant rendering **[fixture]**
```
Raise    · any staff member              · no authorization required
Propose  · admissions-flow group         · limited pathway change
Approve  · Hospital Medical Directorate  · 30-day pilot within existing policy
Stop     · risk manager                  · if a clinical risk emerges
Escalate · General Directorate           · if the pilot exceeds the ceiling
```
→ Invariant 5: **titles do not imply unlimited power.** Every grant carries
source, scope, condition, expiry, review. `@dott.marino` keeps the clinical
decision right *and* receives frontline evidence directly — Invariant 4:
consultation does not transfer the accountable decision.

**B4.4** `@asl.provider` — `POST /admin` — `intent=modules`,
`mediation=true` — toggle **[drive]** / workflow **[design]**
→ B-4 enters the protected path: acknowledge → review → dialogue → agreement →
escalate → learn. *Realtà:* the neutral figures an Italian ASL actually has are
the CUG (Comitato Unico di Garanzia, art. 57 d.lgs. 165/2001) and, where
appointed, the consigliera di fiducia — the fixture's mediator is drawn from
there, not invented.
→ **The test that matters:** mediation must not resolve the interpersonal
conflict while leaving the staffing level untouched. A "successful" mediation
that closes B-4 without changing the ratio is the failure §*Mediation* warns
about, and Invariant 10 says so plainly: *closing a case is not solving a
problem.* The learn step publishes a permission-safe finding: night cover below
minutaggio in 3 of 31 sites — without exposing `@caso-4471`.

**B4.5** `@asl.provider` — `POST /admin` — `intent=modules`,
`pressureAnalytics=true` — toggle **[drive]** / component rendering
**[fixture]**
→ B-1 shows its **components**, never a bare score:
```
volume 4 weekends (the B1.3 signals) · velocity +30% vs 90-day baseline
persistence 4 recurrences · spread ED→Medicine→COT/RSA
high consequence (safety) · saturated capacity · flow blocked at bed management
```
*Realtà:* Italian PS already use a single-number overcrowding index — NEDOCS —
and its opacity is the cautionary tale: a score that says 142/200 tells the
shift nothing about *what* to relieve. The components view is the deliberate
opposite (§*Pressure dynamics*: expose components, baseline, uncertainty, last
update).
→ Invariant 9: **descriptive, not punitive.** No automated sanction may derive
from this, and no individual "pressure absorber" leaderboard may exist —
§*Advice and innovation* excludes it because it rewards unsafe overwork and
exposes protected participation. A test should assert no per-person ranking
renders.

**B4.6** `@asl.provider` — `POST /admin` — `intent=modules`,
`impactTracking=true` — toggle **[drive]** / workflow **[design]**
→ baseline, target, boundary, stop condition, **recurrence and displacement
checks**. The displacement check has a name in this fixture: `@g.lombardo` and
`@t.russo` watch whether the hospital's median improves by pushing fragile
discharges onto ADI slots the district does not have.

### B5 — Emergency, and the record

**B5.1** a Saturday night reaches Critical; `@dott.marino` activates the overcrowding-management plan, opening an overflow area without consultation — **[design]**
→ Invariant 11: **urgent command stays fast.** *Realtà:* the piano di gestione
del sovraffollamento is what national guidance (linee di indirizzo 2019) already
requires every PS to have; the platform's only job is to record who activated
it, why consultation was bypassed, and when review happens. It does not slow him
down — a framework that makes this harder has failed at the exact moment it
matters.

**B5.3** `@dott.marino` — `POST /discussion` —
`topic=pronto-soccorso`, `stance=neutral` — **[drive]**
`content=The overcrowding-management plan was activated at 23:50: an overflow
area with six trolleys is open, and staff have been called in under the on-call
arrangement. Review on Monday with the medical directorate and risk management.`
→ the messaging kernel can record an off-platform emergency act today even
though the structured bypass workflow in **B5.1** is not built. Each other
affected staff agent must discover the announcement through its own refreshed
view; the runner may not mark them informed merely because the post exists.

**B5.2** the 48-hour review — **[design]**
→ the recorded bypass gets its scheduled look-back: was the trigger right, did
the overflow area displace risk, does the threshold need moving. Emergency
speed and later review are one invariant, not two.

### B6 — Removal

**B6.2** `@asl.provider` — `POST /admin` — `intent=modules`, `funds=true` —
toggle **[drive]** / case rendering **[fixture]**
→ B-3's source consultation remains visible and unchanged while the funds lens
moves from a labelled preview to an enabled surface. The allocation workflow is
still **[fixture]**/**[design]**; this event proves only real module activation
and preservation of the source, and the trace must say so.

**B6.1** `@asl.provider` — `POST /admin` — `intent=modules`, `funds=false` —
toggle **[drive]** / source-history preservation **[fixture]**
→ Invariant 12: **every layer can be removed.** B-3's source message and audit
history survive; the workspace does not break. This is the strongest honesty
test in the scenario — a lock-in disguised as a layer would fail here. The
preceding **B6.2** event is required: toggling an already-disabled module off is
not a removal test.

## B.5 What is drivable today

Stated plainly, because a scenario that overpromises produces tests that cannot
be written:

- **[drive]** — module toggles (`/admin` `intent=modules`), navigation and gate
  behaviour when a layer is off, the labelled-preview rendering of disabled
  layers, and the messaging kernel (`/discussion`, `/forum`, `/notifications`,
  `/profile`) — which is where **B1.3**, **B1.4**, and **B5.3** live as real,
  replayable content today. Each toggle and message is a separate trace event.
- **[drive]** — the attributed discussion case path at `/organization`
  (**B2.3**, **B2.4**) with case search and durable review dates.
- **[fixture]** — `/organization?view=preview` renders the illustrative inbox
  and layers from `ORGANIZATION_TEMPLATE_CASES`. Replacing the older examples
  with **B-1…B-4** remains on the preview backlog.
- **[design]** — inbound email promotion, timed outbound response boundaries,
  protected relay, commitments, authority grants, funds records, mediation,
  and impact reviews.

### A vocabulary drift (physics metaphor retired)

The cases above use the pressure states this principle doc defines, and
`organizationTemplate.js` now matches them: the **physics metaphor** the doc
moved away from has been renamed. `Critical` remains the one unmodelled state.

| Was in code | Now in code | This doc | Note |
| --- | --- | --- | --- |
| `Gas` | `Diffuse` | `Diffuse` | many vague or disconnected signals |
| `Liquid` | `Flowing` | `Flowing` | issues move and get responses |
| `Solid` | `Crystallized` | `Crystallized` | persists, hardens into workaround and distrust |
| *(absent)* | *(absent)* | `Critical` | fast, high-consequence, near operating limits |

This was not cosmetic. §*Non-goals* names "treating metaphorical pressure physics
as scientific proof" as a thing to avoid, and `Gas`/`Liquid`/`Solid` was that
metaphor presented as a state machine. `Crystallized` says something a reader
can act on — *this recurs and people have stopped expecting a fix* — where
`Solid` said only that the metaphor continues. The still-missing `Critical` state
is worse than a naming gap: it is the state that should route to **B5.1**,
emergency command with recorded bypass and later review. Add it when the
template cases are replaced with the Scenario B content.

The `pressureType` values (`Acute`, `Chronic`, `Oscillating`, `Cascade`) stay —
the doc keeps those as case descriptors.

---

## Coverage map

| Capability | Scenario A | Scenario B |
| --- | --- | --- |
| Blinded identity, one person = one voice | A1.1 | — (staff authorization) |
| Handles, roles, bans | A1.2, A1.5, A1.6 | B.1 |
| Exclusion principle (org account banned) | A1.6 | — |
| Discussion + stance + evidence | A2.1–A2.6, A2.9–A2.12, A2.16–A2.17 | B1.3–B1.4, B5.1 |
| Fact-check loop closed with method | A2.6 + A2.12 | — |
| Public concession in deliberation | A2.5 | — |
| Social lane + typed follows | A2.7 | — |
| Mentions + author notifications (social lane) | A2.13 | — |
| Reshare (and reply/reshare exclusivity) | A2.14 | — |
| Locked media + view request | A2.13 | — |
| Identity-based rate limiting | A2.15 | — |
| Forum long-form + comments | A2.8 | — |
| Topic gardener review (merge/rename) | A2.18 | — |
| Petition drafting + structured outline | A3.1, A3.12, A3.15 | — (deliberately off) |
| Revisions + diffs (deliberation → text) | A3.2, A3.11 | — |
| Signatures → quorum / below-quorum persistence | A3.3, A3.14, A3.16 | — |
| Stance-tagged deliberation + fact-check | A3.4–A3.6 | — |
| Argument map (node + rebuttal) | A3.6 + A3.9 | — |
| Notification preferences + observed read loop | A3.10/preferences, A3.10/observe, A3.10/read | — |
| Pre-vote freeze (attributed) | A3.7 | — |
| Signed vote envelopes + dissent in tally | A3.8 | — |
| Groups + policy (vote vs priority modes) | A5.1–A5.3, A4.3–A4.4 | — |
| Ranked elections decided on transfers | A5.4–A5.6 | — |
| Group leave | A5.8 | — |
| Topic-scoped delegation | A6.1–A6.2 | — |
| Transitive chains | A6.3 | — |
| Delegation conflict prompt (vs election winner) | A6.5 | — |
| Delegation clear (revocability) | A6.8 | — |
| Delegation decay + renewal | A7.1–A7.2 | — |
| Delegate profiles + advisory score | A8.1 | — |
| People directory search | A8.4 | — |
| Audit trail | A8.2 | B4.x |
| Vote ledger export + signature verify | A8.5 | — |
| Free mandate preserved (art. 67) | A8.3 | — |
| Governance defaults + change proposals | A9.1–A9.2 | — |
| Federation: peers, capability hints, ledger audit | A10.1–A10.2 | — |
| Gossip policy rejection + quarantine | A10.3 | — |
| Provider-local fields never gossip | A1.3 + A10.4 | — |
| Module toggles / adoption staircase | A.0 | B3.4, B4.7, B4.1–B4.6, B6.2–B6.1 |
| Corroborating signals behind volume | — | B1.3 |
| Acknowledgement with stated boundary | — | B1.4 |
| Discussion case promotion and recorded review date | — | B2.3–B2.4 |
| Protected voice + reveal policy | — | B3.4, B3.1–B3.2 |
| Whistleblowing boundary (D.lgs. 24/2023) | — | B3.3 |
| Responsibilities vs authority | — | B4.1, B4.3 |
| Formal vs actual flow (bed manager) | — | B4.2 |
| Funds constraint | — | B-3, B6.2 |
| Mediation (CUG) without suppression | — | B4.4 |
| Pressure components (vs NEDOCS opacity) | — | B4.5 |
| Impact + displacement checks | — | B4.6 |
| Emergency bypass with review | — | B5.1, B5.3, B5.2 |
| Layer removal | — | B6.2–B6.1 |

## Running these scenarios

- The canonical test starts from an empty scenario store and builds state only
  by replaying **[drive]** actions through their real boundaries. Never run
  `scripts/seed-demo.js` first. A seeded store is useful for manual exploration
  and screenshots, but it cannot pass this execution contract.
- `scripts/party-journeys.js` is the current Scenario A browser walkthrough and
  the source of every README capture (20 images in `md-assets/party/`). It drives
  A1 (arrival, roles, the A.0 constitution, delegate bios), A2 (discussion,
  forum, social), A3 (proposal, revision, quorum, argument map, the revision that
  answers its own deliberation, freeze, vote), A5, A6.2/A6.3, branch groups,
  lanes and promotion, delegated ballots, A8, and A9.1/A9.2. Start it against a
  fresh strict-Circle store:
  `ENFORCE_CIRCLE=true CIRCLE_POLICY_ID=rete-civica-nazionale CIRCLE_NAME="Rete Civica Nazionale" DATA_VALIDATION_LEVEL=strict DATA_PREVIEW=false ./run-standalone.sh`.
  `scripts/user-journeys.js` is the separate organization-operations regression
  driver; it produces no README captures.
  They already isolate browser sessions and make step assertions, but they are
  partial walkthroughs, not full conformance until they emit the trace, expand
  every compound action—including the 250-signature cohort—and replay every
  current **[drive]** item from empty state. **A10** remains driven through the
  real protocol boundary by the node ring/gossip suites rather than a browser.
- Keep Scenario A and Scenario B in separate fresh stores and separate trace
  files. Merging them produces a deployment that is neither a party nor an ASL,
  and makes causal counts impossible to attribute.
- Use one isolated browser context or client session per agent. Tabs share a
  cookie jar, so one context wearing many handles makes quorum, follow,
  notification, election, and authorization assertions vacuous. Assert session
  uniqueness when each agent is created and again before any multi-actor act.
- Do not run a whole act as setup and assert only its final counter. For example,
  **A5.5** is nine observed ballot events with a tally assertion after each
  round-relevant vote; **B1.3** is four messages on four simulated dates; and
  **B4** asserts the workspace after each individual module toggle. The final
  tally, pressure count, or enabled-module set is only the checksum.
- Prefer a virtual clock controlled by explicit trace events. Replaying **A7.1**
  or the four weekends in **B1.3** by rewriting persisted timestamps defeats
  expiry, audit, and scheduling coverage.
- Dated figures (CNEL counts, ISPRA rates, FNOPI estimates, referendum turnout)
  are anchored to their source years in the text. Refresh them when reseeding;
  do not present them as live data.
- When a **[design]** item ships, give its actor a real interaction, add its
  before/after assertions, and then move the label to **[drive]**. When a
  **[fixture]** gains a write path, replace the render-only setup with the events
  that create it. The labels are the executable backlog.
