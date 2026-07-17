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

**Everything here is fictional.** The party, the health authority, and every
person in them are invented. No real party, ASL, official, or clinical incident
is depicted, and nothing in these fixtures should be presented as a record of
one. This matters beyond taste: seeded content ends up in screenshots, ledgers,
and gossip envelopes, where a plausible fake record about a real institution is
a liability.

**The subject matter is real.** The policy questions in Scenario A and the
operational structure in Scenario B are drawn from durable Italian debates and
from how an ASL is actually organised. Realistic subject matter is the point —
it is what makes the interface's claims testable. But the scenarios are written
around *structural* debates that persist across governments, not around the
events of any particular month, so they do not rot.

**In-app content is in Italian.** A real Italian deployment holds Italian text,
and Italian exposes things English hides: longer words that break pill layouts,
accented characters in handles, `€` amounts, `dd/mm/yyyy` dates. English glosses
follow in brackets where the meaning is not obvious. Tests should assert on the
Italian strings.

---

## Conventions

Each action is written as:

> **A3.2** `@handle` — `POST /route` — `field=value`
> → what must be observable afterwards

Action ids are stable. A test that references **A3.2** should keep referencing
the same act even if the surrounding prose changes.

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
the imperative mandate.

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
| `@irene.fabbri` | delegate | Municipal councillor, Firenze | Elected group delegate in **A6** |
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

Structural Italian debates, each chosen because it stresses something specific:

| Topic id | Debate | Stresses |
| --- | --- | --- |
| `salario-minimo` | Statutory minimum wage | Direct material interest on both sides |
| `autonomia-differenziata` | Regional differentiated autonomy | Splits the party geographically, not ideologically |
| `liste-attesa` | Public healthcare waiting lists | Expertise vs lived experience |
| `transizione-energetica` | Energy transition and plant siting | Delegation conflict: national good, local cost |
| `ius-scholae` | Citizenship through schooling | Values, not numbers — resists delegation |
| `consumo-suolo` | Land consumption | Long-tail: few members, real stakes |

`autonomia-differenziata` earns its place by cutting across the party the wrong
way. `@tommaso.ricci` (Trento) and `@nadia.hamdi` (Palermo) are on the same side
of every other topic and opposite sides of this one. A fixture where all
disagreement is one-dimensional cannot show whether the interface helps.

## A.3 Act 1 — Members arrive, and are counted once

**A1.1** each member — `GET /auth/eudi` → follow the callback — **[drive]**
→ a session exists; the store holds a **blinded hash only**, never a codice
fiscale. This is the "one person = one voice without a PII honeypot" claim, and
it is checkable: grep the store for raw identifiers and find none.

**A1.2** each member — `POST /profile` — `intent=handle`, `handle=giulia.ferrero` — **[drive]**
→ `@giulia.ferrero` renders everywhere the hash would. A raw hash surfacing as
identity is a bug.

**A1.3** `@marco.deluca`, `@sofia.bianchi`, `@chiara.moretti`, `@irene.fabbri` —
`POST /profile` — `intent=profile-attributes`, `publicBio=...` — **[drive]**
→ delegates carry a public bio. `publicBio` is **provider-local** and must never
appear in a gossip envelope — the federation test asserts its absence.

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

## A.4 Act 2 — Conversation before any vote

The order matters. A proposal drafted before this act exists is exactly the
failure mode the README names: shipping voting before conversation.

**A2.1** `@giulia.ferrero` — `POST /discussion` — **[drive]**
`topic=liste-attesa`, `stance=concern`,
`content=Nel mio reparto la prima disponibilità per una visita cardiologica non urgente è a 14 mesi. I pazienti che possono permetterselo vanno in intramoenia e sono visitati in due settimane. Stessa struttura, stessi medici, stesso giorno.`
[*14-month wait for a non-urgent cardiology visit; those who can pay go private and are seen in two weeks. Same building, same doctors, same day.*]
`evidenceLinks=https://esempio.rcn.it/liste-attesa/rilevazione-2026`
→ a concrete, checkable claim from someone with standing to make it.

