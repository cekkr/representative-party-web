# Topic Gardener Helper (stub)

Lightweight Python helper that mirrors the DynamicTopicCategorization notes. It exposes a tiny HTTP endpoint the Node app can call so multiple providers reuse the same topic reconciliation logic instead of shipping conflicting labels.

- Endpoint: `POST /classify` with JSON `{ "text": "...", "anchors": ["general", "..."], "pinned": ["..."] }`
- Response: `{ "topic": "economy", "provider": "topic-gardener", "anchors": [...], "pinned": [...] }`
- Anchors: admin/policy-provided list that keeps labels consistent (e.g., `governance`, `economy`, `society`, `technology`). Pinned topics reflect user/person-picked categories.
- This stub uses simple keyword heuristics and prefers pinned/anchor matches; swap the `choose_topic` function with a BERTopic/LLM-backed flow when ready.

Run locally:

```bash
cd src/infra/workers/topic-gardener
python server.py --port 8070
```

The Node side reads `topicGardenerUrl` and anchors/pins from `/admin` (persisted to `settings.json`) and calls this helper via `classifyWithGardener` in `src/modules/topics/topicGardenerClient.js`.
