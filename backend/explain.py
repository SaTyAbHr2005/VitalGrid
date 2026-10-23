"""Explanation agent: turns a rule-validated alert into one plain sentence.

Gemini first (10 s deadline, its minimum), Groq if Gemini errors, a template if both fail. The LLM only rewords facts
that the rules already validated; it never decides which alerts exist. Text is cached in Atlas per
(path, cause) so each distinct propagation path costs one API call.
"""
import hashlib
import os
import time
from concurrent.futures import ThreadPoolExecutor, wait

from backend.db import get_db

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b")
TIMEOUT_S = 3.0          # Groq timeout; Gemini rejects deadlines under 10 s
GEMINI_TIMEOUT_MS = 10_000
_pool = ThreadPoolExecutor(max_workers=4)
_pending = {}   # key -> future, so the same path is never requested twice at once
_failed_at = {} # key -> time both providers last failed
RETRY_S = 60
_clients = {}

PROMPT = """You write alert lines for an ICU infrastructure operations dashboard.
Use only these validated facts; do not invent causes or numbers.
- Component at risk: {node} ({node_type})
- Dependency path (root cause first): {chain}
- Root cause evidence: {cause}
- Rules passed: {rules}
Write exactly one sentence (max 30 words) naming the component at risk, the root cause and the dependency it travels through. No preamble."""


def _key(item):
    return hashlib.sha1(f"{'>'.join(item['path'])}|{item['cause']}".encode()).hexdigest()


def template(item):
    if len(item["path"]) == 1:
        return f"{item['node']} is impaired: {item['cause']}."
    chain = " -> ".join(item["path"])
    return f"{item['node']} at risk via {chain}: {item['cause']}."


def _gemini(prompt):
    if "gemini" not in _clients:
        from google import genai
        from google.genai import types
        _clients["gemini"] = genai.Client(api_key=os.environ["GEMINI_API_KEY"],
                                          http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_MS))
    return _clients["gemini"].models.generate_content(model=GEMINI_MODEL, contents=prompt).text


def _groq(prompt):
    if "groq" not in _clients:
        from groq import Groq
        _clients["groq"] = Groq(api_key=os.environ["GROQ_API_KEY"], timeout=TIMEOUT_S, max_retries=0)
    r = _clients["groq"].chat.completions.create(model=GROQ_MODEL, max_tokens=800, reasoning_effort="low",
                                                 messages=[{"role": "user", "content": prompt}])
    if r.choices[0].finish_reason != "stop":
        raise RuntimeError(f"reply cut off ({r.choices[0].finish_reason})")
    return r.choices[0].message.content


def _generate(key, item):
    chain = " -> ".join(item["path"]) if len(item["path"]) > 1 else f"{item['node']} only (local fault, not caused upstream)"
    prompt = PROMPT.format(node=item["node"], node_type=item["node_type"], chain=chain,
                           cause=item["cause"], rules=", ".join(item["rules"]))
    for name, fn in (("gemini", _gemini), ("groq", _groq)):
        if not os.environ.get(f"{name.upper()}_API_KEY"):
            continue
        try:
            text = next(iter((fn(prompt) or "").strip().splitlines()), "")
            if text:
                doc = {"_id": key, "text": text, "provider": name}
                get_db().explanations.replace_one({"_id": key}, doc, upsert=True)
                return doc
        except Exception as e:  # rate limit, timeout, outage: fall through to the next provider
            print(f"explain: {name} failed: {type(e).__name__}: {ascii(str(e)[:120])}", flush=True)
    _failed_at[key] = time.time()  # templates are not cached, so this path is retried after RETRY_S
    return {"text": template(item), "provider": "template"}


def explain_many(items, wait_s=4.0):
    """items: [{"node", "node_type", "path", "cause", "rules"}] -> [{"text", "provider"}] in the same order.
    Uncached items are generated in parallel; anything not ready within wait_s gets the template for now."""
    keys = [_key(i) for i in items]
    cached = {d["_id"]: d for d in get_db().explanations.find({"_id": {"$in": keys}})}
    for k, f in list(_pending.items()):
        if f.done():
            _pending.pop(k)
    futures = {}
    for k, item in zip(keys, items):
        if k in cached or time.time() - _failed_at.get(k, 0) < RETRY_S:
            continue
        if k not in _pending:
            _pending[k] = _pool.submit(_generate, k, item)
        futures[k] = _pending[k]
    if futures:
        wait(list(futures.values()), timeout=wait_s)
    out = []
    for k, item in zip(keys, items):
        if k in cached:
            out.append({"text": cached[k]["text"], "provider": cached[k]["provider"]})
        elif k in futures and futures[k].done():
            d = futures[k].result()
            out.append({"text": d["text"], "provider": d["provider"]})
        else:
            out.append({"text": template(item), "provider": "template"})
    return out
