(function () {
  var COLORS = {
    primary: "rgba(94, 234, 212, 0.85)",
    secondary: "rgba(251, 191, 119, 0.92)",
    tertiary: "rgba(147, 197, 253, 0.8)",
    quat: "rgba(167, 139, 250, 0.78)",
    muted: "rgba(139, 149, 171, 0.75)",
    grid: "rgba(255, 255, 255, 0.06)",
    text: "#c9d1e0",
    lineFit: "rgba(251, 191, 119, 1)",
  };

  var MULTI = [COLORS.primary, COLORS.secondary, COLORS.tertiary, COLORS.quat, COLORS.muted];

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtP(p) {
    if (p === 0 || (p > 0 && p < 1e-6)) return p.toExponential(3);
    return Number(p).toFixed(4);
  }

  function verdictHtml(reject) {
    if (reject) {
      return '<span class="stat-fit-verdict stat-fit-verdict--reject">\u03b1 = 0,05: H\u2080 reddedilir</span>';
    }
    return '<span class="stat-fit-verdict stat-fit-verdict--retain">\u03b1 = 0,05: H\u2080 reddedilmez</span>';
  }

  function fmtNum(x) {
    if (typeof x !== "number" || Number.isNaN(x)) return escapeHtml(String(x));
    var a = Math.abs(x);
    if (a >= 1000 || (a > 0 && a < 1e-4)) return x.toExponential(3);
    return x.toFixed(4).replace(/\.?0+$/, "");
  }

  function hiDpiRatio() {
    if (typeof window === "undefined") return 1;
    var dpr = window.devicePixelRatio;
    if (!dpr || dpr < 1) return 1;
    return Math.min(dpr, 3);
  }

  /** Ortak Chart.js ayarı: Retina / yüksek DPI için keskin çizim. */
  function responsiveChartOpts(extra) {
    var base = {
      responsive: true,
      maintainAspectRatio: false,
      devicePixelRatio: hiDpiRatio(),
      animation: false,
    };
    if (!extra) return base;
    var out = {};
    var k;
    for (k in base) out[k] = base[k];
    for (k in extra) out[k] = extra[k];
    return out;
  }

  function resizeAllStatCharts() {
    document.querySelectorAll("#stat-tests-mount canvas").forEach(function (canvas) {
      var ch = typeof Chart !== "undefined" ? Chart.getChart(canvas) : null;
      if (ch) ch.resize();
    });
  }

  function chartWrap(canvasId) {
    return (
      '<div class="stat-fit-chart-wrap"><canvas id="' +
      escapeHtml(canvasId) +
      '" aria-hidden="true"></canvas></div>'
    );
  }

  function chiCard(t, idx) {
    var canvasId = "stat-chi-chart-" + idx;
    var showGofChart = t.categories && t.observed != null;
    var showCrossChart = t.observed_matrix && t.row_labels && t.col_labels;
    var chartHtml = showGofChart || showCrossChart ? chartWrap(canvasId) : "";

    var body = "";
    if (t.categories && t.observed != null) {
      body +=
        '<table class="stat-fit-table"><thead><tr><th>Kategori</th><th>G\u00f6zlenen</th><th>Beklenen</th></tr></thead><tbody>';
      for (var i = 0; i < t.categories.length; i++) {
        var exp = t.expected_each != null ? t.expected_each : "\u2014";
        body +=
          "<tr><td>" +
          escapeHtml(String(t.categories[i])) +
          "</td><td>" +
          escapeHtml(String(t.observed[i])) +
          "</td><td>" +
          escapeHtml(String(exp)) +
          "</td></tr>";
      }
      body += "</tbody></table>";
      if (t.hypothesis) {
        body += '<p class="stat-fit-hyp">' + escapeHtml(t.hypothesis) + "</p>";
      }
    } else {
      if (t.note) body += '<p class="stat-fit-hyp">' + escapeHtml(t.note) + "</p>";
      if (t.variables && t.variables.length) {
        body +=
          '<p class="stat-fit-hyp mono">' +
          escapeHtml(t.variables.join(" \u00d7 ")) +
          "</p>";
      }
      if (t.observed_matrix && t.row_labels && t.col_labels) {
        body += '<table class="stat-fit-table stat-fit-table--matrix"><thead><tr><th></th>';
        for (var c = 0; c < t.col_labels.length; c++) {
          body += "<th>" + escapeHtml(String(t.col_labels[c])) + "</th>";
        }
        body += "</tr></thead><tbody>";
        for (var r = 0; r < t.row_labels.length; r++) {
          body += "<tr><th>" + escapeHtml(String(t.row_labels[r])) + "</th>";
          for (c = 0; c < t.col_labels.length; c++) {
            var cell = t.observed_matrix[r] && t.observed_matrix[r][c] !== undefined ? t.observed_matrix[r][c] : "";
            body += "<td>" + escapeHtml(String(cell)) + "</td>";
          }
          body += "</tr>";
        }
        body += "</tbody></table>";
      }
    }
    body +=
      '<dl class="stat-fit-dl">' +
      "<dt>\u03c7\u00b2</dt><dd>" +
      fmtNum(t.chi2_statistic) +
      "</dd>" +
      "<dt>sd</dt><dd>" +
      escapeHtml(String(t.df)) +
      "</dd>" +
      "<dt>p</dt><dd>" +
      fmtP(t.p_value) +
      "</dd>" +
      "</dl>" +
      verdictHtml(t.reject_H0_alpha005);

    return (
      '<article class="stat-fit-card reveal">' +
      '<h4 class="stat-fit-card-title">' +
      escapeHtml(t.title) +
      "</h4>" +
      chartHtml +
      body +
      "</article>"
    );
  }

  function ksCard(t, idx) {
    var canvasId = "stat-ks-chart-" + idx;
    if (t.error) {
      return (
        '<article class="stat-fit-card reveal">' +
        '<h4 class="stat-fit-card-title">' +
        escapeHtml(t.variable || "KS") +
        "</h4>" +
        '<p class="stat-fit-hyp">' +
        escapeHtml(t.error) +
        "</p></article>"
      );
    }

    var params = "";
    if (t.reference_distribution === "exponential" && t.estimated_scale_mean_minutes != null) {
      params =
        "Exp(\u03bb\u207b\u00b9 = " + fmtNum(t.estimated_scale_mean_minutes) + " dk)";
    } else if (t.reference_distribution === "normal") {
      params =
        "Normal(\u03bc = " +
        fmtNum(t.estimated_mu) +
        ", \u03c3 = " +
        fmtNum(t.estimated_sigma) +
        ")";
    }
    var chartHtml = t.viz && t.viz.observed_counts ? chartWrap(canvasId) : "";

    var body =
      '<p class="stat-fit-hyp"><strong>' +
      escapeHtml(t.variable) +
      "</strong> ~ " +
      escapeHtml(params || t.reference_distribution) +
      "</p>";
    body +=
      '<dl class="stat-fit-dl">' +
      "<dt>D</dt><dd>" +
      fmtNum(t.D_statistic) +
      "</dd>" +
      "<dt>p</dt><dd>" +
      fmtP(t.p_value) +
      "</dd>" +
      "</dl>" +
      verdictHtml(t.reject_H0_alpha005);
    if (t.note) {
      body += '<p class="stat-fit-note">' + escapeHtml(t.note) + "</p>";
    }
    return (
      '<article class="stat-fit-card reveal">' +
      '<h4 class="stat-fit-card-title">' +
      escapeHtml(t.title) +
      "</h4>" +
      chartHtml +
      body +
      "</article>"
    );
  }

  function applyChartDefaults() {
    if (typeof Chart === "undefined") return false;
    Chart.defaults.color = COLORS.text;
    Chart.defaults.borderColor = COLORS.grid;
    Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.plugins.legend.labels.padding = 12;
    Chart.defaults.plugins.legend.labels.font = { size: 11 };
    Chart.defaults.plugins.tooltip.backgroundColor = "#141a27";
    Chart.defaults.plugins.tooltip.borderColor = "rgba(94, 234, 212, 0.35)";
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleFont = { size: 12 };
    Chart.defaults.plugins.tooltip.bodyFont = { size: 11 };
    Chart.defaults.scale.grid.color = COLORS.grid;
    Chart.defaults.scale.ticks.font = { size: 11 };
    return true;
  }

  function renderChiCharts(data) {
    if (!applyChartDefaults()) return;
    (data.chi_square || []).forEach(function (t, idx) {
      var canvas = document.getElementById("stat-chi-chart-" + idx);
      if (!canvas) return;

      if (t.categories && t.observed != null && t.expected_each != null) {
        var expected = t.categories.map(function () {
          return t.expected_each;
        });
        new Chart(canvas, {
          type: "bar",
          data: {
            labels: t.categories.map(function (c) {
              return String(c);
            }),
            datasets: [
              {
                label: "G\u00f6zlenen",
                data: t.observed,
                backgroundColor: COLORS.primary,
              },
              {
                label: "Beklenen (e\u015fit)",
                data: expected,
                backgroundColor: COLORS.secondary,
              },
            ],
          },
          options: responsiveChartOpts({
            plugins: {
              legend: { position: "bottom" },
              title: { display: false },
            },
            scales: {
              y: { beginAtZero: true },
            },
          }),
        });
        return;
      }

      if (t.observed_matrix && t.row_labels && t.col_labels) {
        var datasets = t.col_labels.map(function (col, j) {
          return {
            label: String(col),
            data: t.observed_matrix.map(function (row) {
              return row[j];
            }),
            backgroundColor: MULTI[j % MULTI.length],
          };
        });
        new Chart(canvas, {
          type: "bar",
          data: {
            labels: t.row_labels.map(function (r) {
              return String(r);
            }),
            datasets: datasets,
          },
          options: responsiveChartOpts({
            plugins: {
              legend: { position: "bottom" },
            },
            scales: {
              x: {},
              y: { beginAtZero: true },
            },
          }),
        });
      }
    });
  }

  function renderKsCharts(data) {
    if (!applyChartDefaults()) return;
    (data.kolmogorov_smirnov || []).forEach(function (t, idx) {
      if (t.error || !t.viz || !t.viz.observed_counts) return;
      var canvas = document.getElementById("stat-ks-chart-" + idx);
      if (!canvas) return;
      var labels = t.viz.bin_labels || t.viz.bin_centers.map(function (x) {
        return String(x);
      });
      new Chart(canvas, {
        data: {
          labels: labels,
          datasets: [
            {
              type: "bar",
              label: "G\u00f6zlenen frekans",
              data: t.viz.observed_counts,
              backgroundColor: COLORS.primary,
              borderWidth: 0,
              order: 2,
            },
            {
              type: "line",
              label: "Beklenen (fit)",
              data: t.viz.expected_counts,
              borderColor: COLORS.lineFit,
              backgroundColor: "transparent",
              tension: 0.25,
              borderWidth: Math.max(2, Math.round(hiDpiRatio())),
              borderJoinStyle: "round",
              spanGaps: false,
              pointRadius: 0,
              order: 1,
            },
          ],
        },
        options: responsiveChartOpts({
          plugins: {
            legend: { position: "bottom" },
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: "Frekans",
                font: { size: 12 },
              },
            },
            x: {
              ticks: {
                maxRotation: 45,
                minRotation: 0,
                autoSkip: true,
                maxTicksLimit: 12,
              },
            },
          },
        }),
      });
    });
  }

  function renderStatCharts(data) {
    renderChiCharts(data);
    renderKsCharts(data);
  }

  var mount = document.getElementById("stat-tests-mount");
  var data = window.__STAT_FIT_TESTS__;
  if (!mount) return;

  if (!data || !data.meta) {
    mount.innerHTML =
      '<p class="charts-error">Uygunluk testleri verisi y&#252;klenemedi. &#214;nce <code>python scripts/regenerate_web_reports.py</code> veya <code>scripts/stat_fit_tests.py</code> &#231;al&#305;&#351;t&#305;r&#305;n.</p>';
    return;
  }

  var html = "";
  html +=
    '<div class="stat-fit-meta reveal"><p>' +
    escapeHtml(data.meta.tests_note_tr) +
    "</p>" +
    '<p class="mono-hint"><strong>n</strong> = ' +
    escapeHtml(String(data.meta.n_rows)) +
    " &middot; " +
    escapeHtml(data.meta.generatedUtc) +
    "</p></div>";

  html +=
    '<div class="stat-fit-pdf-note reveal">' +
    '<p class="stat-fit-chart-note">' +
    "<strong>Grafikler:</strong> ki-kare i&#231;in g&#246;zlenen / beklenen ve &#231;apraz tablo; KS i&#231;in histogram &#252;zerinde fit ile beklenen frekans." +
    "</p>" +
    '<p class="stat-fit-chart-note stat-fit-chart-note--sub">' +
    "<strong>Sunum yorum &#231;izgisi (PDF):</strong> &#945; = 0,05 i&#231;in karttaki sonu&#231; reddedilmezse H&#8320; ile uyumlu kabul edilir " +
    "(&#246;rn. geli&#351; s&#252;releri &#252;stel da&#287;&#305;l&#305;ma uygun — g&#246;zlenen ile beklenen aras&#305;nda anlaml&#305; fark yoktur). " +
    "KS&#8217;de parametreler veriden tahmin edildi&#287;inde klasik tablo <em>p</em> de&#287;eri iyimser olabilir; raporda belirtin." +
    "</p>" +
    "</div>";

  html += '<div class="stat-fit-columns">';
  html +=
    '<div class="stat-fit-col">' +
    '<h3 class="stat-fit-col-head reveal">Ki-kare</h3>' +
    '<div class="stat-fit-stack">';
  for (var ci = 0; ci < (data.chi_square || []).length; ci++) {
    html += chiCard(data.chi_square[ci], ci);
  }
  html += "</div></div>";

  html +=
    '<div class="stat-fit-col">' +
    '<h3 class="stat-fit-col-head reveal">Kolmogorov&#8211;Smirnov</h3>' +
    '<div class="stat-fit-stack">';
  for (var ki = 0; ki < (data.kolmogorov_smirnov || []).length; ki++) {
    html += ksCard(data.kolmogorov_smirnov[ki], ki);
  }
  html += "</div></div>";
  html += "</div>";

  mount.innerHTML = html;

  renderStatCharts(data);

  document.dispatchEvent(new CustomEvent("stat-fit-ready"));

  requestAnimationFrame(function () {
    resizeAllStatCharts();
    requestAnimationFrame(resizeAllStatCharts);
  });
  setTimeout(resizeAllStatCharts, 120);
  setTimeout(resizeAllStatCharts, 720);

  var statFitResizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(statFitResizeTimer);
    statFitResizeTimer = setTimeout(resizeAllStatCharts, 120);
  });
})();
