#!/usr/bin/env python3
"""Collect and model Cradle Electron Tab working set growth.

This script intentionally uses the existing /observability/runtime-snapshot API
instead of adding a product endpoint. It can collect live samples or replay a
previous NDJSON capture, then writes analysis, model context, and optional
Markdown summary artifacts.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_SERVER_URL = "http://127.0.0.1:21423"
DEFAULT_SAMPLE_COUNT = 12
DEFAULT_INTERVAL_MS = 10_000
DEFAULT_SAMPLE_LIMIT = 240
DEFAULT_MIN_GROWTH_MB = 64.0
DEFAULT_KEY_POINT_LIMIT = 8
DETAIL_LIMIT = 5


JsonObject = dict[str, Any]


@dataclass(frozen=True)
class Point:
    sampled_at: int
    collected_at: int | None
    tab_working_set_mb: float
    tab_peak_working_set_mb: float
    tab_process_count: int
    tab_processes: list[JsonObject]
    renderer_js_heap_mb: float
    renderer_total_js_heap_mb: float
    chat_estimated_chars: int
    chat_part_count: int
    chat_tool_part_count: int
    generating_message_count: int
    passive_streaming_message_count: int
    browser_panel_live_tab_count: int
    browser_panel_runtime_count: int
    browser_panel_runtime_detail_count: int
    window_count: int
    renderer_window: JsonObject | None
    top_chat_sessions: list[JsonObject]
    active_streaming_messages: list[JsonObject]
    replay_top_runs: list[JsonObject]


def now_ms() -> int:
    return int(time.time() * 1000)


def read_obj(value: Any) -> JsonObject:
    return value if isinstance(value, dict) else {}


def read_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def read_number(value: Any, default: float = 0.0) -> float:
    return float(value) if isinstance(value, (int, float)) and math.isfinite(value) else default


def read_int(value: Any, default: int = 0) -> int:
    return int(value) if isinstance(value, (int, float)) and math.isfinite(value) else default


def round2(value: float) -> float:
    return round(value + 0.0, 2)


def kib_to_mb(value: Any) -> float:
    return read_number(value) / 1024.0


def default_data_dir() -> Path:
    if os.environ.get("CRADLE_DATA_DIR"):
        return Path(os.environ["CRADLE_DATA_DIR"])
    if os.environ.get("CRADLE_DB_PATH"):
        return Path(os.environ["CRADLE_DB_PATH"]).parent
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Cradle"
    return Path.home() / ".config" / "Cradle"


def timestamp_slug() -> str:
    return datetime.now(timezone.utc).isoformat().replace(":", "").replace(".", "-")


def default_capture_path() -> Path:
    return default_data_dir() / "observability" / "tab-working-set" / f"{timestamp_slug()}.ndjson"


def replace_suffix(path: Path, suffix: str) -> Path:
    if path.suffix == ".ndjson":
        return path.with_suffix(suffix)
    return Path(f"{path}{suffix}")


def fetch_json(url: str) -> JsonObject:
    request = urllib.request.Request(url, headers={"accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GET {url} failed: {error.code} {body}") from error


def snapshot_from_row(row: Any) -> JsonObject:
    record = read_obj(row)
    return read_obj(record.get("snapshot")) or record


def latest_desktop_sample(snapshot: JsonObject) -> JsonObject:
    desktop = read_obj(snapshot.get("desktop"))
    samples = read_list(desktop.get("latestSamples"))
    return read_obj(samples[-1]) if samples else {}


def simplify(record: Any, keys: list[str]) -> JsonObject:
    obj = read_obj(record)
    return {key: obj[key] for key in keys if key in obj}


def top_n(records: Any, keys: list[str], limit: int = DETAIL_LIMIT) -> list[JsonObject]:
    return [simplify(item, keys) for item in read_list(records)[:limit]]


def extract_tab_processes(sample: JsonObject) -> list[JsonObject]:
    processes: list[JsonObject] = []
    for metric in read_list(sample.get("appMetrics")):
        item = read_obj(metric)
        if item.get("type") != "Tab":
            continue
        memory = read_obj(item.get("memory"))
        processes.append(
            {
                "pid": item.get("pid"),
                "workingSetMB": round2(kib_to_mb(memory.get("workingSetSize"))),
                "peakWorkingSetMB": round2(kib_to_mb(memory.get("peakWorkingSetSize"))),
            }
        )
    return sorted(processes, key=lambda item: read_number(item.get("workingSetMB")), reverse=True)


def extract_renderer_totals(sample: JsonObject) -> JsonObject:
    totals = {
        "rendererJSHeapMB": 0.0,
        "rendererTotalJSHeapMB": 0.0,
        "chatEstimatedChars": 0,
        "chatPartCount": 0,
        "chatToolPartCount": 0,
        "generatingMessageCount": 0,
        "passiveStreamingMessageCount": 0,
    }
    diagnostics = read_obj(sample.get("diagnostics"))
    for entry in read_list(diagnostics.get("renderers")):
        renderer = read_obj(read_obj(entry).get("renderer"))
        if not renderer:
            continue
        memory = read_obj(read_obj(renderer.get("rendererMemory")).get("current"))
        totals["rendererJSHeapMB"] += read_number(memory.get("usedJSHeapSize")) / 1024 / 1024
        totals["rendererTotalJSHeapMB"] += read_number(memory.get("totalJSHeapSize")) / 1024 / 1024
        chat_totals = read_obj(read_obj(renderer.get("chatStore")).get("totals"))
        totals["chatEstimatedChars"] += read_int(chat_totals.get("estimatedPartStringChars"))
        totals["chatPartCount"] += read_int(chat_totals.get("partCount"))
        totals["chatToolPartCount"] += read_int(chat_totals.get("toolPartCount"))
        totals["generatingMessageCount"] += read_int(chat_totals.get("generatingMessageCount"))
        totals["passiveStreamingMessageCount"] += read_int(chat_totals.get("passiveStreamingMessageCount"))
    return totals


def extract_point(row: Any) -> Point | None:
    row_obj = read_obj(row)
    snapshot = snapshot_from_row(row)
    if not snapshot:
        return None

    sample = latest_desktop_sample(snapshot)
    drilldowns = read_obj(snapshot.get("drilldowns"))
    renderer = read_obj(drilldowns.get("renderer"))
    browser_panel = read_obj(drilldowns.get("browserPanel"))
    replay = read_obj(drilldowns.get("replay"))
    renderer_windows = read_list(renderer.get("rendererWindows"))
    renderer_window_raw = read_obj(renderer_windows[0]) if renderer_windows else {}
    renderer_window = simplify(
        renderer_window_raw,
        [
            "windowId",
            "title",
            "visible",
            "webContentsId",
            "rendererProcessId",
            "url",
            "locationHash",
            "usedJSHeapSize",
            "totalJSHeapSize",
            "nodeCount",
            "messageBubbleCount",
            "toolCallCount",
        ],
    )

    tab_processes = extract_tab_processes(sample)
    renderer_totals = extract_renderer_totals(sample)
    fallback_browser = read_obj(read_obj(sample.get("diagnostics")).get("browser"))
    fallback_panel = read_obj(fallback_browser.get("panel"))
    browser_panel_panel = read_obj(browser_panel.get("panel"))
    browser_live_tabs = len(read_list(browser_panel.get("liveTabs")))
    if browser_live_tabs == 0:
      browser_live_tabs = sum(
          read_int(read_obj(thread).get("liveTabCount"))
          for thread in read_list(fallback_browser.get("threads"))
      )

    renderer_js_heap_mb = read_number(renderer_totals["rendererJSHeapMB"])
    renderer_total_heap_mb = read_number(renderer_totals["rendererTotalJSHeapMB"])
    if renderer_js_heap_mb == 0:
        renderer_js_heap_mb = read_number(renderer_window_raw.get("usedJSHeapSize")) / 1024 / 1024
    if renderer_total_heap_mb == 0:
        renderer_total_heap_mb = read_number(renderer_window_raw.get("totalJSHeapSize")) / 1024 / 1024

    sampled_at = read_int(sample.get("sampledAt")) or read_int(snapshot.get("timestamp"))
    if sampled_at == 0:
        sampled_at = read_int(row_obj.get("collectedAt"))

    return Point(
        sampled_at=sampled_at,
        collected_at=read_int(row_obj.get("collectedAt")) or None,
        tab_working_set_mb=round2(sum(read_number(item.get("workingSetMB")) for item in tab_processes)),
        tab_peak_working_set_mb=round2(sum(read_number(item.get("peakWorkingSetMB")) for item in tab_processes)),
        tab_process_count=len(tab_processes),
        tab_processes=tab_processes,
        renderer_js_heap_mb=round2(renderer_js_heap_mb),
        renderer_total_js_heap_mb=round2(renderer_total_heap_mb),
        chat_estimated_chars=read_int(renderer_totals["chatEstimatedChars"]),
        chat_part_count=read_int(renderer_totals["chatPartCount"]),
        chat_tool_part_count=read_int(renderer_totals["chatToolPartCount"]),
        generating_message_count=read_int(renderer_totals["generatingMessageCount"]),
        passive_streaming_message_count=read_int(renderer_totals["passiveStreamingMessageCount"]),
        browser_panel_live_tab_count=browser_live_tabs,
        browser_panel_runtime_count=read_int(browser_panel_panel.get("runtimeCount"))
        or read_int(fallback_panel.get("runtimeCount")),
        browser_panel_runtime_detail_count=len(read_list(browser_panel.get("runtimes"))),
        window_count=len(read_list(sample.get("windows"))),
        renderer_window=renderer_window or None,
        top_chat_sessions=top_n(
            renderer.get("topChatSessions"),
            [
                "sessionId",
                "hydrated",
                "estimatedPartStringChars",
                "messageCount",
                "partCount",
                "textPartCount",
                "toolPartCount",
                "filePartCount",
                "streamingMessageCount",
                "generatingMessageCount",
                "passiveStreamingMessageCount",
                "hasLocalDriver",
                "passiveStatus",
                "errorCount",
            ],
        ),
        active_streaming_messages=top_n(
            renderer.get("activeStreamingMessages"),
            [
                "sessionId",
                "messageId",
                "estimatedPartStringChars",
                "partCount",
                "generating",
                "passiveStreaming",
                "localDriver",
                "role",
            ],
        ),
        replay_top_runs=top_n(
            replay.get("topRuns"),
            [
                "runId",
                "sessionId",
                "messageId",
                "chunkCount",
                "textDeltaCount",
                "reasoningDeltaCount",
                "toolInputDeltaCount",
                "toolOutputCount",
                "maxDeltaChars",
                "providerTargetKind",
                "providerTargetId",
                "modelId",
            ],
        ),
    )


def point_to_series(point: Point) -> JsonObject:
    return {
        "sampledAt": point.sampled_at,
        "collectedAt": point.collected_at,
        "tabWorkingSetMB": point.tab_working_set_mb,
        "tabPeakWorkingSetMB": point.tab_peak_working_set_mb,
        "tabProcessCount": point.tab_process_count,
        "tabProcesses": point.tab_processes,
        "rendererJSHeapMB": point.renderer_js_heap_mb,
        "rendererTotalJSHeapMB": point.renderer_total_js_heap_mb,
        "chatEstimatedPartStringChars": point.chat_estimated_chars,
        "chatPartCount": point.chat_part_count,
        "chatToolPartCount": point.chat_tool_part_count,
        "generatingMessageCount": point.generating_message_count,
        "passiveStreamingMessageCount": point.passive_streaming_message_count,
        "browserPanelLiveTabCount": point.browser_panel_live_tab_count,
        "browserPanelRuntimeCount": point.browser_panel_runtime_count,
        "browserPanelRuntimeDetailCount": point.browser_panel_runtime_detail_count,
        "windowCount": point.window_count,
        "rendererWindow": point.renderer_window,
    }


def pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 3 or len(xs) != len(ys):
        return None
    x_mean = statistics.fmean(xs)
    y_mean = statistics.fmean(ys)
    numerator = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys))
    x_denominator = sum((x - x_mean) ** 2 for x in xs)
    y_denominator = sum((y - y_mean) ** 2 for y in ys)
    denominator = math.sqrt(x_denominator * y_denominator)
    return None if denominator == 0 else round(numerator / denominator, 3)


def slope_per_minute(points: list[Point], attr: str) -> float | None:
    if len(points) < 2:
        return None
    xs = [(point.sampled_at - points[0].sampled_at) / 60_000 for point in points]
    ys = [float(getattr(point, attr)) for point in points]
    x_mean = statistics.fmean(xs)
    y_mean = statistics.fmean(ys)
    denominator = sum((x - x_mean) ** 2 for x in xs)
    if denominator == 0:
        return None
    numerator = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys))
    return round2(numerator / denominator)


def series_sse(values: list[float]) -> float:
    if not values:
        return 0.0
    mean = statistics.fmean(values)
    return sum((value - mean) ** 2 for value in values)


def best_change_point(points: list[Point]) -> JsonObject | None:
    if len(points) < 5:
        return None
    values = [point.tab_working_set_mb for point in points]
    baseline = series_sse(values)
    best: tuple[float, int] | None = None
    for index in range(2, len(values) - 2):
        score = baseline - (series_sse(values[:index]) + series_sse(values[index:]))
        if best is None or score > best[0]:
            best = (score, index)
    if best is None or best[0] <= 0:
        return None
    index = best[1]
    previous = points[index - 1]
    current = points[index]
    return {
        "index": index,
        "sampledAt": current.sampled_at,
        "score": round2(best[0]),
        "deltaTabWorkingSetMB": round2(current.tab_working_set_mb - previous.tab_working_set_mb),
        "beforeTabWorkingSetMB": previous.tab_working_set_mb,
        "afterTabWorkingSetMB": current.tab_working_set_mb,
    }


def key_point(point: Point, previous: Point | None, index: int) -> JsonObject:
    output = point_to_series(point)
    output.update(
        {
            "index": index,
            "deltaTabWorkingSetMB": round2(point.tab_working_set_mb - previous.tab_working_set_mb)
            if previous
            else 0,
            "deltaRendererJSHeapMB": round2(point.renderer_js_heap_mb - previous.renderer_js_heap_mb)
            if previous
            else 0,
            "deltaChatEstimatedPartStringChars": point.chat_estimated_chars - previous.chat_estimated_chars
            if previous
            else 0,
            "topChatSessions": point.top_chat_sessions,
            "activeStreamingMessages": point.active_streaming_messages,
            "replayTopRuns": point.replay_top_runs,
        }
    )
    return output


def build_key_points(points: list[Point], limit: int) -> list[JsonObject]:
    if not points:
        return []
    indexed = [(index, point, points[index - 1] if index > 0 else None) for index, point in enumerate(points)]
    selected: dict[int, JsonObject] = {}

    def add(item: tuple[int, Point, Point | None] | None) -> None:
        if item is None:
            return
        index, point, previous = item
        selected.setdefault(index, key_point(point, previous, index))

    add(indexed[0])
    add(indexed[-1])
    ranked = sorted(
        indexed,
        key=lambda item: abs(item[1].tab_working_set_mb - (item[2].tab_working_set_mb if item[2] else item[1].tab_working_set_mb)),
        reverse=True,
    )
    for item in ranked:
        if len(selected) >= limit:
            break
        add(item)
    return [selected[index] for index in sorted(selected)]


def confidence_rank(confidence: str) -> int:
    return {"high": 3, "medium": 2, "low": 1}.get(confidence, 0)


def build_hypotheses(points: list[Point], correlations: JsonObject, min_growth_mb: float) -> list[JsonObject]:
    latest = points[-1] if points else None
    first = points[0] if points else None
    if latest is None or first is None:
        return []
    chat_delta = latest.chat_estimated_chars - first.chat_estimated_chars
    heap_delta = latest.renderer_js_heap_mb - first.renderer_js_heap_mb
    browser_live_delta = latest.browser_panel_live_tab_count - first.browser_panel_live_tab_count
    browser_runtime_delta = latest.browser_panel_runtime_count - first.browser_panel_runtime_count
    tab_process_delta = latest.tab_process_count - first.tab_process_count
    generating_delta = latest.generating_message_count - first.generating_message_count
    passive_delta = latest.passive_streaming_message_count - first.passive_streaming_message_count
    latest_streaming = latest.generating_message_count + latest.passive_streaming_message_count

    chat_corr = correlations.get("chatEstimatedPartStringChars")
    heap_corr = correlations.get("rendererJSHeapMB")
    browser_corr = correlations.get("browserPanelRuntimeCount")

    hypotheses = [
        {
            "cause": "renderer_chat_payload",
            "confidence": "high"
            if (chat_delta > 0 and (chat_corr or 0) > 0.5) or latest.chat_estimated_chars > 5_000_000
            else "medium"
            if chat_delta > 0 or latest.chat_estimated_chars > 1_000_000
            else "low",
            "evidence": {
                "chatEstimatedPartStringCharsDelta": chat_delta,
                "tabToChatCorrelation": chat_corr,
                "latestChatEstimatedPartStringChars": latest.chat_estimated_chars,
                "latestChatPartCount": latest.chat_part_count,
                "latestToolPartCount": latest.chat_tool_part_count,
                "topChatSessions": latest.top_chat_sessions,
            },
            "explanation": "Renderer chat store payload is large or growing with Tab working set.",
        },
        {
            "cause": "renderer_js_heap",
            "confidence": "high"
            if heap_delta > min_growth_mb and (heap_corr or 0) > 0.5
            else "medium"
            if heap_delta > 0 or latest.renderer_js_heap_mb > 512
            else "low",
            "evidence": {
                "rendererJSHeapDeltaMB": round2(heap_delta),
                "tabToRendererHeapCorrelation": heap_corr,
                "latestRendererJSHeapMB": latest.renderer_js_heap_mb,
                "rendererWindow": latest.renderer_window,
            },
            "explanation": "Tab working set is moving with renderer JS heap, so retained renderer objects are a likely contributor.",
        },
        {
            "cause": "streaming_lifecycle_retention",
            "confidence": "medium" if latest_streaming > 0 or generating_delta > 0 or passive_delta > 0 else "low",
            "evidence": {
                "generatingMessageDelta": generating_delta,
                "passiveStreamingMessageDelta": passive_delta,
                "latestGeneratingMessageCount": latest.generating_message_count,
                "latestPassiveStreamingMessageCount": latest.passive_streaming_message_count,
                "activeStreamingMessages": latest.active_streaming_messages,
                "replayTopRuns": latest.replay_top_runs,
            },
            "explanation": "Generating/passive streaming messages can retain tool outputs, replay chunks, and display metadata.",
        },
        {
            "cause": "browser_panel_webcontents",
            "confidence": "medium"
            if browser_live_delta > 0
            or browser_runtime_delta > 0
            or latest.browser_panel_live_tab_count > 0
            or latest.browser_panel_runtime_count > 0
            or latest.browser_panel_runtime_detail_count > 0
            else "low",
            "evidence": {
                "browserPanelLiveTabDelta": browser_live_delta,
                "browserPanelRuntimeDelta": browser_runtime_delta,
                "latestBrowserPanelLiveTabCount": latest.browser_panel_live_tab_count,
                "latestBrowserPanelRuntimeCount": latest.browser_panel_runtime_count,
                "latestBrowserPanelRuntimeDetailCount": latest.browser_panel_runtime_detail_count,
                "tabToBrowserPanelRuntimeCorrelation": browser_corr,
            },
            "explanation": "BrowserPanel WebContents can grow Tab working set only when live tabs/runtimes are retained.",
        },
        {
            "cause": "electron_tab_process_count",
            "confidence": "medium" if tab_process_delta > 0 else "low",
            "evidence": {
                "tabProcessDelta": tab_process_delta,
                "latestTabProcessCount": latest.tab_process_count,
                "latestWindowCount": latest.window_count,
                "latestTabProcesses": latest.tab_processes,
            },
            "explanation": "More Chromium Tab processes increase total Tab working set.",
        },
    ]
    return sorted(hypotheses, key=lambda item: confidence_rank(item["confidence"]), reverse=True)


def analyze(rows: list[Any], sample_limit: int, min_growth_mb: float, key_point_limit: int) -> JsonObject:
    extracted = [point for point in (extract_point(row) for row in rows[-sample_limit:]) if point]
    by_sampled_at = {point.sampled_at: point for point in extracted}
    points = sorted(by_sampled_at.values(), key=lambda point: point.sampled_at)
    latest = points[-1] if points else None
    first = points[0] if points else None
    span_ms = latest.sampled_at - first.sampled_at if latest and first else 0
    tab_delta = latest.tab_working_set_mb - first.tab_working_set_mb if latest and first else 0
    correlations = {
        "rendererJSHeapMB": pearson(
            [point.tab_working_set_mb for point in points],
            [point.renderer_js_heap_mb for point in points],
        ),
        "chatEstimatedPartStringChars": pearson(
            [point.tab_working_set_mb for point in points],
            [float(point.chat_estimated_chars) for point in points],
        ),
        "chatPartCount": pearson(
            [point.tab_working_set_mb for point in points],
            [float(point.chat_part_count) for point in points],
        ),
        "browserPanelRuntimeCount": pearson(
            [point.tab_working_set_mb for point in points],
            [float(point.browser_panel_runtime_count) for point in points],
        ),
        "tabProcessCount": pearson(
            [point.tab_working_set_mb for point in points],
            [float(point.tab_process_count) for point in points],
        ),
    }
    slopes = {
        "tabWorkingSetMBPerMinute": slope_per_minute(points, "tab_working_set_mb"),
        "rendererJSHeapMBPerMinute": slope_per_minute(points, "renderer_js_heap_mb"),
        "chatEstimatedCharsPerMinute": slope_per_minute(points, "chat_estimated_chars"),
    }
    change_point = best_change_point(points)
    hypotheses = build_hypotheses(points, correlations, min_growth_mb)
    key_points = build_key_points(points, key_point_limit)
    summary = {
        "sampleCount": len(points),
        "spanMs": span_ms,
        "spanSeconds": round(span_ms / 1000, 1),
        "startedAt": first.sampled_at if first else None,
        "endedAt": latest.sampled_at if latest else None,
        "latestTabWorkingSetMB": latest.tab_working_set_mb if latest else 0,
        "latestTabPeakWorkingSetMB": latest.tab_peak_working_set_mb if latest else 0,
        "tabWorkingSetDeltaMB": round2(tab_delta),
        "growthDetected": tab_delta >= min_growth_mb,
        "primaryCause": hypotheses[0]["cause"] if hypotheses else "insufficient_samples",
        "primaryConfidence": hypotheses[0]["confidence"] if hypotheses else "low",
    }
    model_context = {
        "task": "Explain why Electron Chromium Tab working set is growing.",
        "instructions": [
            "Use runtime snapshot drilldowns as object-level evidence and metrics as trend evidence.",
            "If BrowserPanel live tabs and runtimes are zero, do not blame BrowserPanel WebContents retention.",
            "If renderer JS heap, chat payload, active streaming, or replay evidence move with Tab working set, prioritize chat store payload and streaming lifecycle retention.",
        ],
        "summary": summary,
        "correlations": correlations,
        "slopes": slopes,
        "changePoint": change_point,
        "topHypotheses": hypotheses[:3],
        "keyPoints": key_points,
        "latestEvidence": {
            "topChatSessions": latest.top_chat_sessions if latest else [],
            "activeStreamingMessages": latest.active_streaming_messages if latest else [],
            "replayTopRuns": latest.replay_top_runs if latest else [],
            "tabProcesses": latest.tab_processes if latest else [],
            "rendererWindow": latest.renderer_window if latest else None,
        },
    }
    return {
        "summary": summary,
        "series": [point_to_series(point) for point in points],
        "correlations": correlations,
        "slopes": slopes,
        "changePoint": change_point,
        "keyPoints": key_points,
        "hypotheses": hypotheses,
        "nextActions": [
            "Inspect keyPoints[].topChatSessions for sessions whose estimatedPartStringChars or toolPartCount jumps with Tab working set.",
            "If activeStreamingMessages or replayTopRuns stay non-empty after active runs finish, inspect streaming lifecycle cleanup.",
            "If BrowserPanel live tabs or runtimes become non-zero while Tab working set rises, inspect BrowserPanel WebContents lifecycle.",
        ],
        "modelContext": model_context,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect and model Cradle Tab working set growth.")
    parser.add_argument("--server", default=os.environ.get("CRADLE_SERVER_URL", DEFAULT_SERVER_URL))
    parser.add_argument("--samples", type=int, default=DEFAULT_SAMPLE_COUNT)
    parser.add_argument("--interval-ms", type=int, default=DEFAULT_INTERVAL_MS)
    parser.add_argument("--duration-ms", type=int, default=0)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--from", dest="from_path", type=Path)
    parser.add_argument("--analysis-out", type=Path)
    parser.add_argument("--model-context-out", type=Path)
    parser.add_argument("--markdown-out", type=Path)
    parser.add_argument("--sample-limit", type=int, default=DEFAULT_SAMPLE_LIMIT)
    parser.add_argument("--min-growth-mb", type=float, default=DEFAULT_MIN_GROWTH_MB)
    parser.add_argument("--key-point-limit", type=int, default=DEFAULT_KEY_POINT_LIMIT)
    parser.add_argument("--json", action="store_true")
    return parser.parse_args(argv)


def resolve_options(args: argparse.Namespace) -> argparse.Namespace:
    if args.once:
        args.samples = 1
    elif args.duration_ms > 0:
        args.samples = max(math.ceil(args.duration_ms / args.interval_ms), 1)
    if args.out is None and args.from_path is None:
        args.out = default_capture_path()
    base = args.out or args.from_path
    if args.analysis_out is None and base is not None:
        args.analysis_out = replace_suffix(base, ".analysis.json")
    if args.model_context_out is None and base is not None:
        args.model_context_out = replace_suffix(base, ".model-context.json")
    if args.markdown_out is None and base is not None:
        args.markdown_out = replace_suffix(base, ".summary.md")
    return args


def read_capture(path: Path) -> list[Any]:
    rows: list[Any] = []
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if stripped:
            rows.append(json.loads(stripped))
    return rows


def write_json(path: Path | None, value: Any) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def write_markdown(path: Path | None, analysis: JsonObject) -> None:
    if path is None:
        return
    summary = read_obj(analysis.get("summary"))
    hypotheses = read_list(analysis.get("hypotheses"))
    key_points = read_list(analysis.get("keyPoints"))
    lines = [
        "# Tab Working Set Analysis",
        "",
        f"- Samples: {summary.get('sampleCount')}",
        f"- Span: {summary.get('spanSeconds')}s",
        f"- Latest Tab working set: {summary.get('latestTabWorkingSetMB')} MB",
        f"- Delta: {summary.get('tabWorkingSetDeltaMB')} MB",
        f"- Primary cause: {summary.get('primaryCause')} ({summary.get('primaryConfidence')})",
        "",
        "## Hypotheses",
    ]
    for item in hypotheses[:5]:
        evidence = read_obj(item.get("evidence"))
        lines.append(f"- **{item.get('cause')}** `{item.get('confidence')}`: {item.get('explanation')}")
        if item.get("cause") == "renderer_chat_payload":
            lines.append(
                f"  - chars={evidence.get('latestChatEstimatedPartStringChars')}, parts={evidence.get('latestChatPartCount')}, toolParts={evidence.get('latestToolPartCount')}"
            )
        if item.get("cause") == "browser_panel_webcontents":
            lines.append(
                f"  - liveTabs={evidence.get('latestBrowserPanelLiveTabCount')}, runtimes={evidence.get('latestBrowserPanelRuntimeCount')}"
            )
    lines.extend(["", "## Key Points"])
    for point in key_points:
        lines.append(
            f"- `{point.get('sampledAt')}` tab={point.get('tabWorkingSetMB')}MB delta={point.get('deltaTabWorkingSetMB')}MB heap={point.get('rendererJSHeapMB')}MB chars={point.get('chatEstimatedPartStringChars')}"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n")


def collect(args: argparse.Namespace) -> list[Any]:
    if args.out is None:
        raise RuntimeError("collection requires --out")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    rows: list[Any] = []
    snapshot_url = f"{args.server.rstrip('/')}/observability/runtime-snapshot"
    for index in range(args.samples):
        row = {
            "schema": "cradle.tab-working-set-sample.v1",
            "collectedAt": now_ms(),
            "serverUrl": args.server,
            "snapshot": fetch_json(snapshot_url),
        }
        rows.append(row)
        with args.out.open("a") as file:
            file.write(json.dumps(row, separators=(",", ":")) + "\n")
        current = analyze(rows, args.sample_limit, args.min_growth_mb, args.key_point_limit)
        summary = read_obj(current.get("summary"))
        latest = read_list(current.get("series"))[-1]
        print(
            f"[{index + 1}/{args.samples}] "
            f"tab={summary.get('latestTabWorkingSetMB')}MB "
            f"delta={summary.get('tabWorkingSetDeltaMB')}MB "
            f"heap={latest.get('rendererJSHeapMB')}MB "
            f"chatChars={latest.get('chatEstimatedPartStringChars')} "
            f"browserPanel={latest.get('browserPanelLiveTabCount')}/{latest.get('browserPanelRuntimeCount')} "
            f"cause={summary.get('primaryCause')}:{summary.get('primaryConfidence')}"
        )
        if index < args.samples - 1:
            time.sleep(args.interval_ms / 1000)
    return rows


def main(argv: list[str]) -> int:
    args = resolve_options(parse_args(argv))
    rows = read_capture(args.from_path) if args.from_path else collect(args)
    analysis = analyze(rows, args.sample_limit, args.min_growth_mb, args.key_point_limit)
    write_json(args.analysis_out, analysis)
    write_json(args.model_context_out, analysis.get("modelContext"))
    write_markdown(args.markdown_out, analysis)
    if args.json:
        print(json.dumps(analysis, indent=2, ensure_ascii=False))
    else:
        print(f"analysis={args.analysis_out}")
        print(f"modelContext={args.model_context_out}")
        print(f"summaryMarkdown={args.markdown_out}")
        print(f"summary={json.dumps(analysis.get('summary'), ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