**A2.2** `@marco.deluca` — `POST /discussion` — `topic=liste-attesa`, `stance=support` — **[drive]**
adds national CUP data behind Giulia's anecdote.
→ expertise *corroborating* lived experience, not overriding it.

**A2.3** `@luca.esposito` — `POST /discussion` — `topic=salario-minimo`, `stance=concern` — **[drive]**
`content=Nove euro l'ora lordi per un locale con quattro dipendenti stagionali significa o alzare i prezzi del 12% o chiudere a novembre. Non sono contrario al salario minimo: sono contrario a farlo senza guardare i margini reali della ristorazione.`
[*€9/hour for a four-seasonal-staff restaurant means +12% prices or closing in November. Not against a minimum wage — against setting one without looking at real margins.*]
→ **the dissent must be reasonable.** A fixture whose opposition is a strawman
proves nothing about deliberation.

**A2.4** `@ahmed.ben.salah` — `POST /discussion` — `topic=salario-minimo`, `stance=support` — **[drive]**
`content=Nel mio magazzino il contratto pirata paga 6,40 €/ora. Non è concorrenza sui margini, è concorrenza su chi accetta meno. Il salario minimo non chiude le imprese oneste: chiude quelle che campano così.`
[*My warehouse's "pirate contract" pays €6.40/hour. That isn't competing on margins, it's competing on who accepts less.*]
→ the reply that makes the disagreement real. Both are true at once. This is
the pair the interface has to hold without flattening.

**A2.5** `@tommaso.ricci` / `@nadia.hamdi` — `POST /discussion` — `topic=autonomia-differenziata`, stances `support` / `concern` — **[drive]**
→ the geographic split. Two members who agree on everything else.

**A2.6** `@valentina.sanna` — `POST /discussion` — `topic=liste-attesa`, `stance=question` — **[drive]**
asks whether the 14-month figure is a median or a worst case.
→ the fixture must contain someone checking, not only asserting.

**A2.7** `@anna.conti` — `POST /social/post` + others `POST /social/follow` (`type=interest`, `type=circle`) — **[drive]**
→ ~20 short posts, ~30 typed follow edges. The social lane is **small talk and
signal**, deliberately *not* the decision track. If a screenshot cannot show at
a glance that a social post is not a vote, the lane separation has failed.

**A2.8** `@sofia.bianchi` — `POST /forum` — **[drive]**
`title=Perché il vincolo di mandato non si aggira con il software`
[*Why the free-mandate rule cannot be engineered around*]
→ the long-form piece stating the constitutional constraint (Art. 67) the whole
model must live inside: the platform produces **accountability, not compulsion**.

Volume target: **≥25 discussion posts across ≥5 topics, ≥20 social posts, ≥3
forum articles.** Below that, topic filters, the gardener, and pagination all
render as empty chrome.

## A.5 Act 3 — A proposal earns its way to a vote

**A3.1** `@giulia.ferrero` — `POST /petitions` — **[drive]**
```
title=Piano di rientro sulle liste d'attesa: tetto all'intramoenia
       [Waiting-list recovery plan: cap on paid in-house private practice]
quorum=250
summary=Vincolare l'attività intramoenia di ogni struttura pubblica a non superare
        il 15% delle prestazioni erogate nella stessa branca, finché i tempi di
        attesa istituzionali superano i limiti di legge per la classe di priorità.
problem=La stessa struttura eroga in due settimane a pagamento ciò che eroga in
        quattordici mesi gratuitamente. Non è una lista d'attesa: è un
        meccanismo di prezzo.
proposedAction=Tetto del 15% per branca, sospeso automaticamente quando i tempi
        rientrano nei limiti di legge.
impact=I pazienti senza disponibilità economica recuperano l'accesso nei tempi
        previsti dai LEA.
risks=Fuga di specialisti verso il privato puro. Il tetto va accompagnato da
        incentivi sull'attività istituzionale, non da sole sanzioni.
implementationPlan=Rilevazione a 3 mesi, tetto sperimentale in 2 ASL pilota a 6
        mesi, revisione a 12.
evidenceSummary=Rilevazione RCN su 14 aziende sanitarie, marzo 2026.
evidenceLinks=https://esempio.rcn.it/liste-attesa/rilevazione-2026
```
→ The `risks` field is doing real work here. A proposal that names the way it
could fail is a different object from a slogan, and the structured outline is
what forces the distinction.

**A3.2** `@marco.deluca` — `POST /petitions/update` — **[drive]**
revises `proposedAction` to 20% after modelling; revision history and a diff
must be inspectable.
→ **the draft changed, and who changed it is on the record.** This is the
collaborative-drafting claim, and it is only credible if the diff is visible.

**A3.3** 250+ members — `POST /petitions/sign` — `petitionId=...` — **[drive]**
→ quorum moves the proposal to `discussion` **on its own**. No moderator
touches it. If quorum were discretionary the signatures would be theatre.

**A3.4** `@luca.esposito` — `POST /petitions/comment` — `stance=concern` — **[drive]**
**A3.5** `@valentina.sanna` — `POST /petitions/comment` — `stance=question`, `factCheck=yes` — **[drive]**
→ a fact-check request on a specific claim, not a vibe.

**A3.6** `@sofia.bianchi` — `POST /petitions/comment` — `stance=concern`, `argumentTitle=Competenza regionale` — **[drive]**
→ argument-map node: the cap may exceed party competence to promise.
→ the deliberation feed must show **support / concern / question** as distinct
shapes. A flat thread here would defeat the purpose.

**A3.7** `@elena.rossi` — `POST /petitions/status` — `status=vote`, `confirmFreeze=yes` — **[drive]**
→ the text freezes, **attributed to her, with a revision id**. Votes are cast
against text that cannot move underneath them. The author cannot do this
(verified: `/petitions/status` requires `moderate`).

**A3.8** members — `POST /petitions/vote` — `choice=yes|no|abstain|auto` — **[drive]**
→ each vote is a signed envelope. `choice=auto` resolves through delegation —
that is where **A5** and **A7** land.

Fixture target: **3 proposals in different stages** — this one in `vote`,
`salario-minimo` in `discussion`, `consumo-suolo` in `draft` below quorum. One
proposal in one stage cannot show a stage filter.

## A.6 Act 4 — A conflict that delegation cannot resolve by itself

**A4.1** `@chiara.moretti` — `POST /petitions` — `title=Rigassificatore costiero: posizione nazionale` — **[drive]**
→ national energy security argues for it.

**A4.2** `@stefano.lombardi` — `POST /petitions/comment` — `stance=concern` — **[drive]**
→ his members carry the local cost; the national benefit is real and lands
elsewhere.
→ **Both are right.** `transizione-energetica` exists in the fixture to hold a
conflict with no correct answer, only an accountable one.

## A.7 Act 5 — Groups, and choosing people

**A5.1** `@irene.fabbri` — `POST /groups` — `action=create`, `name=Circolo Sanità Pubblica`, `topics=liste-attesa,salario-minimo` — **[drive]**
**A5.2** eight members — `POST /groups` — `action=join` — **[drive]**
**A5.3** `@irene.fabbri` — `POST /groups/policy` — `electionMode=vote`, `conflictRule=prompt_user` — **[drive]**
→ `prompt_user` is the honest setting: when recommendations clash the member
chooses. `highest_priority` would decide silently on their behalf.

**A5.4** `@irene.fabbri` — `POST /groups` — `action=startElection`, `topic=liste-attesa`, `candidates=marco.deluca,giulia.ferrero,valentina.sanna` — **[drive]**
**A5.5** members — `POST /groups` — `action=voteElection`, `candidateHash=...`, `secondChoiceHash=...`, `thirdChoiceHash=...` — **[drive]**
→ ranked ballots with transfers. The fixture must produce an election **decided
on transfers, not on first preferences** — otherwise the multi-round code is
never actually exercised and the "why this delegate" metadata shows nothing
interesting.

**A5.6** `@irene.fabbri` — `POST /groups` — `action=closeElection` — **[drive]**
→ winner, method, and round count surface on the card; the group's delegate
cachet updates for that topic.

**A5.7** the group's recommendation reaches a member — **[drive]**
→ it is **advisory**. A member who ignores it is not overridden. Group cachets
inform; they never bind (`AGENTS.md`: "Recommendations are advisory").

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

**A6.5** conflict — group recommends `@marco.deluca`, `@davide.villa` prefers `@irene.fabbri` — `POST /delegation/conflict` — **[drive]**
→ with `conflictRule=prompt_user`, **he chooses**. The fixture must reach this
prompt; it is where advisory-vs-binding stops being a doc claim.

**A6.6** `@marco.deluca` accumulates delegations across `liste-attesa`,
`salario-minimo`, `transizione-energetica` — **[drive]**
→ **the super-delegate, on purpose.** §2.4 says this is the model's most serious
failure mode and the German Pirate Party observed it for real. The fixture must
*contain* it, or nothing tests the mitigation.

**A6.7** — soft cap on concentrated delegated weight — **[design]**
→ §6.2.1 pairs decay with soft caps. Decay exists; caps do not. Recorded as a
gap, not a test.

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
deliberation score.
→ The score is **advisory and must stay so**. A binding score would be an
imperative mandate wearing a number.

**A8.2** `GET /transactions` — **[drive]**
→ every draft, revision, signature, status change, vote, and delegation
override, attributed to a blinded hash.
→ this *is* the accountability dashboard of §9.3.2: not a promise of obedience,
but a record no one can quietly rewrite. Soft power, per §9.3.

**A8.3** `@elena.rossi` votes against the platform's own outcome — **[drive]**
→ **nothing stops her.** The record shows it; the party responds politically at
re-selection. Art. 67 is intact. A fixture that cannot express this has misread
the thesis: the model's compliance with the free mandate is not incidental, it
is the design.

## A.11 Act 9 — Governance changes itself

**A9.1** `@tommaso.ricci` — `POST /governance/proposals` — **[drive]**
`governanceProposalTitle=Quorum ridotto per proposte a impatto regionale`
`governanceProposalQuorumDefault=120`, `governanceProposalReason=...`
→ a member proposes changing the constitution's defaults.

**A9.2** `@rcn.provider` — `POST /admin` — `intent=governance-proposal-decision` — **[drive]**
→ accepted; defaults update; the decision enters public history.
→ **The tension is the point, and the fixture should not hide it.** A provider
admin approving the party's constitutional defaults is the "rented land"
problem of §3.4 reappearing one layer up. Today it is admin-gated. Whether that
should become a member vote is a live design question — see **A1.5**.

## A.12 End state

A reviewer opening this deployment should find: 16 members with handles and
bios · 6 live topics · ≥25 discussion posts · ≥20 social posts with typed
follows · 3 forum articles · 3 proposals in `draft`/`discussion`/`vote` · 250+
signatures · a frozen text with an attributed freeze · a ranked election decided
on transfers · a readable 3-hop delegation chain · a resolved conflict prompt ·
lapsed and renewed delegations · a populated audit log.

No screen should be empty. Every number on screen should have a story behind it
that a member could recount.

---

# Scenario B — ASL Val Sereno

*Reference: `principle-docs/OrganizationPressureManagement.md`*

A fictional Azienda Sanitaria Locale: ~4,200 staff, one presidio ospedaliero,
four distretti, thirty-one RSA and outpatient sites. It adopted the platform as
a **shared inbox**. Nothing else. Every structure below had to earn its place.

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
switched on one at a time in **B5** — the adoption staircase, walked.

The actor label is `user`, not `person`. Verifying that Nadia is authorized
staff is not the same as publishing that a concern came from Nadia.

## B.1 Cast

| Handle | Role | Position | Why they are in the fixture |
| --- | --- | --- | --- |
| `@n.calabrese` | user | Infermiera, Pronto Soccorso | Raises the boarding case at 03:40 |
| `@r.ferrara` | user | Coordinatore infermieristico (caposala) | The overloaded intermediary |
| `@dott.marino` | user | Direttore U.O.C. Medicina d'Urgenza | Keeps the clinical decision right |
| `@f.gallo` | user | Farmacia ospedaliera | Release timing owner |
| `@s.pellegrino` | user | Logistica e trasporti | Delivery capacity |
| `@dott.sa.rizzo` | user | Risk manager / sicurezza del paziente | Holds the stop condition |
| `@a.bruno` | user | Direzione amministrativa | Envelope and ceiling |
| `@m.serra` | user | OSS, RSA Distretto 3 | Long-tail: small site, real need |
| `@g.lombardo` | user | MMG, Distretto 2 | Territorial view the hospital lacks |
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
intended to **replace** the current care-cooperative placeholders.

### B-1 `boarding-pronto-soccorso` — Fundamental need — Role-visible

```
title:        Pazienti in barella in PS oltre 24 ore per mancanza di posti letto
sender:       Pronto Soccorso — turno notte
subject:      Boarding prolungato: 11 pazienti in attesa di ricovero alle 03:40
voiceType:    Fundamental need
visibility:   Role-visible
sourceChannel: Email
pressureType: Chronic
pressureState: Crystallized
trend:        In aumento nei fine settimana
scope:        Pronto Soccorso · Medicina d'Urgenza · Direzione sanitaria
request:      Rivedere il flusso di ricovero e la disponibilità di posti letto
              nel fine settimana.
consequence:  Pazienti anziani in barella oltre 24 ore; il triage rivaluta
              codici che non può ricoverare; il rischio si sposta sul turno.
dependency:   Dimissioni protette, posti letto di Medicina, disponibilità RSA
              e ADI vanno visti insieme.
emailBody:    Alle 03:40 abbiamo 11 pazienti in attesa di posto letto, 4 da oltre
              24 ore, di cui 2 ultraottantenni. Non è un picco: è il quarto
              fine settimana consecutivo. Il triage continua a rivalutare
              pazienti che non possiamo ricoverare.
impactBaseline: 4 weekend consecutivi · mediana attesa ricovero 19h · picco 27h
impactTarget:   Mediana sotto 8h senza spostare l'attesa sul territorio
impactMeasure:  Tempo triage→ricovero, rivalutazioni per paziente, ore di
                straordinario infermieristico
```

**Crystallized**, not Critical. This is the state the model exists to name: it
recurs, it is worked around, nobody is surprised any more, and that is precisely
why it never gets fixed. `impactTarget` carries the anti-displacement clause —
*without moving the wait onto the territory* — because "success" that relocates
the burden to `@g.lombardo`'s district is not success (§*Impact tracking*).

### B-2 `liste-attesa-cup` — Advice & innovation — Fully attributed

```
title:        Recupero disdette CUP: agenda di richiamo rapido
sender:       @g.lombardo — MMG Distretto 2
voiceType:    Advice & innovation
visibility:   Fully attributed
pressureType: Acute
pressureState: Flowing
request:      Richiamo automatico su disdette entro 48h per la classe di
              priorità B.
consequence:  Circa il 9% degli slot specialistici resta inutilizzato mentre
              l'attesa dichiarata supera i limiti di legge.
```

Deliberately **Flowing** and low-stakes: the fixture must show the system
working normally, or the pressure cue is just an alarm that is always on.
Fully attributed because Giovanni *wants* the credit — that is a legitimate
choice, not a default.

### B-3 `farmaci-alto-costo` — Resource consultation — Department-visible

```
title:        Consultazione sul tetto di spesa per farmaci oncologici ad alto costo
sender:       Direzione amministrativa
voiceType:    Resource consultation
visibility:   Department-visible
amount:       €2.400.000 residuo di budget annuo
ceiling:      €150.000 senza delibera del Direttore Generale
fundsState:   Opzioni visibili · nessuna allocazione
consequence:  La scelta cambia i tempi di accesso alla terapia, non solo il costo.
```

The case that makes §*Money and resource handling* concrete — and its limit
explicit. Ward staff can show consequences accounting cannot see; accounting can
show constraints wards cannot see. **The decision still belongs to the person
the law authorizes.** The interface makes the constraint legible; it does not
democratise a delibera.

### B-4 `conflitto-turni-rsa` — Dispute — Protected

```
title:        Conflitto ricorrente sulla copertura notturna in RSA
sender:       @caso-4471 (identità di caso protetta)
voiceType:    Dispute
visibility:   Protected relay
pressureType: Oscillating
pressureState: Crystallized
consequence:  Una sola OSS copre 42 ospiti in notturna; il conflitto sul turno
              ha sostituito la discussione sull'organico.
```

The dispute is **not** the case. The staffing level is. §*Mediation and
pacification* is explicit that pacification is not suppression: mediation here
must not become a way to settle the interpersonal friction and leave 42
residents with one OSS. **B4.4** tests exactly that.

## B.4 Acts

### B1 — The inbox, alone

**B1.1** `@n.calabrese` — email arrives in the shared inbox — **[fixture]**
**B1.2** `@r.ferrara` — reads, replies, sets a response boundary — **[design]**
→ Invariant 1: *communication must work alone.* No case, no owner, no taxonomy.
The ASL could stop here and have gained something.

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

### B4 — Layers, one at a time

**B4.1** `@asl.provider` — `POST /admin` — `intent=modules`, `responsibilities=true` — **[drive]**
→ `@dott.marino` is outcome owner; `@f.gallo` and `@s.pellegrino` hold action
commitments; `@dott.sa.rizzo` holds the stop condition.
→ Invariant 6: assignment without acknowledgement is not ownership. Five
distinct relationships that must **not** collapse into one "assignee".

**B4.2** `intent=modules`, `hierarchies=true` — **[drive]**
```
formalFlow: Infermiere → coordinatore → direttore U.O.C. → direzione sanitaria
actualFlow: Infermiere notte ↔ coordinatore ↔ bed manager
```
→ The gap **is the finding.** The formal chart is not a lie and the actual flow
is not automatically legitimate; `@r.ferrara` is the overloaded intermediary the
mirror exists to reveal.

**B4.3** `intent=modules`, `authority=true` — **[drive]**
```
Raise    · qualunque operatore      · senza autorizzazione
Propose  · gruppo flusso ricoveri   · modifica limitata del percorso
Approve  · direttore sanitario      · pilota 30 giorni entro policy esistente
Stop     · risk manager             · se emerge rischio clinico
Escalate · direzione generale       · se il pilota supera il tetto
```
→ Invariant 5: **titles do not imply unlimited power.** Every grant carries
source, scope, condition, expiry, review. `@dott.marino` keeps the clinical
decision right *and* receives frontline evidence directly — Invariant 4.

**B4.4** `intent=modules`, `mediation=true` — **[drive]** / workflow **[design]**
→ B-4 enters the protected path: acknowledge → review → dialogue → agreement →
escalate → learn.
→ **The test that matters:** mediation must not resolve the interpersonal
conflict while leaving the staffing level untouched. A "successful" mediation
that closes B-4 without changing the ratio is the failure §*Mediation* warns
about, and Invariant 10 says so plainly: *closing a case is not solving a
problem.*

**B4.5** `intent=modules`, `pressureAnalytics=true` — **[drive]**
→ B-1 shows its **components**, never a bare score:
```
volume 4 weekend · velocity +30% vs baseline 90gg · persistence 4 ricorrenze
spread PS→Medicina→RSA · consequence alta (sicurezza) · capacity satura
flow bloccato al bed management
```
→ Invariant 9: **descriptive, not punitive.** No automated sanction may derive
from this, and no individual "pressure absorber" leaderboard may exist —
§*Advice and innovation* excludes it because it rewards unsafe overwork and
exposes protected participation. A test should assert no per-person ranking
renders.

**B4.6** `intent=modules`, `impactTracking=true` — **[drive]** / workflow **[design]**
→ baseline, target, boundary, stop condition, **recurrence and displacement
checks**.

### B5 — Emergency, and the record

**B5.1** a Saturday night reaches Critical; `@dott.marino` opens an overflow
area, bypassing consultation — **[design]**
→ Invariant 11: **urgent command stays fast.** The system records who acted, why
consultation was bypassed, and when review happens. It does not slow him down.
A framework that makes this harder has failed at the exact moment it matters.

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
  `/social`, `/profile`).
