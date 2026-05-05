(function () {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const reveals = document.querySelectorAll(".reveal");
  if (!reveals.length || prefersReduced) {
    reveals.forEach((el) => el.classList.add("visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );

  reveals.forEach((el) => observer.observe(el));

  document.addEventListener("stat-fit-ready", function () {
    document.querySelectorAll("#stat-tests-mount .reveal").forEach(function (el) {
      el.classList.add("visible");
    });
  });
})();

(function () {
  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("primary-nav");
  const backdrop = document.getElementById("nav-backdrop");
  if (!toggle || !nav || !backdrop) return;

  const mq = window.matchMedia("(max-width: 819px)");

  function setOpen(open) {
    nav.classList.toggle("is-open", open);
    backdrop.classList.toggle("is-visible", open);
    backdrop.setAttribute("aria-hidden", open ? "false" : "true");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Men\u00fcy\u00fc kapat" : "Men\u00fcy\u00fc a\u00e7");
    document.body.classList.toggle("nav-drawer-open", open);
  }

  toggle.addEventListener("click", function () {
    setOpen(!nav.classList.contains("is-open"));
  });

  backdrop.addEventListener("click", function () {
    setOpen(false);
  });

  nav.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () {
      if (mq.matches) setOpen(false);
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && nav.classList.contains("is-open")) {
      setOpen(false);
      toggle.focus();
    }
  });

  mq.addEventListener("change", function () {
    if (!mq.matches) setOpen(false);
  });
})();
