#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any


def default_db_path() -> Path:
    env = os.environ.get("CRADLE_DB_PATH")
    if env:
        return Path(env).expanduser()

    data_dir = os.environ.get("CRADLE_DATA_DIR")
    if data_dir:
        candidate = Path(data_dir).expanduser() / "cradle.db"
        if candidate.exists():
            return candidate

    candidates = [
        Path("~/Library/Application Support/Cradle/data/cradle.db").expanduser(),
        Path("~/.config/Cradle/data/cradle.db").expanduser(),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def default_log_path(db_path: Path) -> Path | None:
    """Derive server log path from CRADLE_LOG_FILE, CRADLE_DATA_DIR, or db path."""
    env = os.environ.get("CRADLE_LOG_FILE")
    if env:
        return Path(env).expanduser()

    data_dir = os.environ.get("CRADLE_DATA_DIR")
    if data_dir:
        candidate = Path(data_dir).expanduser() / "server.log"
        if candidate.exists():
            return candidate

    # Fall back: db parent directory
    sibling = db_path.parent / "server.log"
    if sibling.exists():
        return sibling
    return None


def open_db(path: Path) -> sqlite3.Connection:
    if not path.exists():
        raise FileNotFoundError(f"Database not found: {path}")
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def parse_attrs(raw: Any) -> Any:
    if raw is None:
        return None
    if not isinstance(raw, str):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return raw


def build_event_where(args: argparse.Namespace) -> tuple[str, list[Any]]:
    parts: list[str] = []
    vals: list[Any] = []
    if args.code:
        parts.append("code = ?")
        vals.append(args.code)
    if args.chat_session_id:
        parts.append("chat_session_id = ?")
        vals.append(args.chat_session_id)
    if args.run_id:
        parts.append("run_id = ?")
        vals.append(args.run_id)
    if args.since_min is not None:
        cutoff = int(time.time() * 1000) - args.since_min * 60 * 1000
        parts.append("recorded_at >= ?")
        vals.append(cutoff)
    where = ""
    if parts:
        where = "WHERE " + " AND ".join(parts)
    return where, vals


def build_snapshot_where(args: argparse.Namespace, table_alias: str = "") -> tuple[str, list[Any]]:
    prefix = f"{table_alias}." if table_alias else ""
    parts: list[str] = []
    vals: list[Any] = []
    if args.chat_session_id:
        parts.append(f"{prefix}chat_session_id = ?")
        vals.append(args.chat_session_id)
    if args.run_id:
        parts.append(f"{prefix}run_id = ?")
        vals.append(args.run_id)
    if getattr(args, "since_min", None) is not None:
        cutoff = int(time.time() * 1000) - args.since_min * 60 * 1000
        parts.append(f"{prefix}started_at >= ?")
        vals.append(cutoff)
    where = ""
    if parts:
        where = "WHERE " + " AND ".join(parts)
    return where, vals


def snapshot_payload(conn: sqlite3.Connection, rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["summary_json"] = parse_attrs(item.get("summary_json"))
        events = conn.execute(
            """
            SELECT id, snapshot_id, chat_session_id, run_id, seq, phase, chunk_type,
                   tool_call_id, tool_name, model_id, prompt_tokens, completion_tokens,
                   total_tokens, estimated_cost_usd, occurred_at, duration_ms, payload_json
            FROM backend_run_snapshot_events
            WHERE snapshot_id = ?
            ORDER BY seq ASC
            """,
            [item["id"]],
        ).fetchall()
        item["events"] = []
        for event in events:
            event_item = dict(event)
            event_item["payload_json"] = parse_attrs(event_item.get("payload_json"))
            item["events"].append(event_item)
        payload.append(item)
    return payload


def command_summary(conn: sqlite3.Connection, args: argparse.Namespace) -> int:
    since_clause = ""
    params: list[Any] = []
    if args.since_min is not None:
        cutoff = int(time.time() * 1000) - args.since_min * 60 * 1000
        since_clause = "WHERE recorded_at >= ?"
        params.append(cutoff)

    print("== Event Counts by Code ==")
    rows = conn.execute(
        f"""
        SELECT code, severity, COUNT(*) AS cnt
        FROM observability_events
        {since_clause}
        GROUP BY code, severity
        ORDER BY cnt DESC, code ASC
        LIMIT 100
        """,
        params,
    ).fetchall()
    for row in rows:
        print(f"{row['code']:<40} {row['severity']:<8} {row['cnt']}")

    print("\n== Open Incidents ==")
    inc_rows = conn.execute(
        """
        SELECT dedupe_key, code, severity, count, last_recorded_at
        FROM observability_incidents
        WHERE status = 'open'
        ORDER BY last_recorded_at DESC
        LIMIT 100
        """
    ).fetchall()
    for row in inc_rows:
        print(
            f"{row['code']:<40} {row['severity']:<8} "
            f"count={row['count']:<4} dedupe={row['dedupe_key']}"
        )
    return 0


def command_events(conn: sqlite3.Connection, args: argparse.Namespace) -> int:
    where, vals = build_event_where(args)
    rows = conn.execute(
        f"""
        SELECT id, code, severity, category, source, message, chat_session_id, run_id, message_id,
               dedupe_key, parent_event_id, occurred_at, recorded_at, attrs_json
        FROM observability_events
        {where}
        ORDER BY recorded_at DESC
        LIMIT ?
        """,
        [*vals, args.limit],
    ).fetchall()
    payload = []
    for row in rows:
        item = dict(row)
        item["attrs_json"] = parse_attrs(item.get("attrs_json"))
        payload.append(item)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def command_incidents(conn: sqlite3.Connection, args: argparse.Namespace) -> int:
    parts: list[str] = []
    vals: list[Any] = []
    if args.code:
        parts.append("code = ?")
        vals.append(args.code)
    if args.chat_session_id:
        parts.append("chat_session_id = ?")
        vals.append(args.chat_session_id)
    if args.run_id:
        parts.append("run_id = ?")
        vals.append(args.run_id)
    if args.status:
        parts.append("status = ?")
        vals.append(args.status)
    where = ""
    if parts:
        where = "WHERE " + " AND ".join(parts)

    rows = conn.execute(
        f"""
        SELECT *
        FROM observability_incidents
        {where}
        ORDER BY last_recorded_at DESC
        LIMIT ?
        """,
        [*vals, args.limit],
    ).fetchall()
    payload = []
    for row in rows:
        item = dict(row)
        item["attrs_json"] = parse_attrs(item.get("attrs_json"))
        payload.append(item)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def command_timeline(conn: sqlite3.Connection, args: argparse.Namespace) -> int:
    where, vals = build_snapshot_where(args)

    rows = conn.execute(
        f"""
        SELECT id, schema_version, trace_id, chat_session_id, run_id, message_id,
               provider_target_id, runtime_kind, provider_session_id, model_id,
               agent_id, workspace_id, status, started_at, completed_at,
               completion_reason, error_text, summary_json
        FROM backend_run_snapshots
        {where}
        ORDER BY started_at DESC
        LIMIT ?
        """,
        [*vals, args.limit],
    ).fetchall()
    print(json.dumps(snapshot_payload(conn, rows), ensure_ascii=False, indent=2))
    return 0


def command_logs(args: argparse.Namespace, db_path: Path) -> int:
    log_path = Path(args.log).expanduser() if args.log else default_log_path(db_path)
    if not log_path or not log_path.exists():
        print(f"Server log not found at {log_path}", file=sys.stderr)
        return 1

    lines_count = args.lines
    if args.tail:
        # Read last N lines efficiently
        import subprocess
        result = subprocess.run(
            ["tail", "-n", str(lines_count), str(log_path)],
            capture_output=True, text=True,
        )
        print(result.stdout, end="")
        return 0

    with open(log_path) as f:
        for line in f:
            if lines_count <= 0:
                break
            if args.filter:
                if args.filter.lower() in line.lower():
                    print(line, end="")
                    lines_count -= 1
            else:
                print(line, end="")
                lines_count -= 1
    return 0


def command_bundle(conn: sqlite3.Connection, args: argparse.Namespace, db_path: Path) -> int:
    where, vals = build_event_where(args)
    events = conn.execute(
        f"""
        SELECT *
        FROM observability_events
        {where}
        ORDER BY recorded_at DESC
        LIMIT ?
        """,
        [*vals, args.limit],
    ).fetchall()
    events_payload = []
    for row in events:
        item = dict(row)
        item["attrs_json"] = parse_attrs(item.get("attrs_json"))
        events_payload.append(item)

    inc_parts: list[str] = []
    inc_vals: list[Any] = []
    if args.chat_session_id:
        inc_parts.append("chat_session_id = ?")
        inc_vals.append(args.chat_session_id)
    if args.run_id:
        inc_parts.append("run_id = ?")
        inc_vals.append(args.run_id)
    if args.code:
        inc_parts.append("code = ?")
        inc_vals.append(args.code)
    inc_where = ""
    if inc_parts:
        inc_where = "WHERE " + " AND ".join(inc_parts)

    incidents = conn.execute(
        f"""
        SELECT *
        FROM observability_incidents
        {inc_where}
        ORDER BY last_recorded_at DESC
        LIMIT ?
        """,
        [*inc_vals, args.limit],
    ).fetchall()
    incidents_payload = []
    for row in incidents:
        item = dict(row)
        item["attrs_json"] = parse_attrs(item.get("attrs_json"))
        incidents_payload.append(item)

    tl_where, tl_vals = build_snapshot_where(args)
    timeline = conn.execute(
        f"""
        SELECT id, schema_version, trace_id, chat_session_id, run_id, message_id,
               provider_target_id, runtime_kind, provider_session_id, model_id,
               agent_id, workspace_id, status, started_at, completed_at,
               completion_reason, error_text, summary_json
        FROM backend_run_snapshots
        {tl_where}
        ORDER BY started_at DESC
        LIMIT ?
        """,
        [*tl_vals, args.limit],
    ).fetchall()
    timeline_payload = snapshot_payload(conn, timeline)

    bundle = {
        "meta": {
            "generatedAt": int(time.time() * 1000),
            "dbPath": str(db_path),
            "filters": {
                "code": args.code,
                "chatSessionId": args.chat_session_id,
                "runId": args.run_id,
                "sinceMin": args.since_min,
                "limit": args.limit,
            },
        },
        "events": events_payload,
        "incidents": incidents_payload,
        "timeline": timeline_payload,
    }

    out_path = Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(out_path))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Cradle observability debugger")
    parser.add_argument("--db", default=None, help="Path to cradle.db")

    sub = parser.add_subparsers(dest="command", required=True)

    summary = sub.add_parser("summary", help="Print code/severity summary and open incidents")
    summary.add_argument("--since-min", type=int, default=120)

    events = sub.add_parser("events", help="Print observability events as JSON")
    events.add_argument("--code", default=None)
    events.add_argument("--chat-session-id", default=None)
    events.add_argument("--run-id", default=None)
    events.add_argument("--since-min", type=int, default=None)
    events.add_argument("--limit", type=int, default=200)

    incidents = sub.add_parser("incidents", help="Print incidents as JSON")
    incidents.add_argument("--code", default=None)
    incidents.add_argument("--chat-session-id", default=None)
    incidents.add_argument("--run-id", default=None)
    incidents.add_argument("--status", choices=["open", "resolved"], default=None)
    incidents.add_argument("--limit", type=int, default=200)

    timeline = sub.add_parser("timeline", help="Print backend run snapshots with ordered events as JSON")
    timeline.add_argument("--chat-session-id", default=None)
    timeline.add_argument("--run-id", default=None)
    timeline.add_argument("--since-min", type=int, default=None)
    timeline.add_argument("--limit", type=int, default=500)

    bundle = sub.add_parser("bundle", help="Export event/incident/timeline bundle")
    bundle.add_argument("--code", default=None)
    bundle.add_argument("--chat-session-id", default=None)
    bundle.add_argument("--run-id", default=None)
    bundle.add_argument("--since-min", type=int, default=None)
    bundle.add_argument("--limit", type=int, default=2000)
    bundle.add_argument("--out", required=True, help="Output JSON path")

    logs = sub.add_parser("logs", help="Read server log file")
    logs.add_argument("--log", default=None, help="Path to server log (auto-detected from env vars or db path)")
    logs.add_argument("--lines", type=int, default=100, help="Number of lines to read (default: 100)")
    logs.add_argument("--filter", default=None, help="Case-insensitive substring filter")
    logs.add_argument("--tail", action="store_true", help="Read last N lines (uses tail -n)")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    db_path = Path(args.db).expanduser() if args.db else default_db_path()

    # logs command doesn't need a DB connection
    if args.command == "logs":
        return command_logs(args, db_path)

    try:
        conn = open_db(db_path)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2

    try:
        if args.command == "summary":
            return command_summary(conn, args)
        if args.command == "events":
            return command_events(conn, args)
        if args.command == "incidents":
            return command_incidents(conn, args)
        if args.command == "timeline":
            return command_timeline(conn, args)
        if args.command == "bundle":
            return command_bundle(conn, args, db_path)
        parser.error(f"Unsupported command: {args.command}")
        return 2
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
