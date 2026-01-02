#!/usr/bin/env python3
"""
Topic Gardener service.

Stateful topic classification with scheduled refactors (merge/split/rename).
The HTTP API mirrors the original stub but keeps a local topic registry and
exposes status/ops endpoints for inspection.
"""

import argparse
import json
import re
import threading
import time
from collections import Counter
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Dict, List, Optional

DEFAULT_ANCHORS = ["general", "governance", "economy", "society", "technology"]
DEFAULT_REFRACTOR_SECONDS = 90
DEFAULT_SIMILARITY_THRESHOLD = 0.35
DEFAULT_MERGE_THRESHOLD = 0.85
DEFAULT_MIN_RENAME_COUNT = 6
DEFAULT_MIN_SPLIT_COUNT = 14
DEFAULT_MIN_ANCHOR_PROMOTE_COUNT = 12
DEFAULT_MIN_ANCHOR_ARCHIVE_COUNT = 2
DEFAULT_STALE_SECONDS = 7 * 24 * 60 * 60
MAX_OPERATIONS = 200

TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9_-]{2,}")
STOPWORDS = {
  "and", "the", "with", "for", "from", "that", "this", "their", "about",
  "into", "your", "you", "are", "was", "were", "will", "would", "should",
  "could", "have", "has", "had", "our", "they", "them", "who", "what",
  "when", "where", "why", "how", "also", "more", "than", "then", "there",
  "here", "over", "under", "into", "out", "per", "via", "new", "old",
  "plan", "policy", "proposal", "draft", "vote", "votes", "voting",
}


def slugify(label: str) -> str:
  text = label.strip().lower()
  slug = "".join(ch if ch.isalnum() else "-" for ch in text)
  slug = re.sub(r"-+", "-", slug).strip("-")
  return slug or "general"


def tokenize(text: str) -> List[str]:
  tokens = [tok for tok in TOKEN_RE.findall(text.lower()) if tok not in STOPWORDS]
  return tokens


def cosine_similarity(left: Counter, right: Counter) -> float:
  if not left or not right:
    return 0.0
  intersection = set(left.keys()) & set(right.keys())
  dot = sum(left[token] * right[token] for token in intersection)
  left_norm = sum(value * value for value in left.values()) ** 0.5
  right_norm = sum(value * value for value in right.values()) ** 0.5
  if left_norm == 0.0 or right_norm == 0.0:
    return 0.0
  return dot / (left_norm * right_norm)


@dataclass
class TopicStats:
  key: str
  label: str
  anchor: bool = False
  pinned: bool = False
  count: int = 0
  tokens: Counter = field(default_factory=Counter)
  aliases: List[str] = field(default_factory=list)
  last_seen: float = 0.0


