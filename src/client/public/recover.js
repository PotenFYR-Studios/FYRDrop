// Never leave a blank page: if the bundle fails to load or React never mounts
// (stale asset after an update, blocked script, runtime crash), show a recovery
// card with a cache-busting reload.
//
// This lives in its own file, with handlers attached in code, because the
// Content-Security-Policy (script-src 'self') blocks inline scripts and inline
// onclick attributes.
(function () {
  var done = false;
  window.__fyrdropBooted = function () {
    done = true;
  };

  function button(label, primary, onClick) {
    var b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = primary
      ? "background:#4f46e5;color:#fff;border:0;border-radius:10px;padding:10px 16px;font-size:13px;cursor:pointer"
      : "background:transparent;color:#c7d2fe;border:1px solid #2a3247;border-radius:10px;padding:10px 16px;font-size:13px;cursor:pointer;margin-left:8px";
    b.addEventListener("click", onClick);
    return b;
  }

  function el(tag, css, text) {
    var e = document.createElement(tag);
    e.style.cssText = css;
    if (text) e.textContent = text;
    return e;
  }

  function recovery(detail) {
    if (done) return;
    var root = document.getElementById("root");
    if (!root || root.childElementCount > 0) return;
    var wrap = el("div", "min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px");
    var card = el("div", "max-width:460px;border:1px solid #2a3247;border-radius:16px;background:#0d1119;padding:24px");
    card.appendChild(el("div", "font-size:18px;font-weight:600;color:#fff;margin-bottom:8px", "FYRDrop could not start"));
    card.appendChild(el("div", "font-size:13px;color:#94a3b8;margin-bottom:16px", "The page loaded but the app did not. This is usually a stale file from a recent update."));
    card.appendChild(el("pre", "white-space:pre-wrap;word-break:break-word;font-size:11px;color:#64748b;margin:0 0 16px", String(detail || "no detail")));
    card.appendChild(
      button("Reload", true, function () {
        location.replace(location.pathname + "?reload=" + Date.now());
      }),
    );
    card.appendChild(
      button("Clear cache and reload", false, function () {
        var go = function () {
          location.replace(location.pathname + "?fresh=" + Date.now());
        };
        var jobs = [];
        try {
          if (window.caches) {
            jobs.push(
              caches.keys().then(function (keys) {
                return Promise.all(keys.map(function (k) { return caches.delete(k); }));
              }),
            );
          }
          if (navigator.serviceWorker) {
            jobs.push(
              navigator.serviceWorker.getRegistrations().then(function (regs) {
                return Promise.all(regs.map(function (r) { return r.unregister(); }));
              }),
            );
          }
        } catch (e) {
          /* not available here (for example over plain HTTP) */
        }
        Promise.all(jobs).then(go, go);
      }),
    );
    wrap.appendChild(card);
    root.appendChild(wrap);
  }

  setTimeout(function () {
    recovery("The app did not mount within 5 seconds.");
  }, 5000);
  window.addEventListener(
    "error",
    function (e) {
      if (!done) recovery(e.message || "Script error");
    },
    true,
  );
  window.addEventListener("unhandledrejection", function (e) {
    if (!done) recovery(String((e.reason && e.reason.message) || e.reason));
  });
})();
