(function () {
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function authHeaders() {
    var inp = document.getElementById("server-api-token");
    var h = {};
    if (inp && inp.value.trim()) h["X-API-Token"] = inp.value.trim();
    return h;
  }

  function setStatus(el, msg, isErr) {
    if (!el) return;
    el.textContent = msg;
    el.className = "workflow-status-badge" + (isErr ? " workflow-status-badge--err" : "");
  }

  function renderBottleneckMount(report) {
    var pyMount = document.getElementById("advisor-python-report-mount");
    if (!pyMount || !report) return;
    var html = '<div class="advisor-report reveal">';
    html += '<h4 class="advisor-report-title">Sunucudan gelen darbo&#287;az raporu</h4>';
    if (report.summary_lines && report.summary_lines.length) {
      html += '<ul class="advisor-summary">';
      for (var i = 0; i < report.summary_lines.length; i++) {
        html += "<li>" + escapeHtml(report.summary_lines[i]) + "</li>";
      }
      html += "</ul>";
    }
    if (report.recommendations && report.recommendations.length) {
      html += '<ol class="advisor-rec-list">';
      for (var r = 0; r < report.recommendations.length; r++) {
        html += "<li>" + escapeHtml(report.recommendations[r]) + "</li>";
      }
      html += "</ol>";
    }
    html += "</div>";
    pyMount.innerHTML = html;
  }

  function showOutput(pre, data) {
    if (!pre) return;
    var lines = [];
    lines.push("exit_code: " + String(data.exit_code));
    lines.push("--- stdout ---");
    lines.push(data.stdout || "");
    lines.push("--- stderr ---");
    lines.push(data.stderr || "");
    pre.textContent = lines.join("\n");
    pre.hidden = false;
  }

  async function ping(statusEl, runBtn, bottleneckBtn, outBtn) {
    try {
      var res = await fetch("/api/health", { headers: authHeaders() });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var j = await res.json();
      setStatus(statusEl, "Sunucu ba\u011fl\u0131 \u2014 \"Raporu yenile\" kullanabilirsiniz.", false);
      runBtn.disabled = false;
      bottleneckBtn.disabled = false;
      if (outBtn) outBtn.disabled = false;
    } catch (e) {
      setStatus(
        statusEl,
        "Sunucu yok. Terminalde uvicorn ba\u015flat\u0131n ve sayfay\u0131 http://127.0.0.1:8765 ile a\u00e7\u0131n.",
        true
      );
      runBtn.disabled = true;
      bottleneckBtn.disabled = true;
      if (outBtn) outBtn.disabled = true;
    }
  }

  async function postRegenerate(runBtn, pre) {
    var fd = new FormData();
    var excelInp = document.getElementById("server-excel-upload");
    var metricsFile = document.getElementById("advisor-metrics-file");
    var ta = document.getElementById("advisor-metrics-textarea");

    if (excelInp && excelInp.files && excelInp.files[0]) {
      fd.append("excel", excelInp.files[0], excelInp.files[0].name);
    }
    if (metricsFile && metricsFile.files && metricsFile.files[0]) {
      fd.append("metrics_json", metricsFile.files[0], "arena-metrics.json");
    } else if (ta && ta.value.trim()) {
      fd.append(
        "metrics_json",
        new Blob([ta.value], { type: "application/json" }),
        "arena-metrics.json"
      );
    }

    runBtn.disabled = true;
    try {
      var res = await fetch("/api/regenerate", {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      var data = await res.json();
      if (!res.ok) {
        showOutput(pre, {
          exit_code: res.status,
          stdout: "",
          stderr: typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data),
        });
        return;
      }
      showOutput(pre, data);
      if (data.bottleneck_report) renderBottleneckMount(data.bottleneck_report);
      if (data.ok) setTimeout(function () {
        window.location.reload();
      }, 900);
    } catch (e) {
      showOutput(pre, { exit_code: -1, stdout: "", stderr: String(e.message || e) });
    } finally {
      runBtn.disabled = false;
    }
  }

  async function postBottleneck(btn, pre) {
    btn.disabled = true;
    try {
      var res = await fetch("/api/bottleneck-only", {
        method: "POST",
        headers: authHeaders(),
      });
      var data = await res.json();
      if (!res.ok) {
        showOutput(pre, {
          exit_code: res.status,
          stdout: "",
          stderr: typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data),
        });
        return;
      }
      showOutput(pre, data);
      if (data.bottleneck_report) renderBottleneckMount(data.bottleneck_report);
      if (data.ok) setTimeout(function () {
        window.location.reload();
      }, 600);
    } catch (e) {
      showOutput(pre, { exit_code: -1, stdout: "", stderr: String(e.message || e) });
    } finally {
      btn.disabled = false;
    }
  }

  async function postArenaOut(btn, pre) {
    var inp = document.getElementById("arena-out-upload");
    if (!inp || !inp.files || !inp.files[0]) {
      showOutput(pre, { exit_code: -1, stdout: "", stderr: "Lutfen bir .out dosyasi secin." });
      return;
    }
    var fd = new FormData();
    fd.append("arena_out", inp.files[0], inp.files[0].name || "arena.out");
    btn.disabled = true;
    try {
      var res = await fetch("/api/arena-out", {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      var data = await res.json();
      if (!res.ok) {
        showOutput(pre, {
          exit_code: res.status,
          stdout: "",
          stderr: typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data),
        });
        return;
      }
      showOutput(pre, data);
      if (data.bottleneck_report) renderBottleneckMount(data.bottleneck_report);
      if (data.ok) {
        setTimeout(function () {
          window.location.reload();
        }, 650);
      }
    } catch (e) {
      showOutput(pre, { exit_code: -1, stdout: "", stderr: String(e.message || e) });
    } finally {
      btn.disabled = false;
    }
  }

  function init() {
    var statusEl = document.getElementById("server-runner-status");
    var runBtn = document.getElementById("server-run-regenerate");
    var bottleneckBtn = document.getElementById("server-run-bottleneck");
    var outBtn = document.getElementById("server-run-arena-out");
    var pre = document.getElementById("server-run-output");
    if (!statusEl || !runBtn || !bottleneckBtn || !pre) return;

    ping(statusEl, runBtn, bottleneckBtn, outBtn);

    var retryBtn = document.getElementById("server-api-token-retry");
    if (retryBtn) {
      retryBtn.addEventListener("click", function () {
        ping(statusEl, runBtn, bottleneckBtn, outBtn);
      });
    }

    runBtn.addEventListener("click", function () {
      postRegenerate(runBtn, pre);
    });
    bottleneckBtn.addEventListener("click", function () {
      postBottleneck(bottleneckBtn, pre);
    });
    if (outBtn) {
      outBtn.addEventListener("click", function () {
        postArenaOut(outBtn, pre);
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
