# Simulation Scenarios

Status: reference fixtures for development, testing, and screenshots.

## Why this exists

A deployment with three posts and a proposal called "Test" proves nothing. The
screens render, the labels are correct, and nobody can tell whether the product
works — because there is no situation on screen that a real member would
recognise. Empty states and placeholder text hide exactly the defects that
matter: a delegation chain nobody can read, a pressure cue with no composition
behind it, a vote whose tally means nothing because one person cast all of it.

This document defines two situations rich enough to break things, and scripts
them as ordered actions bound to real routes and real field names. Use them to
seed a deployment, to write tests, and to produce screenshots that show the
product doing its job.

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

**These scenarios' in-app conversation and case copy is in English.** The deployments remain
Italian: names, handles, topic IDs, institutions, legal terms, `€` amounts, and
`dd/mm/yyyy` dates retain their Italian context. This makes the scenarios usable
for English-language product review without pretending that the laws or
institutions are generic. Tests should assert on the English fixture strings.
Evidence links use the fictional domain `esempio.rcn.it` /
`esempio.aslvalsereno.it` — real norms are cited by name in the text instead of
by URL, so nothing rots.

---

## Conventions

Each action is written as:

> **A3.2** `@handle` — `POST /route` — `field=value`
> → what must be observable afterwards

Action ids are stable. A test that references **A3.2** should keep referencing
the same act even if the surrounding prose changes. New actions extend the
numbering; they never renumber existing acts.

Three labels mark what the codebase can do with an action **today**:

- **[drive]** — a test can perform this through the UI and assert the result.
- **[fixture]** — the data exists, but only as a hardcoded template; a test can
  assert what renders, not the workflow that produced it.
- **[design]** — described by the principle doc, not yet built. Listed so the
  scenario stays whole and so the gap is legible. Do not write a test for it.

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
`vote method condorcet` · `delegationDecayDays 180`.

The decay setting is not decoration. It is the answer to the super-delegate
problem (`RepresentativeParties.md` §2.4, §6.2.1): delegated power lapses unless
renewed, so influence has to be re-earned rather than accumulated once and held.
**A7** exercises it.

The ring: the fixture assumes three providers — `rcn-nord` (the one being
seeded), `rcn-sud`, and, in **A10**, a rogue node. Everything through **A9**
works on a single provider; **A10** needs the second one.

## A.1 Cast

Sixteen people. Enough that quorum is real, delegation forms chains rather than
pairs, and a conflict has two credible sides.

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

Two role facts the fixture must preserve, because they are the whole argument of
the thesis:

- `@elena.rossi` is a **moderator**, not an oracle. She can open a vote. She
  cannot decide one, and every freeze she performs is attributed to her.
- `@rcn.provider` is an **admin**. Admin is an *operational* role — modules,
  keys, policy — not a political one. If the provider can move a vote, the party
  does not own its own decisions.

## A.2 Topics

Structural Italian debates, each chosen because it stresses something specific.
Each carries its **realtà di riferimento** — the actual norms and numbers the
fictional members argue about — so seeded content reads like Italy, not like
lorem ipsum with Italian words.

| Topic id | Debate | Stresses |
| --- | --- | --- |
| `salario-minimo` | Statutory minimum wage | Direct material interest on both sides |
| `autonomia-differenziata` | Regional differentiated autonomy | Splits the party geographically, not ideologically |
| `liste-attesa` | Public healthcare waiting lists | Expertise vs lived experience |
| `transizione-energetica` | Energy transition and plant siting | Delegation conflict: national good, local cost |
| `ius-scholae` | Citizenship through schooling | Values, not numbers — resists delegation |
| `consumo-suolo` | Land consumption | Long-tail: few members, real stakes |

**Realtà di riferimento:**

