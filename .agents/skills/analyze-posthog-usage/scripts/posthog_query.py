#!/usr/bin/env python3
"""Execute a read-only HogQL query against PostHog's Query API."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_API_HOST = "https://us.posthog.com"
WRITE_PREFIXES = (
    "alter ",
    "attach ",
    "create ",
    "delete ",
    "detach ",
    "drop ",
    "insert ",
    "optimize ",
    "rename ",
    "truncate ",
    "update ",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a named, read-only HogQL query with PostHog Query Read credentials.",
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--query", help="HogQL query text. Prefer --file or stdin for long queries.")
    source.add_argument("--file", type=Path, help="Path to a UTF-8 HogQL file.")
    parser.add_argument("--name", default="codex_product_usage_analysis", help="Meaningful PostHog query name.")
    parser.add_argument("--env-file", type=Path, help="Optional gitignored KEY=VALUE environment file.")
    parser.add_argument("--format", choices=("pretty", "json", "tsv"), default="pretty")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds.")
    parser.add_argument("--check", action="store_true", help="Verify configuration and Query API access with SELECT 1.")
    return parser.parse_args()


def load_env_file(path: Path) -> None:
    if not path.is_file():
        raise ValueError(f"Environment file does not exist: {path}")

    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise ValueError(f"Invalid environment assignment at {path}:{line_number}")
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


def read_query(args: argparse.Namespace) -> str:
    if args.check:
        return "SELECT 1 AS query_access"
    if args.query is not None:
        return args.query.strip()
    if args.file is not None:
        return args.file.read_text(encoding="utf-8").strip()
    if sys.stdin.isatty():
        raise ValueError("Provide --query, --file, stdin, or --check.")
    return sys.stdin.read().strip()


def validate_query(query: str) -> None:
    if not query:
        raise ValueError("HogQL query is empty.")
    normalized = query.lstrip().lower()
    if not (normalized.startswith("select ") or normalized.startswith("with ")):
        raise ValueError("Only SELECT or WITH ... SELECT queries are allowed.")
    if any(normalized.startswith(prefix) for prefix in WRITE_PREFIXES):
        raise ValueError("Mutating HogQL statements are not allowed.")


def required_config() -> tuple[str, str, str]:
    api_key = os.environ.get("POSTHOG_PERSONAL_API_KEY", "").strip()
    project_id = os.environ.get("POSTHOG_PROJECT_ID", "").strip()
    api_host = os.environ.get("POSTHOG_API_HOST", DEFAULT_API_HOST).strip().rstrip("/")

    missing = [
        name
        for name, value in (
            ("POSTHOG_PERSONAL_API_KEY", api_key),
            ("POSTHOG_PROJECT_ID", project_id),
        )
        if not value
    ]
    if missing:
        raise ValueError(f"Missing required configuration: {', '.join(missing)}")
    if api_key.startswith("phc_"):
        raise ValueError("POSTHOG_PERSONAL_API_KEY must be a private Personal API Key, not a phc_ project token.")
    if ".i.posthog.com" in api_host:
        raise ValueError("POSTHOG_API_HOST must be the private API host (for example https://us.posthog.com), not the ingestion host.")
    if not api_host.startswith("https://") and not api_host.startswith("http://"):
        raise ValueError("POSTHOG_API_HOST must include http:// or https://.")
    return api_key, project_id, api_host


def execute_query(query: str, name: str, timeout: float) -> dict[str, Any]:
    api_key, project_id, api_host = required_config()
    url = f"{api_host}/api/projects/{project_id}/query/"
    payload = json.dumps(
        {
            "query": {"kind": "HogQLQuery", "query": query},
            "name": name,
        },
    ).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "cradle-analyze-posthog-usage/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.dumps(json.loads(body), ensure_ascii=False)
        except json.JSONDecodeError:
            detail = body[:1000]
        raise RuntimeError(f"PostHog Query API returned HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Could not reach PostHog Query API: {error.reason}") from error


def print_result(result: dict[str, Any], output_format: str) -> None:
    if output_format == "json":
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return
    if output_format == "pretty":
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    columns = result.get("columns")
    rows = result.get("results")
    if not isinstance(rows, list):
        raise ValueError("PostHog response has no tabular results array; use --format pretty.")
    if isinstance(columns, list):
        print("\t".join(format_cell(column) for column in columns))
    for row in rows:
        values = row if isinstance(row, list) else [row]
        print("\t".join(format_cell(value) for value in values))


def format_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    else:
        text = str(value)
    return text.replace("\t", " ").replace("\r", " ").replace("\n", " ")


def main() -> int:
    args = parse_args()
    try:
        if args.env_file is not None:
            load_env_file(args.env_file)
        query = read_query(args)
        validate_query(query)
        result = execute_query(query, args.name, args.timeout)
        print_result(result, args.format)
        return 0
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

