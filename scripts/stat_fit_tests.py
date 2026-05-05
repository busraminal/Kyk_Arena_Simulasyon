# -*- coding: utf-8 -*-
"""
Ki-kare ve Kolmogorov-Smirnov uygunluk / bağımsızlık testleri — tam_arena_verisi.xlsx
Çıktı: web/data/stat-fit-tests.json (+ isteğe bağlı .js gömme için node ile birleştirilebilir)
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

ROOT = Path(__file__).resolve().parents[1]
WEB_DATA = ROOT / "web" / "data"
DEFAULT_XLSX = WEB_DATA / "tam_arena_verisi.xlsx"
FALLBACK_XLSX = Path(r"c:\Users\busra\Downloads\tam_arena_verisi.xlsx")


def load_df(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(path)
    return pd.read_excel(path, sheet_name=0)


def chi_square_gof_equal_categories(series: pd.Series, name: str) -> dict:
    """Çok sınıflı gözlenen frekansların 'eşit olasılık' H0'ına uyumu."""
    vc = series.value_counts().sort_index()
    observed = vc.values.astype(float)
    k = len(observed)
    expected = np.full(k, series.notna().sum() / k)
    chi2, p = stats.chisquare(observed, expected)
    return {
        "title": f"Ki-kare uygunluk (eşit dağılım): {name}",
        "variable": name,
        "hypothesis": "H0: Tüm kategoriler eşit olasılıklı.",
        "categories": [str(i) for i in vc.index.tolist()],
        "observed": observed.tolist(),
        "expected_each": float(expected[0]),
        "chi2_statistic": float(chi2),
        "df": int(k - 1),
        "p_value": float(p),
        "reject_H0_alpha005": bool(p < 0.05),
    }


def chi_square_independence(a: pd.Series, b: pd.Series, name_a: str, name_b: str) -> dict:
    tab = pd.crosstab(a, b)
    chi2, p, dof, exp = stats.chi2_contingency(tab)
    observed = tab.values.astype(float)
    return {
        "title": f"Ki-kare bağımsızlık: {name_a} × {name_b}",
        "variables": [name_a, name_b],
        "table_rows_cols": [tab.index.tolist(), tab.columns.tolist()],
        "row_labels": [str(i) for i in tab.index.tolist()],
        "col_labels": [str(j) for j in tab.columns.tolist()],
        "observed_matrix": observed.tolist(),
        "expected_matrix": exp.astype(float).tolist(),
        "chi2_statistic": float(chi2),
        "df": int(dof),
        "p_value": float(p),
        "reject_H0_alpha005": bool(p < 0.05),
        "note": "H0: İki değişken birbirinden bağımsız.",
    }


def _ks_histogram_compare(x: np.ndarray, cdf, *, max_bins: int = 22) -> dict:
    """Histogram gözlenen frekanslar ile fit dağılımdan beklenen frekansları üretir (aynı ölçek)."""
    x = np.asarray(x, dtype=float)
    n = len(x)
    nb = min(max_bins, max(8, int(round(1 + 3.322 * math.log10(max(n, 2))))))
    counts, edges = np.histogram(x, bins=nb)
    expected = []
    for i in range(len(edges) - 1):
        expected.append(float(n * (cdf(edges[i + 1]) - cdf(edges[i]))))
    bin_labels = [f"{edges[i]:.3g}–{edges[i + 1]:.3g}" for i in range(len(edges) - 1)]
    centers = ((edges[:-1] + edges[1:]) / 2).astype(float).tolist()
    return {
        "bin_edges": edges.astype(float).tolist(),
        "bin_centers": centers,
        "bin_labels": bin_labels,
        "observed_counts": counts.astype(int).tolist(),
        "expected_counts": expected,
    }