- **[fixture]** — everything on `/organization`. It renders from the hardcoded
  `ORGANIZATION_TEMPLATE_CASES` constant. There is **no persistence and no
  write path**: the only interactions are `?case=<id>` and layer tab switching.
  Replacing those four cases with **B-1…B-4** is the single highest-value change
  this document enables — the workspace would then show a recognisable ASL
  instead of a generic care cooperative.
- **[design]** — case promotion, protected relay, commitments, authority grants,
  funds records, mediation, impact reviews. Module-owned records, created lazily
  when a layer is enabled, per the canonical case contract. Not built.

### A vocabulary drift to fix first

The cases above use the pressure states this principle doc defines. The code
does not: `organizationTemplate.js` still ships the **physics metaphor** the doc
moved away from, and has no `Critical` state at all.

| Code today | This doc | Note |
| --- | --- | --- |
| `Gas` | `Diffuse` | many vague or disconnected signals |
| `Liquid` | `Flowing` | issues move and get responses |
| `Solid` | `Crystallized` | persists, hardens into workaround and distrust |
| *(absent)* | `Critical` | fast, high-consequence, near operating limits |

This is not cosmetic. §*Non-goals* names "treating metaphorical pressure physics
as scientific proof" as a thing to avoid, and `Gas`/`Liquid`/`Solid` is that
metaphor presented as a state machine. `Crystallized` says something a reader
can act on — *this recurs and people have stopped expecting a fix* — where
`Solid` says only that the metaphor continues. The missing `Critical` state is
worse than a naming gap: it is the state that should route to **B5.1**,
emergency command with recorded bypass and later review.