class TopicGardener:
  def __init__(
    self,
    similarity_threshold: float,
    merge_threshold: float,
    min_rename_count: int,
    min_split_count: int,
    stale_seconds: int,
    min_anchor_promote_count: int,
    min_anchor_archive_count: int,
  ):
    self.similarity_threshold = similarity_threshold
    self.merge_threshold = merge_threshold
    self.min_rename_count = min_rename_count
    self.min_split_count = min_split_count
    self.stale_seconds = stale_seconds
    self.min_anchor_promote_count = min_anchor_promote_count
    self.min_anchor_archive_count = min_anchor_archive_count
    self.topics: Dict[str, TopicStats] = {}
    self.operations: List[dict] = []
    self.last_refactor_at: Optional[float] = None
    self.lock = threading.Lock()

  def classify(self, text: str, anchors: List[str], pinned: List[str]) -> TopicStats:
    anchors = anchors or DEFAULT_ANCHORS
    pinned = pinned or []
    tokens = tokenize(text)
    now = time.time()

    with self.lock:
      anchor_keys = {slugify(label) for label in anchors}
      pinned_keys = {slugify(label) for label in pinned}
      for topic in self.topics.values():
        topic.anchor = topic.key in anchor_keys
        topic.pinned = topic.key in pinned_keys
      for label in anchors:
        self._ensure_topic(label, anchor=True)
      for label in pinned:
        self._ensure_topic(label, pinned=True)

      label = self._choose_label(text, tokens, anchors, pinned)
      topic = self._ensure_topic(label)
      topic.count += 1
      topic.last_seen = now
      if tokens:
        topic.tokens.update(tokens)
      return topic

  def refactor(self) -> List[dict]:
    now = time.time()
    ops: List[dict] = []
    with self.lock:
      ops.extend(self._merge_similar(now))
      ops.extend(self._rename_topics(now))
      ops.extend(self._split_topics(now))
      ops.extend(self._suggest_anchor_promotions(now))
      ops.extend(self._suggest_anchor_archives(now))
      ops.extend(self._prune_stale(now))
      if ops:
        self.operations.extend(ops)
        self.operations = self.operations[-MAX_OPERATIONS:]
      self.last_refactor_at = now
    return ops

  def snapshot(self) -> dict:
    with self.lock:
      topics = list(self.topics.values())
      summary = [
        {
          "key": topic.key,
          "label": topic.label,
          "count": topic.count,
          "anchor": topic.anchor,
          "pinned": topic.pinned,
          "aliases": topic.aliases[-3:],
          "lastSeen": topic.last_seen,
          "topTokens": [token for token, _ in topic.tokens.most_common(5)],
        }
        for topic in sorted(topics, key=lambda t: (-t.count, t.key))
      ]
      return {
        "topicCount": len(topics),
        "topics": summary,
        "operations": len(self.operations),
        "lastRefactorAt": self.last_refactor_at,
      }

  def get_operations(self) -> List[dict]:
    with self.lock:
      return list(self.operations)

  def _ensure_topic(self, label: str, anchor: bool = False, pinned: bool = False) -> TopicStats:
    key = slugify(label)
    topic = self.topics.get(key)
    if topic is None:
      topic = TopicStats(key=key, label=label or key, anchor=anchor, pinned=pinned)
      self.topics[key] = topic
      return topic
    if anchor:
      topic.anchor = True
    if pinned:
      topic.pinned = True
    if label and label != topic.label and label not in topic.aliases:
      topic.aliases.append(label)
    return topic

  def _choose_label(self, text: str, tokens: List[str], anchors: List[str], pinned: List[str]) -> str:
    text_lower = text.lower()
    ordered = list(dict.fromkeys((pinned or []) + (anchors or [])))
    for label in ordered:
      key = slugify(label)
      if key in tokens or key in text_lower:
        return label

    if tokens and self.topics:
      text_vec = Counter(tokens)
      best_topic = None
      best_score = 0.0
      for topic in self.topics.values():
        if topic.count < 2:
          continue
        score = cosine_similarity(text_vec, topic.tokens)
        if score > best_score:
          best_score = score
          best_topic = topic
      if best_topic and best_score >= self.similarity_threshold:
        return best_topic.label

    if tokens:
      primary = Counter(tokens).most_common(2)
      if primary:
        return primary[0][0]

    return anchors[0] if anchors else "general"

  def _merge_similar(self, now: float) -> List[dict]:
    ops = []
    topics = list(self.topics.values())
    used = set()
    for i, left in enumerate(topics):
      if left.key in used or left.anchor and left.pinned:
        continue
      for right in topics[i + 1 :]:
        if right.key in used:
          continue
        if left.anchor and right.anchor:
          continue
        score = cosine_similarity(left.tokens, right.tokens)
        if score < self.merge_threshold:
          continue
        keep = left
        drop = right
        if right.anchor or right.count > left.count:
          keep, drop = right, left
        keep.tokens.update(drop.tokens)
        keep.count += drop.count
        keep.last_seen = max(keep.last_seen, drop.last_seen)
        if drop.label not in keep.aliases:
          keep.aliases.append(drop.label)
        used.add(drop.key)
        if drop.key in self.topics:
          del self.topics[drop.key]
        ops.append({
          "type": "merge",
          "from": drop.key,
          "to": keep.key,
          "at": now,
          "reason": f"similarity {score:.2f}",
        })
    return ops

  def _rename_topics(self, now: float) -> List[dict]:
    ops = []
    for topic in list(self.topics.values()):
      if topic.anchor or topic.pinned:
        continue
      if topic.count < self.min_rename_count:
        continue
      if not topic.tokens:
        continue
      top_token, _ = topic.tokens.most_common(1)[0]
      if top_token in topic.label.lower():
        continue
      new_key = slugify(top_token)
      if new_key == topic.key or new_key in self.topics:
        continue
      old_key = topic.key
      old_label = topic.label
      topic.key = new_key
      topic.label = top_token
      topic.aliases.append(old_label)
      del self.topics[old_key]
      self.topics[new_key] = topic
      ops.append({
        "type": "rename",
        "from": old_key,
        "to": new_key,
        "at": now,
        "reason": f"top keyword {top_token}",
      })
    return ops

  def _split_topics(self, now: float) -> List[dict]:
    ops = []
    for topic in self.topics.values():
      if topic.anchor or topic.pinned:
        continue
      if topic.count < self.min_split_count:
        continue
      total_tokens = sum(topic.tokens.values())
      if total_tokens < 4:
        continue
      top = topic.tokens.most_common(3)
      if len(top) < 2:
        continue
      primary_share = top[0][1] / total_tokens
      if primary_share > 0.45:
        continue
      ops.append({
        "type": "split",
        "from": topic.key,
        "suggested": [top[0][0], top[1][0]],
        "at": now,
        "reason": "diverse keyword mix",
      })
    return ops

  def _suggest_anchor_promotions(self, now: float) -> List[dict]:
    ops = []
    for topic in self.topics.values():
      if topic.anchor or topic.pinned:
        continue
      if topic.count < self.min_anchor_promote_count:
        continue
      if not topic.last_seen or (now - topic.last_seen) > self.stale_seconds:
        continue
      if self._has_recent_anchor_op("promote", topic.key):
        continue
      ops.append({
        "type": "anchor",
        "action": "promote",
        "from": topic.key,
        "label": topic.label,
        "count": topic.count,
        "at": now,
        "reason": f"count {topic.count}",
      })
    return ops

  def _suggest_anchor_archives(self, now: float) -> List[dict]:
    ops = []
    for topic in self.topics.values():
      if not topic.anchor:
        continue
      if topic.pinned:
        continue
      if topic.key == "general":
        continue
      if topic.count > self.min_anchor_archive_count:
        continue
      if not topic.last_seen or (now - topic.last_seen) < self.stale_seconds:
        continue
      if self._has_recent_anchor_op("archive", topic.key):
        continue
      ops.append({
        "type": "anchor",
        "action": "archive",
        "from": topic.key,
        "label": topic.label,
        "count": topic.count,
        "lastSeen": topic.last_seen,
        "at": now,
        "reason": "stale anchor",
      })
    return ops

  def _prune_stale(self, now: float) -> List[dict]:
    ops = []
    for topic in list(self.topics.values()):
      if topic.anchor or topic.pinned:
        continue
      if topic.last_seen and now - topic.last_seen > self.stale_seconds and topic.count <= 2:
        del self.topics[topic.key]
        ops.append({
          "type": "prune",
          "from": topic.key,
          "at": now,
          "reason": "stale topic",
        })
    return ops

  def _has_recent_anchor_op(self, action: str, key: str) -> bool:
    for op in reversed(self.operations):
      if op.get("type") != "anchor":
        continue
      if op.get("action") != action:
        continue
      if op.get("from") != key:
        continue
      return True
    return False


