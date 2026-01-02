# Topic Gardener Helper

Stateful Python helper that mirrors the DynamicTopicCategorization notes. It exposes a tiny HTTP endpoint the Node app can call so multiple providers reuse the same topic reconciliation logic instead of shipping conflicting labels.

HTTP endpoints:
- `POST /classify` with JSON `{ "text": "...", "anchors": ["general", "..."], "pinned": ["..."] }`
- Response: `{ "topic": "Economy", "topicKey": "economy", "provider": "topic-gardener", "anchors": [...], "pinned": [...], "count": 12 }`
- `GET /status` returns topic counts, top tokens, and last refactor timestamp.
- `GET /operations` returns merge/rename/split/prune plus anchor promotion/archival suggestions recorded by the refactor loop.
- `POST /refactor` triggers a manual merge/split/rename pass (including anchor suggestions) and returns the operations.

Behavior:
- Anchors: admin/policy-provided list that keeps labels consistent (e.g., `governance`, `economy`, `society`, `technology`).
- Pinned topics reflect user/person-picked categories and win direct matches.
- The refactor loop runs on a schedule and performs lightweight merge/rename/prune heuristics; split and anchor suggestions are recorded but not auto-applied.

Run locally:

```bash
cd src/infra/workers/topic-gardener
python server.py --port 8070 --refactor-seconds 90
```

Optional tuning flags:

```bash
python server.py --min-anchor-promote-count 12 --min-anchor-archive-count 2
```

The Node side reads `topicGardenerUrl` and anchors/pins from `/admin` (persisted to `settings.json`) and calls this helper via `classifyWithGardener` in `src/modules/topics/topicGardenerClient.js`.
Topic gardener operations are polled by the app scheduler (or via the `/admin` sync button) to populate topic history and pending rename reviews.
