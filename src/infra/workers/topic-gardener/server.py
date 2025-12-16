#!/usr/bin/env python3
"""
Topic Gardener stub service.

Receives text and anchor hints, returns a reconciled topic so multiple providers
stay aligned. Swap the `choose_topic` function with the full DynamicTopicCategorization
implementation (online clustering + scheduled refactors) when ready.
"""

import argparse
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import List

DEFAULT_ANCHORS = ["general", "governance", "economy", "society", "technology"]


def slugify(label: str) -> str:
  text = label.strip().lower()
  slug = "".join(ch if ch.isalnum() else "-" for ch in text)
  slug = slug.strip("-")
  return slug or "general"


def reconcile(label: str, anchors: List[str], pinned: List[str]) -> str:
  target = slugify(label)
  ordered = list(dict.fromkeys((pinned or []) + (anchors or [])))
  for candidate in ordered:
    candidate_slug = slugify(candidate)
    if target.startswith(candidate_slug) or candidate_slug.startswith(target):
      return candidate_slug
  return target


def detect_topic(text: str) -> str:
  normalized = text.lower()
  keywords = [
    ("climate", "climate"),
    ("energy", "energy"),
    ("health", "health"),
    ("education", "education"),
    ("school", "education"),
    ("vote", "governance"),
    ("election", "governance"),
    ("delegate", "governance"),
    ("tax", "economy"),
    ("budget", "economy"),
  ]
  for keyword, label in keywords:
    if keyword in normalized:
      return label
  return ""


def choose_topic(text: str, anchors: List[str], pinned: List[str]) -> str:
  anchors = anchors or DEFAULT_ANCHORS
  pinned = pinned or []
  label = detect_topic(text) or anchors[0] if anchors else "general"
  return reconcile(label, anchors, pinned)


class Handler(BaseHTTPRequestHandler):
  def do_POST(self):
    if self.path != "/classify":
      self.send_error(404, "Not Found")
      return

    length = int(self.headers.get("Content-Length", "0"))
    payload = self.rfile.read(length).decode("utf-8") if length else "{}"

    try:
      data = json.loads(payload or "{}")
    except json.JSONDecodeError:
      self.send_error(400, "Invalid JSON body")
      return

    text = str(data.get("text", "")).strip()
    anchors = data.get("anchors") or DEFAULT_ANCHORS
    pinned = data.get("pinned") or []
    topic = choose_topic(text, anchors, pinned)

    response = {
      "topic": topic,
      "provider": "topic-gardener",
      "anchors": anchors,
      "pinned": pinned,
    }
    encoded = json.dumps(response).encode("utf-8")

    self.send_response(200)
    self.send_header("Content-Type", "application/json")
    self.send_header("Content-Length", str(len(encoded)))
    self.end_headers()
    self.wfile.write(encoded)

  def log_message(self, format, *args):  # noqa: N802
    return


def main():
  parser = argparse.ArgumentParser(description="Topic Gardener stub server")
  parser.add_argument("--host", default="127.0.0.1")
  parser.add_argument("--port", type=int, default=8070)
  args = parser.parse_args()

  server = HTTPServer((args.host, args.port), Handler)
  print(f"Topic Gardener stub listening on http://{args.host}:{args.port}")
  server.serve_forever()


if __name__ == "__main__":
  main()