- `salario-minimo` — the 2023 unified opposition bill set 9 €/h gross as the
  floor; the CNEL istruttoria (2023) counted **over 900 deposited CCNL**, with
  the ~20 largest covering the great majority of employees — the fight is less
  about contract count than about expired renewals and sub-threshold sectors
  (vigilanza, multiservizi, some terziario). Direttiva (UE) 2022/2041 does not
  oblige a statutory minimum where collective coverage is high; the contested
  question is whether *effective* coverage qualifies.
- `autonomia-differenziata` — art. 116 c.3 Cost.; L. 86/2024 ("legge
  Calderoli"); the LEP (livelli essenziali delle prestazioni) as the
  precondition everyone cites and nobody has financed; **sent. 192/2024** struck
  parts of the law; **sent. 10/2025** ruled the total-repeal referendum
  inadmissible. The debate survives all of it — which is why it is in the
  fixture.
- `liste-attesa` — PNGLA priority classes **U/B/D/P = 72h / 10 / 30–60 / 120
  days**; intramoenia (ALPI) bounded by L. 120/2007 — private in-house activity
  may not exceed institutional volumes, a constraint everyone knows and audits
  weakly; DL 73/2024 conv. L. 107/2024 added the national AGENAS platform and
  mandatory disdetta systems.
- `transizione-energetica` — aree idonee (d.lgs. 199/2021 + DM 2024),
  commissari straordinari and compensazioni territoriali for strategic plants,
  CER (comunità energetiche rinnovabili, DM CACER 2024) as the bottom-up
  counterweight.
- `ius-scholae` — L. 91/1992 is still the law; the ius scholae proposals tie
  citizenship to a five-year school cycle; the **giugno 2025 referendum**
  (residency 10→5 years) failed quorum at ~30% turnout with ~65% yes among
  voters. Unfinished by design.
- `consumo-suolo` — ISPRA/SNPA 2024: ~72 km² consumed in 2023, ~20 hectares a
  day, ~2,3 m²/s; the national framework bill has been stalled for over a
  decade; the EU target is net zero by 2050.

`autonomia-differenziata` earns its place by cutting across the party the wrong
way. `@tommaso.ricci` (Trento) and `@nadia.hamdi` (Palermo) are on the same side
of every other topic and opposite sides of this one. A fixture where all
disagreement is one-dimensional cannot show whether the interface helps.

## A.3 Act 1 — Members arrive, and are counted once

**A1.1** each member — `GET /auth/eudi` → follow the callback — **[drive]**
→ a session exists; the store holds a **blinded hash only**, never a codice
fiscale. This is the "one person = one voice without a PII honeypot" claim, and
it is checkable: grep the store for raw identifiers and find none.
*Realtà:* the OIDC4VP flow simulates what IT-Wallet (live on the IO app since
December 2024: patente, tessera sanitaria, carta europea della disabilità) and
the EUDI Wallet (Reg. (UE) 2024/1183) are making ordinary. The scaffold is the
same handshake with the production wallet swapped in.

**A1.2** each member — `POST /profile` — `intent=handle`, `handle=giulia.ferrero` — **[drive]**
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

### The waiting-list thread (`liste-attesa`)

**A2.1** `@giulia.ferrero` — `POST /discussion` — **[drive]**
`topic=liste-attesa`, `stance=concern`,
`content=In my department, the first available non-urgent cardiology appointment is 14 months away. Patients who can afford it use intramoenia and are seen within two weeks. Same building, same doctors, same day.`
`evidenceLinks=https://esempio.rcn.it/liste-attesa/rilevazione-2026`
→ a concrete, checkable claim from someone with standing to make it.

**A2.2** `@marco.deluca` — `POST /discussion` — `topic=liste-attesa`, `stance=support` — **[drive]**
`content=The CUP data I aggregated across three regions confirm it: for priority classes D and P, exceeding PNGLA waiting times is the rule, not the exception. And where the public service runs late, intramoenia in the same specialty runs on time. This is not a local anomaly; it is an economic equilibrium.`
→ expertise *corroborating* lived experience, not overriding it.

**A2.6** `@valentina.sanna` — `POST /discussion` — `topic=liste-attesa`, `stance=neutral` — **[drive]**
`content=Is the 14-month figure a median or a worst case? That changes everything: a median describes the system, while a worst case describes a queue. Before we build a proposal on it, we need the distribution, not an anecdote.`
→ the fixture must contain someone checking, not only asserting.

**A2.11** `@nadia.hamdi` — `POST /discussion` — `topic=liste-attesa`, `stance=concern` — **[drive]**
`content=From general practice: I prescribe priority class B, which means 10 days under the PNGLA. The CUP offers me 96 days, or the paid pathway in the same building. The priority class has become a statement of intent.`
→ the same failure seen from the territory. Two professions, one mechanism.

**A2.12** `@giulia.ferrero` — `POST /discussion` — `topic=liste-attesa`, `stance=neutral` — **[drive]**
`content=@valentina.sanna Median, not worst case: an internal survey of 14 health authorities, March 2026, with the method attached. The worst cases are far beyond that.`
`evidenceLinks=https://esempio.rcn.it/liste-attesa/metodo-rilevazione`
→ the fact-check loop **closes**: question asked, method published, thread
moves on. A deliberation culture is exactly this exchange being normal.
→ note the gap the fixture makes visible: the `@mention` here notifies nobody —
mention notifications exist only in the social lane today (`social_mention`),
so Valentina finds this answer by rereading the thread. Logged in
`OPTIMIZATIONS.md`; when discussion mentions notify, this act gains the
assertion.

### The minimum-wage thread (`salario-minimo`)

**A2.3** `@luca.esposito` — `POST /discussion` — `topic=salario-minimo`, `stance=concern` — **[drive]**
`content=Nine euros gross per hour for a restaurant with four seasonal employees means either raising prices by 12% or closing in November. I am not against a minimum wage; I am against doing it without looking at hospitality's real margins.`
→ **the dissent must be reasonable.** A fixture whose opposition is a strawman
proves nothing about deliberation.

**A2.4** `@ahmed.ben.salah` — `POST /discussion` — `topic=salario-minimo`, `stance=support` — **[drive]**
`content=At my warehouse, the pirate contract pays €6.40 an hour. That is not competition on margins; it is competition over who will accept less. The minimum wage does not close honest businesses; it closes the ones that survive like this.`
→ the reply that makes the disagreement real. Both are true at once. This is
the pair the interface has to hold without flattening.

**A2.9** `@valentina.sanna` — `POST /discussion` — `topic=salario-minimo`, `stance=neutral` — **[drive]**
`content=CNEL figures, 2023 review: more than 900 CCNL agreements are filed, but the 20 most used cover the vast majority of employees. The problem is not the number of contracts; it is renewals expired for years and pay scales below €7 in security, multiservices, and parts of the tertiary sector. Any proposal must say what it does about THIS.`
→ the researcher reframes the fight with the actual CNEL finding. Evidence
changes what the proposal will have to address.

**A2.10** `@marco.deluca` — `POST /discussion` — `topic=salario-minimo`, `stance=neutral` — **[drive]**
`content=EU context: Directive 2022/2041 does not require a statutory minimum where collective-agreement coverage is high. The real question is whether our EFFECTIVE coverage — weighted for expired renewals — meets that standard. If it does not, a statutory minimum is not ideology; it is compliance.`
→ the economist supplies the frame the debate actually happens in.

### The split that isn't left-right (`autonomia-differenziata`)

**A2.5** `@tommaso.ricci` and `@nadia.hamdi` — `POST /discussion` ×3 — **[drive]**
- Tommaso, `stance=support`: `Healthcare administration in the special-autonomy and benchmark regions shows that local fiscal responsibility can work. The problem is not autonomy; it is doing it without LEP.`
- Nadia, `stance=concern`: `Without funded LEP, autonomy locks in historic spending: those who have always had less continue to have less, only this time by contract. The Constitutional Court said this clearly in judgment 192/2024 — it is not a technical detail.`
- Tommaso, `stance=neutral`: `You are right about LEP, and I admit it: without funding, my position does not stand up. But that means the fight is for LEP, not against autonomy itself.`
→ a member **concedes a point in public and survives**. The most load-bearing
post in the fixture: deliberation that never changes anyone's position is
theatre, and screenshots should be able to show the opposite happening.

### The rest of the map

**A2.16** `@anna.conti` — `POST /discussion` — `topic=ius-scholae`, `stance=proposal` — **[drive]**
`content=The June 2025 referendum on reducing the residency requirement from 10 to 5 years missed quorum with about 30% turnout — but about 65% of those who voted said yes. And ius scholae was not even on the ballot: under Law 91/1992, five years of schooling in Italy count for nothing. I propose that we take this to the assembly.`
→ the topic that resists delegation: values, not parameters. Watch **A6.8**.

**A2.17** `@davide.villa` — `POST /discussion` — `topic=consumo-suolo`, `stance=concern` — **[drive]**
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

**A2.18** the topic gardener proposes merging stray tags (`sanita`, `sanità-pubblica`) into `liste-attesa`; `@rcn.provider` reviews in `/admin` — **[drive]**, with `src/infra/workers/topic-gardener/server.py` running and its URL configured
→ rename/merge suggestions appear with previews; accept records topic history;
discussions keep their threads. Members named their topics freely and the
garden stays tidy **with a human gate** — never silently.

Volume target: **≥30 discussion posts across all 6 topics, ≥20 social posts,
≥3 forum articles with comments.** Below that, topic filters, the gardener, and
pagination all render as empty chrome.

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
evidenceLinks=https://esempio.rcn.it/liste-attesa/rilevazione-2026
```
→ The `problem` field now does the honest thing: it names the law that already
exists and says *why it fails* — the proposal tightens a weak constraint rather
than inventing a new right. That is what a credible Italian policy draft looks
like, and the structured outline is what forces the distinction.

**A3.2** `@marco.deluca` — `POST /petitions/update` — **[drive]**
revises the cap to 20% after modelling specialist retention; revision history
and a diff must be inspectable.
→ **the draft changed, and who changed it is on the record.**

**A3.3** 250+ members — `POST /petitions/sign` — `petitionId=...` — **[drive]**
→ quorum moves the proposal to `discussion` **on its own**. No moderator
touches it. If quorum were discretionary the signatures would be theatre.

**A3.4** `@luca.esposito` — `POST /petitions/comment` — `stance=concern` — **[drive]**
`content=If the cap bites, specialists will move to accredited private providers and public-service waits will worsen. The risk is written into the proposal itself: what concretely offsets it?`

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

**A3.10** `@giulia.ferrero` — `POST /notifications/preferences` — `notifyProposalComments=on`, then `GET /notifications`, `POST /notifications/read` — **[drive]**
→ the author opted into comment alerts; Luca's concern (**A3.4**) produced one;
she read it. Alerts are tied to a verified handle — the fixture exercises the
full loop, not just the toggle.

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

Fixture target: **3 proposals in different stages** — this one in `vote`,
`salario-minimo` in `discussion` (drafted by Ahmed, revised after **A2.9**'s
CNEL reframing), `consumo-suolo` in `draft` below quorum (Davide's long-tail
case: 41 signatures of 250 — visible, pending, *not* buried).

## A.6 Act 4 — A conflict that delegation cannot resolve by itself

**A4.1** `@chiara.moretti` — `POST /petitions` — `title=Coastal regasification terminal: national position` — **[drive]**
`summary=` national energy security, the extraordinary-commissioner powers, and
territorial compensation provided by current law; the floating regasification
terminal should be accepted with negotiated conditions, not simply endured.

**A4.2** `@stefano.lombardi` — `POST /petitions/comment` — `stance=concern` — **[drive]**
`content=My members live two kilometres from the quay. The benefit is national; the cost is theirs: the view, fishing, and perceived risk. Compensation must not be negotiated AFTER the national position; it must be negotiated into it.`
→ **Both are right.** `transizione-energetica` exists in the fixture to hold a
conflict with no correct answer, only an accountable one.

**A4.3** `@chiara.moretti` — `POST /groups` — `action=create`, `name=Energy and Territory Circle`, `topics=transizione-energetica,consumo-suolo` — **[drive]**
`description=CER, suitable areas, strategic plants: where the national meets the local.`
→ the second group. One group cannot show a group *list*, and the two groups
run **opposite election policies** (see A4.4 vs A5.3) — the contrast is the
fixture.

**A4.4** `@chiara.moretti` and `@stefano.lombardi` — `POST /groups/delegate` — `groupId=...`, `topic=transizione-energetica`, `delegateHash=<own>`, `priority=80` / `priority=60` — **[drive]**
→ **priority-mode cachet**: the group publishes ranked delegate preferences
without any election (`electionMode=priority`, the default). Chiara outranks
Stefano on paper; his members now have a reason to look at **A6.5**'s conflict
prompt. Both mechanisms — priority and vote — must exist in the seeded data or
the group-policy separation is untested.

## A.7 Act 5 — Groups, and choosing people

**A5.1** `@irene.fabbri` — `POST /groups` — `action=create`, `name=Public Healthcare Circle`, `topics=liste-attesa,salario-minimo` — **[drive]**
**A5.2** eight members — `POST /groups` — `action=join` — **[drive]**
**A5.3** `@irene.fabbri` — `POST /groups/policy` — `electionMode=vote`, `conflictRule=prompt_user` — **[drive]**
→ `prompt_user` is the honest setting: when recommendations clash the member
chooses. `highest_priority` would decide silently on their behalf.

**A5.4** `@irene.fabbri` — `POST /groups` — `action=startElection`, `topic=liste-attesa`, `candidates=marco.deluca,giulia.ferrero,valentina.sanna` — **[drive]**

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
cachet for `liste-attesa` updates to Giulia automatically.

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

**A6.1** `@davide.villa` — `POST /delegation` — `intent=set`, `topic=liste-attesa`, `delegateHash=marco.deluca` — **[drive]**
**A6.2** `@paolo.greco` — `POST /delegation` — `intent=set`, `topic=liste-attesa`, `delegateHash=giulia.ferrero` — **[drive]**
**A6.3** `@giulia.ferrero` — `POST /delegation` — `intent=set`, `topic=liste-attesa`, `delegateHash=marco.deluca` — **[drive]**
→ **transitive chain**: `@paolo.greco → @giulia.ferrero → @marco.deluca`.
`/delegation` must state plainly where Paolo's vote ends up. A chain a member
cannot read is a chain they cannot revoke, and revocability is the entire
mechanism (§2.2.2).

**A6.4** `@davide.villa` — `POST /delegation` — `intent=set` on five topics — **[drive]**
→ the member who delegates nearly everything. Legitimate, and the thing to
watch.

**A6.5** conflict — the Circolo Sanità cachet now recommends `@giulia.ferrero` (the election winner, per vote-mode policy); `@davide.villa`'s manual choice is `@marco.deluca` — `POST /delegation/conflict` — **[drive]**
→ with `conflictRule=prompt_user`, **he chooses** — and he keeps Marco, against
the election result. The prompt names both sources and why each is suggested
(election-winner metadata included). Advisory-vs-binding stops being a doc
claim exactly here: a member overrides a formal election and the system's only
job is to make sure he did it knowingly.

**A6.6** `@marco.deluca` accumulates delegations across `liste-attesa`,
`salario-minimo`, `transizione-energetica` — **[drive]**
→ **the super-delegate, on purpose.** §2.4 says this is the model's most serious
failure mode and the German Pirate Party observed it for real. The fixture must
*contain* it, or nothing tests the mitigation.

**A6.7** — soft cap on concentrated delegated weight — **[design]**
→ §6.2.1 pairs decay with soft caps. Decay exists; caps do not. Recorded as a
gap, not a test.

**A6.8** `@anna.conti` — `POST /delegation` — `intent=clear`, `topic=ius-scholae` — **[drive]**
→ she had delegated the topic to Sofia; after the assembly debate (**A2.16**)
she clears it to vote in person. Some questions do not delegate — the interface
must make taking a vote *back* one gesture, because §2.2.2's revocability
promise is measured at exactly this moment.

## A.9 Act 7 — Power that lapses

**A7.1** advance past `delegationDecayDays=180` — **[drive]**
→ `@davide.villa`'s un-renewed delegations **lapse** and drop out of
resolution. Influence is not a possession.

**A7.2** `@davide.villa` — `POST /delegation` — `intent=renew`, `topic=liste-attesa` — **[drive]**
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
Davide's stalled `consumo-suolo` draft, which is the fixture proving his point.

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

**A10.1** `@rcn.provider` — `/admin` — add peer `https://sud.esempio.rcn.it` (`peerJoin`), enable gossip push/pull — **[drive]**
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

A reviewer opening this deployment should find: 16 members with handles and
bios, plus one **banned org account** with a visible gate message · 6 live
topics tended by a reviewed gardener merge · ≥30 discussion posts including a
closed fact-check loop and a public concession · ≥20 social posts with typed
follows, one reshare, one locked photo with a view request, one rate-limit hit ·
3 forum articles with comments · 3 proposals in `draft`/`discussion`/`vote`,
one below quorum on purpose · 250+ signatures · a frozen text with an attributed
freeze and a 3-revision history that answers its own deliberation · a ranked
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

Modules on: `coordination`, `protectedVoice`, `responsibilities`, `sectors`.
**Off:** `petitions`, `votes`, `delegation`, `groups`, `federation`.

That module list is a claim worth stating aloud: **an ASL does not vote on
clinical decisions.** §*Non-goals* — "voting on every operational or expert
decision", "replacing emergency command". A deployment that turns on `votes`
here has misunderstood the product. `hierarchies`, `authority`, `funds`,
`mediation`, `pressureAnalytics`, and `impactTracking` stay off at first and are
switched on one at a time in **B4** — the adoption staircase, walked.

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
→ the messaging kernel is live today even though the case workspace is a
template, so the four weekends **exist as four real messages** from three
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
the social fact of the promise is seedable today.
→ note for the kernel's own backlog: `/discussion` is flat — the acknowledgement
cannot thread under the signal it answers. Scenario B is the deployment that
makes that gap visible (logged in `OPTIMIZATIONS.md`).

### B2 — A message becomes a case

**B2.1** `@r.ferrara` promotes B-1 to a voice case — **[design]**
→ Invariant 2: *structure is earned by use.* Four weekends is the evidence.
**B2.2** the original email stays visible — **[fixture]**
→ Invariant 3: *the source is never rewritten.* Assert the `emailBody` still
renders verbatim beside every added layer.

### B3 — Safe voice

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

**B4.1** `@asl.provider` — `POST /admin` — `intent=modules`, `responsibilities=true` — **[drive]**
→ `@dott.marino` is outcome owner; `@f.gallo` and `@s.pellegrino` hold action
commitments; `@dott.sa.rizzo` holds the stop condition; `@t.russo` is consulted
for the territorial exit path; ward and pharmacy leads are informed.
→ Invariant 6: assignment without acknowledgement is not ownership. Six
distinct relationships that must **not** collapse into one "assignee".

**B4.2** `intent=modules`, `hierarchies=true` — **[drive]**
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

**B4.3** `intent=modules`, `authority=true` — **[drive]**
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

**B4.4** `intent=modules`, `mediation=true` — **[drive]** / workflow **[design]**
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

**B4.5** `intent=modules`, `pressureAnalytics=true` — **[drive]**
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

**B4.6** `intent=modules`, `impactTracking=true` — **[drive]** / workflow **[design]**
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
matters. His announcement (`POST /discussion`, topic `pronto-soccorso`) is
seedable today: `The overcrowding-management plan was activated at 23:50: an
overflow area with six trolleys is open, and staff have been called in under
the on-call arrangement. Review on Monday with the medical directorate and risk
management.`

**B5.2** the 48-hour review — **[design]**
→ the recorded bypass gets its scheduled look-back: was the trigger right, did
the overflow area displace risk, does the threshold need moving. Emergency
speed and later review are one invariant, not two.

### B6 — Removal

**B6.1** `@asl.provider` — `intent=modules`, `funds=false` — **[drive]**
→ Invariant 12: **every layer can be removed.** B-3's source message and audit
history survive; the workspace does not break. This is the strongest honesty
test in the scenario — a lock-in disguised as a layer would fail here.

## B.5 What is drivable today

Stated plainly, because a scenario that overpromises produces tests that cannot
be written:

- **[drive]** — module toggles (`/admin` `intent=modules`), navigation and gate
  behaviour when a layer is off, the labelled-preview rendering of disabled
  layers, and the messaging kernel (`/discussion`, `/forum`, `/notifications`,
  `/profile`) — which is where **B1.3**, **B1.4**, and **B5.1**'s announcement
  live as real, seedable content today.
- **[fixture]** — everything on `/organization`. It renders from the hardcoded
  `ORGANIZATION_TEMPLATE_CASES` constant. There is **no persistence and no
  write path**: the only interactions are `?case=<id>` and layer tab switching.
  Replacing those four cases with **B-1…B-4** is the single highest-value change
  this document enables — the workspace would then show a recognisable ASL
  instead of a generic care cooperative.
- **[design]** — case promotion, protected relay, commitments, authority grants,
  funds records, mediation, impact reviews. Module-owned records, created lazily
  when a layer is enabled, per the canonical case contract. Not built.

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
| Petition drafting + structured outline | A3.1 | — (deliberately off) |
| Revisions + diffs (deliberation → text) | A3.2, A3.11 | — |
| Signatures → quorum | A3.3 | — |
| Stance-tagged deliberation + fact-check | A3.4–A3.6 | — |
| Argument map (node + rebuttal) | A3.6 + A3.9 | — |
| Notification preferences + read loop | A3.10 | — |
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
| Module toggles / adoption staircase | A.0 | B4.1–B4.6, B6.1 |
| Corroborating signals behind volume | — | B1.3 |
| Acknowledgement with stated boundary | — | B1.4 |
| Protected voice + reveal policy | — | B3.1–B3.2 |
| Whistleblowing boundary (D.lgs. 24/2023) | — | B3.3 |
| Responsibilities vs authority | — | B4.1, B4.3 |
| Formal vs actual flow (bed manager) | — | B4.2 |
| Funds constraint | — | B-3 |
| Mediation (CUG) without suppression | — | B4.4 |
| Pressure components (vs NEDOCS opacity) | — | B4.5 |
| Impact + displacement checks | — | B4.6 |
| Emergency bypass with review | — | B5.1–B5.2 |
| Layer removal | — | B6.1 |

## Using these fixtures

- `scripts/seed-demo.js` should build **Scenario A** — it is the one the current
  code can actually execute end to end. Scenario B's kernel content (**B1.3**,
  **B1.4**, **B5.1**) seeds through `/discussion` on a separate store.
- `scripts/user-journeys.js` drives the subset marked **[drive]** and asserts
  the observable result of each act. Its screenshots are the README walkthrough.
  **A10** is driven by the node tests (ring/gossip suites), not by the browser.
- Keep the two scenarios in **separate stores**. Merging them produces a
  deployment that is neither a party nor an ASL, and that is the "demo-like"
  failure this document exists to end.
- One member per browser context. Tabs share a cookie jar, so a fixture built in
  one context is one person wearing sixteen names — and every quorum, follow,
  and election in Scenario A would be vacuous.
- Dated figures (CNEL counts, ISPRA rates, FNOPI estimates, referendum turnout)
  are anchored to their source years in the text. Refresh them when reseeding;
  do not present them as live data.
- When a **[design]** item ships, move its label to **[drive]** and add the
  assertion. The labels are the backlog.
