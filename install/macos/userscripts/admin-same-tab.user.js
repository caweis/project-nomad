// ==UserScript==
// @name         NOMAD admin — same-tab navigation
// @namespace    https://github.com/caweis/project-nomad-macos-arm64
// @version      1.0.0
// @description  Strip target="_blank" from Project NOMAD admin's service-card links so clicks open in the SAME tab. Upstream uses target="_blank" on every service tile; the result is a graveyard of open tabs after a 5-minute browsing session. This script intercepts that.
// @author       caweis
// @match        http://localhost:8080/*
// @match        http://nomad.local:8080/*
// @match        http://*.local:8080/*
// @match        http://192.168.*:8080/*
// @match        http://10.*:8080/*
// @match        http://172.16.*:8080/*
// @match        http://172.17.*:8080/*
// @match        http://172.18.*:8080/*
// @match        http://172.19.*:8080/*
// @match        http://172.20.*:8080/*
// @match        http://172.21.*:8080/*
// @match        http://172.22.*:8080/*
// @match        http://172.23.*:8080/*
// @match        http://172.24.*:8080/*
// @match        http://172.25.*:8080/*
// @match        http://172.26.*:8080/*
// @match        http://172.27.*:8080/*
// @match        http://172.28.*:8080/*
// @match        http://172.29.*:8080/*
// @match        http://172.30.*:8080/*
// @match        http://172.31.*:8080/*
// @run-at       document-start
// @grant        none
// @homepageURL  https://github.com/caweis/project-nomad-macos-arm64/blob/main/install/macos/userscripts/admin-same-tab.user.js
// @supportURL   https://github.com/Crosstalk-Solutions/project-nomad/issues/866
// ==/UserScript==

(function () {
  'use strict';

  // Strip target + rel from any anchor we've never touched. Idempotent — the
  // data-nomad-untabbed marker tells us not to revisit a node we already cleaned.
  const untab = (a) => {
    if (!a || a.dataset.nomadUntabbed === '1') return;
    if (a.getAttribute('target') === '_blank') {
      a.removeAttribute('target');
      // rel="noopener noreferrer" is the partner of target=_blank; harmless to
      // leave, but removing makes the diff visible to anyone inspecting later.
      const rel = a.getAttribute('rel') || '';
      const cleaned = rel.split(/\s+/).filter(t => t && t !== 'noopener' && t !== 'noreferrer').join(' ');
      if (cleaned) a.setAttribute('rel', cleaned);
      else a.removeAttribute('rel');
    }
    a.dataset.nomadUntabbed = '1';
  };

  const scanAll = (root) => {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('a[target="_blank"]').forEach(untab);
  };

  // 1. Pass over whatever's already in the DOM on script-start.
  scanAll(document);

  // 2. Watch for added/changed anchors. Project NOMAD admin is an Inertia/React
  // SPA — every navigation re-renders chunks of the page, so a one-shot pass
  // would miss tiles that mount after our script ran.
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;          // skip text nodes
          if (n.tagName === 'A') untab(n);
          else scanAll(n);
        });
      } else if (m.type === 'attributes' && m.target.tagName === 'A') {
        // Catches the case where React re-renders an existing <a> and sets
        // target="_blank" again on a node we already cleaned.
        if (m.target.dataset.nomadUntabbed === '1') {
          m.target.removeAttribute('data-nomad-untabbed');
        }
        untab(m.target);
      }
    }
  });

  const startObserving = () => observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['target', 'rel'],
  });

  if (document.documentElement) startObserving();
  else document.addEventListener('DOMContentLoaded', startObserving, { once: true });

  // 3. Safety net: intercept click on an `<a target="_blank">` we somehow
  // missed (e.g., rendered between the MutationObserver firing and the user's
  // click). Cancel the default open-in-new-tab; navigate the current window
  // instead.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[target="_blank"]');
    if (!a) return;
    if (!a.href) return;
    e.preventDefault();
    untab(a);
    // Modifier keys still mean "yes I want a new tab" — honor the browser default.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
      window.open(a.href, '_blank', 'noopener');
    } else {
      window.location.href = a.href;
    }
  }, true);

})();