def ks_exponential(series: pd.Series, name: str) -> dict:
    """Üstel dağılım; parametre veriden tahmin (MO tahmini — KS p değeri iyimser olabilir)."""
    x = np.asarray(series.dropna(), dtype=float)
    x = x[x >= 0]
    if len(x) < 8:
        return {"variable": name, "error": "Yetersiz gözlem"}
    scale = float(np.mean(x))
    D, p = stats.kstest(x, "expon", args=(0.0, scale))
    cdf_fit = lambda t: stats.expon.cdf(np.asarray(t, dtype=float), 0.0, scale)
    out = {
        "title": f"Kolmogorov-Smirnov: {name} ~ Exp(scale={scale:.4g})",
        "variable": name,
        "reference_distribution": "exponential",
        "estimated_scale_mean_minutes": scale,
        "D_statistic": float(D),
        "p_value": float(p),
        "reject_H0_alpha005": bool(p < 0.05),
        "note": "Parametre veriden tahmin edildiği için klasik KS tabloları teorik olarak sıkı değildir; raporda bu sınırlılığı belirtin.",
        "viz": _ks_histogram_compare(x, cdf_fit),
    }
    return out


def ks_normal(series: pd.Series, name: str) -> dict:
    x = np.asarray(series.dropna(), dtype=float)
    if len(x) < 8:
        return {"variable": name, "error": "Yetersiz gözlem"}
    mu, std = stats.norm.fit(x)
    if std < 1e-12:
        return {"variable": name, "error": "Standart sapma sıfıra yakın"}
    D, p = stats.kstest(x, "norm", args=(mu, std))
    cdf_fit = lambda t: stats.norm.cdf(np.asarray(t, dtype=float), mu, std)
    return {
        "title": f"Kolmogorov-Smirnov: {name} ~ Normal(μ={mu:.4g}, σ={std:.4g})",
        "variable": name,
        "reference_distribution": "normal",
        "estimated_mu": float(mu),
        "estimated_sigma": float(std),
        "D_statistic": float(D),
        "p_value": float(p),
        "reject_H0_alpha005": bool(p < 0.05),
        "note": "Normal parametreleri MO ile veriden tahmin edildi.",
        "viz": _ks_histogram_compare(x, cdf_fit),
    }


def main():
    path = DEFAULT_XLSX if DEFAULT_XLSX.exists() else FALLBACK_XLSX
    df = load_df(path)

    out = {
        "meta": {
            "generatedUtc": datetime.now(timezone.utc).isoformat(),
            "excelPath": str(path),
            "n_rows": int(len(df)),
            "tests_note_tr": (
                "Ki-kare: kategorik uygunluk veya çapraz tablo bağımsızlığı. "
                "Kolmogorov-Smirnov: sürekli değişkenin seçilen dağılıma uyumu (D istatistiği ve p). "
                "Parametreleri aynı örnekleştirmeden tahmin etmek KS için iyimser p üretebilir."
            ),
        },
        "chi_square": [],
        "kolmogorov_smirnov": [],
    }

    # Ki-kare — Yemek tercihi eşit dağılım (örnek hipotez)
    out["chi_square"].append(chi_square_gof_equal_categories(df["Yemek_Tercihi"], "Yemek_Tercihi"))

    # Ki-kare — Bağımsızlık Bütçe × Yemek tercihi
    out["chi_square"].append(chi_square_independence(df["Butce"], df["Yemek_Tercihi"], "Butce", "Yemek_Tercihi"))

    # Ki-kare — Sosyal mod × Yemek tercihi
    out["chi_square"].append(chi_square_independence(df["Sosyal_Mod"], df["Yemek_Tercihi"], "Sosyal_Mod", "Yemek_Tercihi"))

    # KS — varış süreleri (dk) üstel uygunluk denemesi
    out["kolmogorov_smirnov"].append(ks_exponential(df["Gelis_Suresi_Dk"], "Gelis_Suresi_Dk"))

    # KS — TC giriş süresi normal uygunluk
    out["kolmogorov_smirnov"].append(ks_normal(df["TC_Giris_Dk"], "TC_Giris_Dk"))

    # KS — yemek yeme süresi normal
    out["kolmogorov_smirnov"].append(ks_normal(df["Yemek_Yeme_Dk"], "Yemek_Yeme_Dk"))

    WEB_DATA.mkdir(parents=True, exist_ok=True)
    json_path = WEB_DATA / "stat-fit-tests.json"
    json_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    js_path = WEB_DATA / "stat-fit-tests.js"
    js_path.write_text(
        "window.__STAT_FIT_TESTS__ = " + json.dumps(out, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )

    print("OK ->", json_path)
    print("OK ->", js_path)


if __name__ == "__main__":
    main()