Rename when replacing the template cases, and the `pressureType` values
(`Acute`, `Chronic`, `Oscillating`, `Cascade`) can stay — the doc keeps those as
case descriptors.

---

## Coverage map

| Capability | Scenario A | Scenario B |
| --- | --- | --- |
| Blinded identity, one person = one voice | A1.1 | — (staff authorization) |
| Handles, roles, bans | A1.2, A1.5 | B.1 |
| Discussion + stance + evidence | A2.1–A2.6 | B1.1 |
| Social lane + typed follows | A2.7 | — |
| Forum long-form | A2.8 | — |
| Petition drafting + structured outline | A3.1 | — (deliberately off) |
| Revisions + diffs | A3.2 | — |
| Signatures → quorum | A3.3 | — |
| Stance-tagged deliberation + fact-check | A3.4–A3.6 | — |
| Pre-vote freeze (attributed) | A3.7 | — |
| Signed vote envelopes | A3.8 | — |
| Groups + policy | A5.1–A5.3 | — |
| Ranked elections with transfers | A5.4–A5.6 | — |
| Topic-scoped delegation | A6.1–A6.2 | — |
| Transitive chains | A6.3 | — |
| Delegation conflict prompt | A6.5 | — |
| Delegation decay + renewal | A7.1–A7.2 | — |
| Delegate profiles + advisory score | A8.1 | — |
| Audit trail | A8.2 | B4.x |
| Governance defaults + change proposals | A9.1–A9.2 | — |
| Module toggles / adoption staircase | A.0 | B4.1–B4.6, B6.1 |
| Protected voice + reveal policy | — | B3.1–B3.2 |
| Responsibilities vs authority | — | B4.1, B4.3 |
| Formal vs actual flow | — | B4.2 |
| Funds constraint | — | B-3 |
| Mediation | — | B4.4 |
| Pressure components | — | B4.5 |
| Impact + displacement checks | — | B4.6 |
| Emergency bypass with review | — | B5.1 |
| Layer removal | — | B6.1 |

## Using these fixtures

- `scripts/seed-demo.js` should build **Scenario A** — it is the one the current
  code can actually execute end to end.
- `scripts/user-journeys.js` drives the subset marked **[drive]** and asserts
  the observable result of each act. Its screenshots are the README walkthrough.
- Keep the two scenarios in **separate stores**. Merging them produces a
  deployment that is neither a party nor an ASL, and that is the "demo-like"
  failure this document exists to end.
- One member per browser context. Tabs share a cookie jar, so a fixture built in
  one context is one person wearing sixteen names — and every quorum, follow,
  and election in Scenario A would be vacuous.
- When a **[design]** item ships, move its label to **[drive]** and add the
  assertion. The labels are the backlog.
