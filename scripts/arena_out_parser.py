from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
WEB_DATA = ROOT / "web" / "data"


def _norm_label(text: str) -> str:
    cleaned = text.replace("Ý", "İ").replace("ý", "ı").strip()
    return unicodedata.normalize("NFKC", cleaned)


def _slug(text: str) -> str:
    txt = _norm_label(text)
    txt = "".join(ch if ch.isalnum() else "_" for ch in txt)
    txt = re.sub(r"_+", "_", txt).strip("_")
    return txt


def _parse_num(token: str) -> float | None:
    token = token.strip()
    if not token or token == "--":
        return None
    try:
        return float(token)
    except ValueError:
        return None


def parse_out_text(text: str) -> dict[str, Any]:
    lines = text.splitlines()
    run_hours = 0.0
    base_units = "Hours"
    license_name = ""
    replications = 1

    for ln in lines:
        m = re.search(r"Replication ended at time\s*:\s*([0-9.]+)\s+(\w+)", ln)
        if m:
            run_hours = float(m.group(1))
            if m.group(2).lower().startswith("hour"):
                run_hours = float(m.group(1))
            elif m.group(2).lower().startswith("min"):
                run_hours = float(m.group(1)) / 60.0
        m = re.search(r"Base Time Units:\s*(\w+)", ln)
        if m:
            base_units = m.group(1)
        m = re.search(r"License:\s*(.+)$", ln)
        if m:
            license_name = m.group(1).strip()
        m = re.search(r"Replication\s+\d+\s+of\s+(\d+)", ln)
        if m:
            replications = int(m.group(1))

    in_discrete = False
    in_outputs = False

    resource_utilization: list[dict[str, Any]] = []
    queue_waiting: list[dict[str, Any]] = []
    queue_length: list[dict[str, Any]] = []
    number_seized: list[dict[str, Any]] = []
    resources: list[str] = []

    throughput_in = None
    throughput_out = None
    system_out = None
    wip_avg = None
    wip_max = None
    wip_final = None
    total_time_hours = None
    wait_time_hours = None

    for ln in lines:
        if "DISCRETE-CHANGE VARIABLES" in ln:
            in_discrete = True
            in_outputs = False
            continue
        if "OUTPUTS" in ln:
            in_outputs = True
            in_discrete = False
            continue
        if "TALLY VARIABLES" in ln:
            in_outputs = False
            in_discrete = False
            continue

        if ".Queue.WaitingTime" in ln:
            parts = re.split(r"\s{2,}", ln.strip())
            if len(parts) >= 2:
                label = parts[0].replace(".Queue.WaitingTime", "")
                avg = _parse_num(parts[1])
                obs = int(float(parts[-1])) if parts[-1].replace(".", "", 1).isdigit() else 0
                if avg is not None:
                    queue_waiting.append(
                        {"label": _norm_label(label), "hours": float(avg), "observations": obs}
                    )

        if in_discrete and ".Queue.NumberInQueue" in ln:
            parts = re.split(r"\s{2,}", ln.strip())
            if len(parts) >= 2:
                label = parts[0].replace(".Queue.NumberInQueue", "")
                avg = _parse_num(parts[1])
                if avg is not None:
                    queue_length.append({"label": _norm_label(label), "avg": float(avg)})

        if in_discrete and ".Utilization" in ln and "ScheduledUtilization" not in ln:
            parts = re.split(r"\s{2,}", ln.strip())
            if len(parts) >= 2:
                label = parts[0].replace(".Utilization", "")
                avg = _parse_num(parts[1])
                if avg is not None:
                    resources.append(_norm_label(label))
                    resource_utilization.append(
                        {
                            "key": _slug(label),
                            "label": _norm_label(label),
                            "utilization": float(avg),
                        }
                    )

        if in_discrete and ln.strip().startswith("Entity 1.WIP"):
            parts = re.split(r"\s{2,}", ln.strip())
            if len(parts) >= 6:
                wip_avg = _parse_num(parts[1])
                wip_max = _parse_num(parts[4])
                wip_final = _parse_num(parts[5])

        if ln.strip().startswith("Entity 1.TotalTime"):
            parts = re.split(r"\s{2,}", ln.strip())
            if len(parts) >= 2:
                total_time_hours = _parse_num(parts[1])

        if ln.strip().startswith("Entity 1.WaitTime"):
            parts = re.split(r"\s{2,}", ln.strip())
            if len(parts) >= 2:
                wait_time_hours = _parse_num(parts[1])

        if in_outputs:
            parts = re.split(r"\s{2,}", ln.strip())
            if len(parts) >= 2:
                ident = parts[0]
                val = _parse_num(parts[1])
                if val is None:
                    continue
                if ident == "Entity 1.NumberIn":
                    throughput_in = val
                elif ident == "Entity 1.NumberOut":
                    throughput_out = val
                elif ident == "System.NumberOut":
                    system_out = val
                elif ident.endswith(".NumberSeized"):
                    label = ident.replace(".NumberSeized", "")
                    number_seized.append({"label": _norm_label(label), "value": val})

    in_system = None
    if throughput_in is not None and throughput_out is not None:
        in_system = throughput_in - throughput_out

    return {
        "meta": {
            "title": "KYK Yemekhane Simulasyonu",
            "sourceNote": "Arena Summary (.out) otomatik parse edildi",
            "replicationLengthHours": run_hours,
            "baseTimeUnits": base_units,
            "replications": replications,
            "license": license_name,
        },
        "resources": resources,
        "throughput": {
            "entityNumberIn": int(throughput_in or 0),
            "entityNumberOut": int(throughput_out or 0),
            "systemNumberOut": int(system_out or 0),
            "inSystemEstimate": int(in_system or 0),
        },
        "wip": {
            "average": float(wip_avg or 0.0),
            "maximum": float(wip_max or 0.0),
            "final": float(wip_final or 0.0),
        },
        "tally": {
            "entityAvgHours": {
                "waitTime": float(wait_time_hours or 0.0),
                "totalTime": float(total_time_hours or 0.0),
            }
        },
        "resourceUtilization": resource_utilization,
        "numberSeized": number_seized,
        "queueWaitingAvgHours": queue_waiting,
        "queueLengthAvg": queue_length,
    }


def parse_out_file(path: Path) -> dict[str, Any]:
    return parse_out_text(path.read_text(encoding="utf-8", errors="replace"))


def write_metrics_files(metrics: dict[str, Any]) -> None:
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    json_path = WEB_DATA / "arena-metrics.json"
    js_path = WEB_DATA / "arena-metrics.js"
    json_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    js_path.write_text(
        "window.__ARENA_METRICS__ = " + json.dumps(metrics, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python scripts/arena_out_parser.py <arena.out>")
        raise SystemExit(1)
    metrics_obj = parse_out_file(Path(sys.argv[1]))
    write_metrics_files(metrics_obj)
    print("OK -> web/data/arena-metrics.json")
