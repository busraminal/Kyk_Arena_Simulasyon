(function () {
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pct(u) {
    return (100 * Number(u)).toFixed(1);
  }

  /** Arena Modülleriyle Yemekhane Simülasyonu PDF ile öneri bağlamı. */
  function sunumHintQueue(label) {
    var s = String(label || "").toLowerCase();
    var rows = [
      [["kasa", "odeme", "payment", "tahsil"], "Sunum eşlemesi: ödeme (kasa) kritik darboğaz — ikinci kasiyer veya paralel ödeme."],
      [["et_hatti", "et hatt", "sicak", "sıcak"], "Sunum eşlemesi: sıcak yemek hattı — personel/mutfak hızı, PickStation dengelemesi."],
      [["sebze"], "Sunum eşlemesi: sıcak yemek hatları — kapasite ve personel planı."],
      [["kantin"], "Sunum eşlemesi: kantin — orta talepte personel/kapasite."],
      [["tost", "kahve", "içecek", "icecek"], "Sunum eşlemesi: kantin/yan kol — süre veya kapasite."],
      [["parmak", "tc_", "kimlik", "finger"], "Sunum eşlemesi: parmak izi (~%15 başarısızlık) — ek okuyucu ve Decide doğrulaması."],
      [["ekmek", "stok", "takviye", "bekleme"], "Sunum eşlemesi: lojistik/stok — Hold–Signal ve takviye süreleri."],
      [["sandalye", "masa", "oturma", "turnike"], "Sunum eşlemesi: oturma (örn. 2000 vs 5000 talep) — masa–sandalye senaryosu."],
    ];
    for (var ri = 0; ri < rows.length; ri++) {
      var keys = rows[ri][0];
      for (var kj = 0; kj < keys.length; kj++) {
        if (s.indexOf(keys[kj]) >= 0) return " " + rows[ri][1];
      }
    }
    return "";
  }

  function sunumHintResource(key, label) {
    var s = (String(key || "") + " " + String(label || "")).toLowerCase();
    var rows = [
      [["kasa", "odeme", "payment"], "Sunum eşlemesi: ödeme kritik darboğaz — paralel kasa."],
      [["et_", "servis", "mutfak"], "Sunum eşlemesi: sıcak yemek tarafı — personel ve süre iyileştirmesi."],
      [["kantin"], "Sunum eşlemesi: kantin personeli/kapasite."],
      [["parmak", "tc", "kimlik"], "Sunum eşlemesi: kimlik doğrulama — ek cihaz veya Decide oranları."],
      [["sandalye", "masa"], "Sunum eşlemesi: fiziksel oturma kapasitesi."],
    ];
    for (var ri = 0; ri < rows.length; ri++) {
      var keys = rows[ri][0];
      for (var kj = 0; kj < keys.length; kj++) {
        if (s.indexOf(keys[kj]) >= 0) return " " + rows[ri][1];
      }
    }
    return "";
  }

  /** Tarayıcıda Python ile aynı eşikler (özet). */
  function analyzeMetrics(m) {
    var recommendations = [];
    var bottlenecks = [];
    var summary_lines = [];

    var U_WARN = 0.65;
    var U_HIGH = 0.8;
    var Q_AVG_HIGH = 8;
    var WAIT_H_WARN = 0.01;

    var resUtil = (m.resourceUtilization || []).slice();
    var byKey = {};
    for (var i = 0; i < resUtil.length; i++) {
      var r = resUtil[i];
      byKey[String(r.key || "")] = r;
      var u = r.utilization;
      if (typeof u !== "number" || isNaN(u)) continue;
      var label = String(r.label || r.key || "?");
      var key = String(r.key || "");
      if (u >= U_HIGH) {
        bottlenecks.push({ type: "resource_util_critical", key: key, utilization: u });
        recommendations.push(
          label +
            " (`" +
            key +
            "`) doluluğu %" +
            pct(u) +
            " — darboğaz riski yüksek; paralel kaynak veya süre iyileştirmesi düşünün." +
            sunumHintResource(key, label)
        );
      } else if (u >= U_WARN) {
        bottlenecks.push({ type: "resource_util_watch", key: key, utilization: u });
        recommendations.push(label + " doluluğu %" + pct(u) + " — izlenmeli." + sunumHintResource(key, label));
      }
    }

    var queues = m.queueLengthAvg || [];
    var etU2 = (byKey["Et_Servis_Personeli"] || {}).utilization;
    var szU2 = (byKey["Sebze_Servis_Personeli"] || {}).utilization;
    var etStaffMismatch = false;
    var sebStaffMismatch = false;
    for (var mi = 0; mi < queues.length; mi++) {
      var mq = queues[mi];
      var mlab = String(mq.label || "");
      var mav = mq.avg;
      if (typeof mav !== "number" || mav < 3) continue;
      if (mlab.indexOf("Et") >= 0 && typeof etU2 === "number" && etU2 < 0.05) etStaffMismatch = true;
      if (mlab.indexOf("Sebze") >= 0 && typeof szU2 === "number" && szU2 < 0.05) sebStaffMismatch = true;
    }
    if (etStaffMismatch) {
      recommendations.push(
        "Et hattı kuyruğu ile et personeli doluluğu uyumsuz — Seize/kaynak adlarını doğrulayın." +
          sunumHintQueue("Et_Hatti")
      );
      bottlenecks.push({ type: "staff_queue_mismatch", lane: "Et_Hatti" });
    }
    if (sebStaffMismatch) {
      recommendations.push(
        "Sebze hattı kuyruğu ile sebze personeli doluluğu uyumsuz — şema kontrolü önerilir." +
          sunumHintQueue("Sebze_Hatti")
      );
      bottlenecks.push({ type: "staff_queue_mismatch", lane: "Sebze_Hatti" });
    }

    for (var qi = 0; qi < queues.length; qi++) {
      var q = queues[qi];
      var avg = q.avg;
      var lab = String(q.label || "");
      if (typeof avg !== "number" || isNaN(avg)) continue;
      if (avg >= Q_AVG_HIGH) {
        if (etStaffMismatch && lab === "Et_Hatti") continue;
        if (sebStaffMismatch && lab === "Sebze_Hatti") continue;
        bottlenecks.push({ type: "queue_avg_high", queue: lab, avg: avg });
        recommendations.push(
          "`" +
            lab +
            "` ortalama kuyruk " +
            avg.toFixed(2) +
            " — kapasite veya PickStation dengelemesi deneyin." +
            sunumHintQueue(lab)
        );
      }
    }

    var waitRows = m.queueWaitingAvgHours || [];
    for (var wi = 0; wi < waitRows.length; wi++) {
      var w = waitRows[wi];
      var h = w.hours;
      if (typeof h !== "number" || h < WAIT_H_WARN) continue;
      bottlenecks.push({ type: "queue_wait_hours", queue: String(w.label || ""), hours: h });
      recommendations.push(
        "`" +
          String(w.label || "") +
          "` ortalama bekleme ~" +
          (h * 60).toFixed(2) +
          " dk." +
          sunumHintQueue(String(w.label || ""))
      );
    }

    var thr = m.throughput || {};
    var nin = thr.entityNumberIn;
    var nout = thr.entityNumberOut;
    if (typeof nin === "number" && nin > 0 && typeof nout === "number") {
      var ratio = nout / nin;
      if (ratio < 0.5) {
        bottlenecks.push({ type: "throughput_gap", ratio: ratio });
        recommendations.push(
          "Çıkış/giriş oranı düşük (~" +
            ratio.toFixed(2) +
            ") — Dispose ve çalışma süresini kontrol edin." +
            " Sunum bağlamı: pik talep ile sınırlı oturma/kapasite uyumsuzluğu tamamlanmayı geciktirebilir."
        );
      }
    }

    var st = window.__STAT_FIT_TESTS__;
    if (st && st.chi_square && st.kolmogorov_smirnov) {
      var cr = 0,
        kr = 0;
      for (var ci = 0; ci < st.chi_square.length; ci++) if (st.chi_square[ci].reject_H0_alpha005) cr++;
      for (var ki = 0; ki < st.kolmogorov_smirnov.length; ki++)
        if (st.kolmogorov_smirnov[ki].reject_H0_alpha005) kr++;
      if (cr + kr > 0) {
        recommendations.push(
          "Yüklenen test özeti: ki-kare reddi=" +
            cr +
            ", KS reddi=" +
            kr +
            " — Excel ile Arena dağılımlarını hizalayın." +
            " Sunum (PDF): reddedilen H₀ ile gözlenen/beklenen uyumsuz; geliş süreleri için üstel uygunluğu gözden geçirin."
        );
      }
    }

    if (summary_lines.length === 0) {
      summary_lines.push(
        bottlenecks.length
          ? bottlenecks.length + " sinyal; öneriler aşağıda."
          : "Belirgin darboğaz sinyali yok (eşik altı); yoğun senaryoda tekrarlayın."
      );
    }

    return {
      meta: { source: "browser-heuristic", note: "Tam rapor için terminalde python scripts/bottleneck_advisor.py" },
      bottlenecks: bottlenecks,
      recommendations: recommendations,
      summary_lines: summary_lines,
    };
  }

  function renderAdvisorBlock(title, report) {
    var html = '<div class="advisor-report reveal">';
    html += '<h4 class="advisor-report-title">' + escapeHtml(title) + "</h4>";
    if (report.meta && report.meta.generatedUtc) {
      html +=
        '<p class="advisor-report-meta mono">' + escapeHtml(report.meta.generatedUtc) + "</p>";
    }
    if (report.summary_lines && report.summary_lines.length) {
      html += "<ul class=\"advisor-summary\">";
      for (var s = 0; s < report.summary_lines.length; s++) {
        html += "<li>" + escapeHtml(report.summary_lines[s]) + "</li>";
      }
      html += "</ul>";
    }
    if (report.recommendations && report.recommendations.length) {
      html += "<ol class=\"advisor-rec-list\">";
      for (var r = 0; r < report.recommendations.length; r++) {
        html += "<li>" + escapeHtml(report.recommendations[r]) + "</li>";
      }
      html += "</ol>";
    } else {
      html += "<p class=\"advisor-empty\">Öneri listesi boş.</p>";
    }
    html += "</div>";
    return html;
  }

  function setFeedback(el, msg, isErr) {
    if (!el) return;
    el.className = "advisor-feedback" + (isErr ? " advisor-feedback--err" : "");
    el.innerHTML = "<p>" + escapeHtml(msg) + "</p>";
  }

  function init() {
    var ta = document.getElementById("advisor-metrics-textarea");
    var fileInput = document.getElementById("advisor-metrics-file");
    var fb = document.getElementById("advisor-live-feedback");
    var browserMount = document.getElementById("advisor-browser-report-mount");
    var pyMount = document.getElementById("advisor-python-report-mount");
    if (!ta || !browserMount || !pyMount) return;

    if (window.__BOTTLENECK_REPORT__) {
      pyMount.innerHTML = renderAdvisorBlock("Son Python raporu (web/data/bottleneck-report.json)", window.__BOTTLENECK_REPORT__);
    } else {
      pyMount.innerHTML =
        '<p class="advisor-placeholder">Python raporu yok. Proje kökünde <code class="mono-inline">python scripts/regenerate_web_reports.py</code> veya <code class="mono-inline">python scripts/bottleneck_advisor.py</code> çalıştırın.</p>';
    }

    var validateBtn = document.getElementById("advisor-validate-json");
    if (validateBtn) {
      validateBtn.addEventListener("click", function () {
        try {
          JSON.parse(ta.value.trim() || "{}");
          setFeedback(fb, "JSON sözdizimi geçerli.", false);
        } catch (e) {
          setFeedback(fb, "JSON hatası: " + String(e.message), true);
        }
      });
    }

    var analyzeBtn = document.getElementById("advisor-analyze-browser");
    if (analyzeBtn) {
      analyzeBtn.addEventListener("click", function () {
        var raw = ta.value.trim();
        if (!raw) {
          setFeedback(fb, "\u00d6nce JSON yap\u0131\u015ft\u0131r\u0131n veya dosya se\u00e7in.", true);
          return;
        }
        try {
          var m = JSON.parse(raw);
          var rep = analyzeMetrics(m);
          browserMount.innerHTML = renderAdvisorBlock("Taray\u0131c\u0131 \u00f6nizlemesi", rep);
          setFeedback(fb, "\u00dcstten \"Raporu yenile\" ile kesin sonu\u00e7 al\u0131n.", false);
        } catch (e) {
          setFeedback(fb, "\u00c7\u00f6z\u00fcmlenemedi: " + String(e.message), true);
        }
      });
    }

    document.getElementById("advisor-load-current-metrics").addEventListener("click", function () {
      if (!window.__ARENA_METRICS__) {
        setFeedback(fb, "Sayfada arena-metrics.js yok veya boş.", true);
        return;
      }
      ta.value = JSON.stringify(window.__ARENA_METRICS__, null, 2);
      setFeedback(fb, "Gömülü arena-metrics yüklendi.", false);
    });

    if (fileInput) {
      fileInput.addEventListener("change", function () {
        var f = fileInput.files && fileInput.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          ta.value = String(reader.result || "");
          setFeedback(fb, "Dosya textarea’ya yazıldı: " + f.name, false);
          fileInput.value = "";
        };
        reader.readAsText(f, "UTF-8");
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
