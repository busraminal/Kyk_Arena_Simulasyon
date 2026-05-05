# -*- coding: utf-8 -*-
"""
Arena özeti (arena-metrics.json) ve isteğe bağlı uygunluk testleri çıktısına göre
darboğaz adaylarını işaretler ve Türkçe iyileştirme önerileri üretir.

Çıktı: web/data/bottleneck-report.json ve bottleneck-report.js
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
WEB_DATA = ROOT / "web" / "data"


def _pct(u: float) -> str:
    return f"{100.0 * float(u):.1f}"


def _sunum_hint_queue(label: str) -> str:
    """Arena Modülleriyle Yemekhane Simülasyonu PDF'i ile öneri sonuna bağlam ekler."""
    s = (label or "").lower()
    checks: list[tuple[tuple[str, ...], str]] = [
        (
            ("kasa", "odeme", "ödeme", "payment", "tahsil"),
            "Sunum eşlemesi: ödeme (kasa) kritik darboğaz — ikinci kasiyer veya paralel ödeme noktası.",
        ),
        (
            ("et_hatti", "et hatt", "sicak", "sıcak"),
            "Sunum eşlemesi: sıcak yemek hattı — servis personeli / mutfak hızı, PickStation dengelemesi.",
        ),
        (
            ("sebze",),
            "Sunum eşlemesi: sıcak yemek hatları — kapasite ve personel planı.",
        ),
        (
            ("kantin",),
            "Sunum eşlemesi: kantin hattı — orta düzey talepte personel / kapasite artışı.",
        ),
        (
            ("tost", "kahve", "icecek", "içecek"),
            "Sunum eşlemesi: kantin/yan kol (sandviç, içecek) — süre veya kapasite.",
        ),
        (
            ("parmak", "tc_", "kimlik", "finger"),
            "Sunum eşlemesi: parmak izi (~%15 başarısızlık) — ek okuyucu ve Decide dallarının doğrulanması.",
        ),
        (
            ("ekmek", "stok", "takviye", "hold"),
            "Sunum eşlemesi: lojistik / stok — Hold–Signal ile takviye ve süre parametreleri.",
        ),
        (
            ("sandalye", "masa", "oturma", "turnike"),
            "Sunum eşlemesi: oturma kapasitesi (örn. 2000 vs 5000 talep) — masa–sandalye ve alan senaryosu.",
        ),
    ]
    for keys, msg in checks:
        if any(k in s for k in keys):
            return " " + msg
    return ""


def _sunum_hint_resource(key: str, label: str) -> str:
    s = f"{key} {label}".lower()
    checks: list[tuple[tuple[str, ...], str]] = [
        (
            ("kasa", "odeme", "ödeme", "payment"),
            "Sunum eşlemesi: ödeme kritik darboğaz — paralel kasa.",
        ),
        (
            ("et_", "servis", "mutfak"),
            "Sunum eşlemesi: sıcak yemek tarafı — personel ve süre iyileştirmesi.",
        ),
        (
            ("kantin",),
            "Sunum eşlemesi: kantin personeli / kapasite.",
        ),
        (
            ("parmak", "tc", "kimlik"),
            "Sunum eşlemesi: kimlik doğrulama — ek cihaz veya Decide oranları.",
        ),
        (
            ("sandalye", "masa",),
            "Sunum eşlemesi: fiziksel oturma kapasitesi.",
        ),
    ]
    for keys, msg in checks:
        if any(k in s for k in keys):
            return " " + msg
    return ""