class Handler(BaseHTTPRequestHandler):
  gardener: TopicGardener = None

  def do_GET(self):  # noqa: N802
    if self.path == "/status":
      self._send_json(200, self.gardener.snapshot())
      return
    if self.path == "/operations":
      self._send_json(200, {"operations": self.gardener.get_operations()})
      return
    self.send_error(404, "Not Found")

  def do_POST(self):  # noqa: N802
    if self.path not in ("/classify", "/refactor"):
      self.send_error(404, "Not Found")
      return

    length = int(self.headers.get("Content-Length", "0"))
    payload = self.rfile.read(length).decode("utf-8") if length else "{}"

    try:
      data = json.loads(payload or "{}")
    except json.JSONDecodeError:
      self.send_error(400, "Invalid JSON body")
      return

    if self.path == "/refactor":
      ops = self.gardener.refactor()
      self._send_json(200, {"operations": ops, "count": len(ops)})
      return

    text = str(data.get("text", "")).strip()
    anchors = data.get("anchors") or DEFAULT_ANCHORS
    pinned = data.get("pinned") or []
    topic = self.gardener.classify(text, anchors, pinned)

    response = {
      "topic": topic.label,
      "topicKey": topic.key,
      "provider": "topic-gardener",
      "anchors": anchors,
      "pinned": pinned,
      "count": topic.count,
    }
    self._send_json(200, response)

  def _send_json(self, status, payload):
    encoded = json.dumps(payload).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json")
    self.send_header("Content-Length", str(len(encoded)))
    self.end_headers()
    self.wfile.write(encoded)

  def log_message(self, format, *args):  # noqa: N802
    return


def start_refactor_loop(gardener: TopicGardener, interval_seconds: int):
  def loop():
    while True:
      time.sleep(interval_seconds)
      try:
        gardener.refactor()
      except Exception:
        continue
  worker = threading.Thread(target=loop, daemon=True)
  worker.start()


def main():
  parser = argparse.ArgumentParser(description="Topic Gardener server")
  parser.add_argument("--host", default="127.0.0.1")
  parser.add_argument("--port", type=int, default=8070)
  parser.add_argument("--refactor-seconds", type=int, default=DEFAULT_REFRACTOR_SECONDS)
  parser.add_argument("--similarity-threshold", type=float, default=DEFAULT_SIMILARITY_THRESHOLD)
  parser.add_argument("--merge-threshold", type=float, default=DEFAULT_MERGE_THRESHOLD)
  parser.add_argument("--min-rename-count", type=int, default=DEFAULT_MIN_RENAME_COUNT)
  parser.add_argument("--min-split-count", type=int, default=DEFAULT_MIN_SPLIT_COUNT)
  parser.add_argument("--min-anchor-promote-count", type=int, default=DEFAULT_MIN_ANCHOR_PROMOTE_COUNT)
  parser.add_argument("--min-anchor-archive-count", type=int, default=DEFAULT_MIN_ANCHOR_ARCHIVE_COUNT)
  args = parser.parse_args()

  gardener = TopicGardener(
    similarity_threshold=args.similarity_threshold,
    merge_threshold=args.merge_threshold,
    min_rename_count=args.min_rename_count,
    min_split_count=args.min_split_count,
    stale_seconds=DEFAULT_STALE_SECONDS,
    min_anchor_promote_count=args.min_anchor_promote_count,
    min_anchor_archive_count=args.min_anchor_archive_count,
  )
  Handler.gardener = gardener
  start_refactor_loop(gardener, args.refactor_seconds)

  server = HTTPServer((args.host, args.port), Handler)
  print(f"Topic Gardener listening on http://{args.host}:{args.port}")
  server.serve_forever()


if __name__ == "__main__":
  main()