def analyze(
    metrics: dict[str, Any],
    stat_tests: dict[str, Any] | None = None,
) -> dict[str, Any]:
    bottlenecks: list[dict[str, Any]] = []
    recommendations: list[str] = []
    summary_lines: list[str] = []

    U_WARN = 0.65
    U_HIGH = 0.80
    Q_AVG_WARN = 3.0
    Q_AVG_HIGH = 8.0
    WAIT_H_WARN = 0.01  # saat (~36 sn)

    res_util = metrics.get("resourceUtilization") or []
    by_key = {str(r.get("key", "")): r for r in res_util}

    for r in res_util:
        key = str(r.get("key", r.get("label", "?")))
        label = str(r.get("label", key))
        u = r.get("utilization")
        if u is None or not isinstance(u, (int, float)):
            continue
        if u >= U_HIGH:
            bottlenecks.append(
                {"type": "resource_util_critical", "key": key, "label": label, "utilization": float(u)}
            )
            recommendations.append(
                f"{label} (`{key}`) doluluğu %{_pct(u)} — darboğaz riski yüksek: "
                "paralel kaynak (ikinci hat/personel), süre kısaltma veya talep yayma düşünün."
                + _sunum_hint_resource(key, label)
            )
        elif u >= U_WARN:
            bottlenecks.append(
                {"type": "resource_util_watch", "key": key, "label": label, "utilization": float(u)}
            )
            recommendations.append(
                f"{label} doluluğu %{_pct(u)} — izlenmeli; yoğun saatte üst seviyeye çıkabilir."
                + _sunum_hint_resource(key, label)
            )

    # Et / Sebze personeli düşük kullanım ama hat kuyruğu yüksek → yapılandırma uyarısı
    et_q = next((q for q in (metrics.get("queueLengthAvg") or []) if "Et" in str(q.get("label", ""))), None)
    seb_q = next((q for q in (metrics.get("queueLengthAvg") or []) if "Sebze" in str(q.get("label", ""))), None)
    et_u = (by_key.get("Et_Servis_Personeli") or {}).get("utilization")
    sz_u = (by_key.get("Sebze_Servis_Personeli") or {}).get("utilization")

    et_staff_mismatch = False
    if et_q and isinstance(et_q.get("avg"), (int, float)) and et_q["avg"] >= Q_AVG_WARN:
        if et_u is not None and isinstance(et_u, (int, float)) and et_u < 0.05:
            recommendations.append(
                "Et hattı ortalama kuyruk uzunluğu görece yüksekken et servis personeli doluluğu çok düşük — "
                "Arena’da kaynak–Process bağlantısı, Set/kuyruk adları veya koşullu Seize mantığını kontrol edin."
                + _sunum_hint_queue("Et_Hatti")
            )
            bottlenecks.append({"type": "staff_queue_mismatch", "lane": "Et_Hatti", "queue_avg": float(et_q["avg"])})
            et_staff_mismatch = True
    seb_staff_mismatch = False
    if seb_q and isinstance(seb_q.get("avg"), (int, float)) and seb_q["avg"] >= Q_AVG_WARN:
        if sz_u is not None and isinstance(sz_u, (int, float)) and sz_u < 0.05:
            recommendations.append(
                "Sebze hattı kuyruğu ile personel doluluğu uyumsuz görünüyor — şema ve Spreadsheet Seize adlarını doğrulayın."
                + _sunum_hint_queue("Sebze_Hatti")
            )
            bottlenecks.append({"type": "staff_queue_mismatch", "lane": "Sebze_Hatti", "queue_avg": float(seb_q["avg"])})
            seb_staff_mismatch = True

    for q in metrics.get("queueLengthAvg") or []:
        lab = str(q.get("label", ""))
        avg = q.get("avg")
        if not isinstance(avg, (int, float)):
            continue
        if avg >= Q_AVG_HIGH:
            if et_staff_mismatch and lab == "Et_Hatti":
                continue
            if seb_staff_mismatch and lab == "Sebze_Hatti":
                continue
            bottlenecks.append({"type": "queue_avg_high", "queue": lab, "avg": float(avg)})
            recommendations.append(
                f"`{lab}` ortalama kuyruk {_fmt_float(avg)} — kapasite artışı, "
                "PickStation dengelemesi veya giriş Hold eşiği (NQ) senaryosu deneyin."
                + _sunum_hint_queue(lab)
            )
    for q in metrics.get("queueWaitingAvgHours") or []:
        lab = str(q.get("label", ""))
        h = q.get("hours")
        if not isinstance(h, (int, float)) or h < WAIT_H_WARN:
            continue
        bottlenecks.append({"type": "queue_wait_hours", "queue": lab, "hours": float(h)})
        recommendations.append(
            f"`{lab}` ortalama bekleme ~{_fmt_float(float(h) * 60)} dk — süreç süresi veya kaynak sayısını gözden geçirin."
            + _sunum_hint_queue(lab)
        )

    thr = metrics.get("throughput") or {}
    nin = thr.get("entityNumberIn")
    nout = thr.get("entityNumberOut")
    if isinstance(nin, (int, float)) and isinstance(nout, (int, float)) and nin > 0:
        ratio = float(nout) / float(nin)
        if ratio < 0.5:
            recommendations.append(
                f"Çıkış / giriş oranı düşük (~{_fmt_float(ratio)}) — çalışma süresi, Dispose dalları veya "
                "Search–Remove terkleri nedeniyle işler tamamlanmıyor olabilir."
                " Sunum bağlamı: pik talep ile sınırlı oturma/kapasite uyumsuzluğu tamamlanmayı geciktirebilir."
            )
            bottlenecks.append({"type": "throughput_gap", "ratio": ratio})

    wip = metrics.get("wip") or {}
    wmax = wip.get("maximum")
    if isinstance(wmax, (int, float)) and wmax >= 80:
        recommendations.append(
            f"Sistem içi WIP maksimum {_fmt_float(float(wmax))} — giriş Create veya kapasite Hold’ları ile üst sınır senaryoları test edin."
        )

    if stat_tests:
        chi_rej = sum(1 for t in stat_tests.get("chi_square") or [] if t.get("reject_H0_alpha005"))
        ks_rej = sum(1 for t in stat_tests.get("kolmogorov_smirnov") or [] if t.get("reject_H0_alpha005"))
        if chi_rej + ks_rej > 0:
            recommendations.append(
                f"Uygunluk testlerinde {chi_rej} ki-kare ve {ks_rej} KS reddi — "
                "Excel’deki dağılım varsayımları ile Arena’daki Random modüllerini hizalayın; reddedilen H0 güven aralıklarını etkiler."
                " Sunum (PDF): reddedilen H₀ ile gözlenen ve beklenen uyumsuz; geliş süreleri için üstel uygunluk iddiasını gözden geçirin."
            )
            summary_lines.append(f"İstatistik uyarısı: ki-kare reddi={chi_rej}, KS reddi={ks_rej}.")

    if not summary_lines:
        if bottlenecks:
            summary_lines.append(f"{len(bottlenecks)} darboğaz sinyali üretildi; öneriler aşağıda.")
        else:
            summary_lines.append(
                "Özet metriklerde ağır bir darboğaz sinyali çıkmadı; yoğun senaryo ve çoklu replikasyonla doğrulayın."
            )

    return {
        "meta": {
            "generatedUtc": datetime.now(timezone.utc).isoformat(),
            "metricsNote": "Kaynak: arena-metrics.json (Arena Summary özeti).",
        },
        "bottlenecks": bottlenecks,
        "recommendations": recommendations,
        "summary_lines": summary_lines,
    }


def _fmt_float(x: float) -> str:
    ax = abs(x)
    if ax >= 1000 or (ax > 0 and ax < 1e-4):
        return f"{x:.4g}"
    return f"{x:.4f}".rstrip("0").rstrip(".")


def load_optional_stat_tests() -> dict[str, Any] | None:
    p = WEB_DATA / "stat-fit-tests.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else __import__("sys").argv[1:]
    WEB_DATA.mkdir(parents=True, exist_ok=True)

    metrics_path = WEB_DATA / "arena-metrics.json"
    if argv:
        metrics_path = Path(argv[0]).expanduser()

    if not metrics_path.exists():
        print(f"[bottleneck_advisor] Bulunamadı: {metrics_path}", file=__import__("sys").stderr)
        return 1

    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    stat_tests = load_optional_stat_tests()
    report = analyze(metrics, stat_tests)

    json_path = WEB_DATA / "bottleneck-report.json"
    js_path = WEB_DATA / "bottleneck-report.js"

    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    js_path.write_text(
        "window.__BOTTLENECK_REPORT__ = " + json.dumps(report, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print("OK ->", json_path)
    print("OK ->", js_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
