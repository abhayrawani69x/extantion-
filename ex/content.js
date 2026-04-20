// ============================================================
// content.js — runs on every page, handles grid detection,
// clicking items, finding video/thumbnail URLs on detail pages,
// and signaling the background script to download them.
// ============================================================

(function () {
  "use strict";

  // Avoid double-injection
  if (window.__gridDownloaderInjected) return;
  window.__gridDownloaderInjected = true;

  // ---------- helpers ----------

  function waitForEl(selector, timeout) {
    timeout = timeout || 10000;
    return new Promise(function (resolve, reject) {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const observer = new MutationObserver(function () {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(function () {
        observer.disconnect();
        reject(new Error("Timeout waiting for " + selector));
      }, timeout);
    });
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function randomBetween(a, b) {
    return Math.floor(Math.random() * (b - a + 1)) + a;
  }

  // Simulate a realistic mouse move then click on an element
  function humanClick(el) {
    return new Promise(function (resolve) {
      const rect = el.getBoundingClientRect();
      const x = rect.left + randomBetween(10, Math.max(11, rect.width - 10));
      const y = rect.top + randomBetween(10, Math.max(11, rect.height - 10));

      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y }));
      el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX: x, clientY: y }));
      return sleep(randomBetween(80, 250)).then(function () {
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: x, clientY: y, button: 0 }));
        return sleep(randomBetween(40, 120));
      }).then(function () {
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y, button: 0 }));
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y, button: 0 }));
        return sleep(randomBetween(100, 300));
      }).then(resolve);
    });
  }

  // ---------- video / thumbnail detection ----------

  // Strategy 1: look for <video> elements
  function findVideoFromTag() {
    const videos = document.querySelectorAll("video");
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      // src attribute
      if (v.src && v.src.startsWith("http")) return v.src;
      // <source> children
      const sources = v.querySelectorAll("source");
      for (let j = 0; j < sources.length; j++) {
        if (sources[j].src && sources[j].src.startsWith("http")) return sources[j].src;
      }
      // Maybe the src is relative — resolve it
      if (v.src && v.src.length > 1) {
        try { return new URL(v.src, location.href).href; } catch (e) { /* skip */ }
      }
    }
    return null;
  }

  // Strategy 2: intercept network requests that look like video
  // We set up a listener BEFORE navigating to the detail page
  let capturedVideoUrl = null;
  let captureListenerActive = false;

  function startCapturingNetwork() {
    capturedVideoUrl = null;
    captureListenerActive = true;
    // Monkey-patch XMLHttpRequest
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      if (captureListenerActive && typeof url === "string" && isVideoUrl(url)) {
        capturedVideoUrl = url;
      }
      return origOpen.apply(this, arguments);
    };
    // Monkey-patch fetch
    const origFetch = window.fetch;
    window.fetch = function (input) {
      if (captureListenerActive) {
        let url = "";
        if (typeof input === "string") url = input;
        else if (input && input.url) url = input.url;
        if (isVideoUrl(url)) capturedVideoUrl = url;
      }
      return origFetch.apply(this, arguments);
    };
  }

  function stopCapturingNetwork() {
    captureListenerActive = false;
  }

  function isVideoUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    const exts = [".mp4", ".m3u8", ".ts", ".webm", ".mkv", ".avi", ".mov", ".flv"];
    for (let i = 0; i < exts.length; i++) {
      if (lower.indexOf(exts[i]) !== -1) return true;
    }
    // Common CDN patterns
    if (lower.indexOf("/video/") !== -1) return true;
    if (lower.indexOf("/play/") !== -1) return true;
    if (lower.indexOf("videoplayback") !== -1) return true;
    if (lower.indexOf(".m3u8") !== -1) return true;
    return false;
  }

  // Strategy 3: scan all <a> tags for download links
  function findVideoFromLinks() {
    const links = document.querySelectorAll("a[href]");
    for (let i = 0; i < links.length; i++) {
      const href = links[i].href;
      if (isVideoUrl(href)) return href;
    }
    return null;
  }

  // Strategy 4: try to find video URL in page scripts / JSON
  function findVideoFromPageSource() {
    const scripts = document.querySelectorAll("script");
    for (let i = 0; i < scripts.length; i++) {
      const text = scripts[i].textContent;
      if (!text) continue;
      // Look for common patterns
      const patterns = [
        /["'](?:videoUrl|video_url|videoSrc|video_src|src|url|file|source)["']\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8|webm)[^"']*)["']/gi,
        /["'](https?:\/\/[^"']*\.mp4[^"']*)["']/gi,
        /["'](https?:\/\/[^"']*\/videoplayback[^"']*)["']/gi,
        /["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/gi
      ];
      for (let p = 0; p < patterns.length; p++) {
        const match = patterns[p].exec(text);
        if (match && match[1]) return match[1];
      }
    }
    return null;
  }

  // Find thumbnail
  function findThumbnail() {
    // 1. Open Graph
    let og = document.querySelector('meta[property="og:image"]');
    if (og && og.content) return og.content;

    // 2. Twitter card
    let tw = document.querySelector('meta[name="twitter:image"]');
    if (tw && tw.content) return tw.content;

    // 3. Largest image that looks like a thumbnail (near the video player)
    const imgs = document.querySelectorAll("img");
    let best = null;
    let bestArea = 0;
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      if (!img.src || img.src.startsWith("data:")) continue;
      if (img.naturalWidth < 200) continue; // skip tiny icons
      // Prefer images with "thumb", "poster", "cover", "preview" in src/class
      const lower = (img.src + " " + (img.className || "")).toLowerCase();
      const bonus = (lower.indexOf("thumb") !== -1 || lower.indexOf("poster") !== -1 ||
                     lower.indexOf("cover") !== -1 || lower.indexOf("preview") !== -1) ? 2 : 1;
      const area = img.naturalWidth * img.naturalHeight * bonus;
      if (area > bestArea) {
        bestArea = area;
        best = img.src;
      }
    }
    if (best) return best;

    // 4. video poster attribute
    const video = document.querySelector("video");
    if (video && video.poster) return video.poster;

    return null;
  }

  // Combined video finder — tries all strategies
  function findVideoUrl() {
    // Priority: captured network > video tag > links > page source
    let url = capturedVideoUrl;
    if (url) return url;
    url = findVideoFromTag();
    if (url) return url;
    url = findVideoFromLinks();
    if (url) return url;
    url = findVideoFromPageSource();
    return url;
  }

  // ---------- grid detection ----------

  function detectGridItems() {
    // Try multiple selectors for grid items
    const selectors = [
      // Generic grid children
      ".grid > a",
      ".grid > div > a",
      ".grid > div",
      // Common class names
      ".video-item",
      ".video-item a",
      ".video-card",
      ".video-card a",
      ".thumb-item",
      ".thumb-item a",
      ".card-item",
      ".card-item a",
      // List items
      ".video-list > li",
      ".video-list > li > a",
      // UL/LI grids
      "ul.grid > li",
      "ul.grid > li > a",
      // Generic: any container with display:grid children
      // (fallback below)
    ];

    for (let i = 0; i < selectors.length; i++) {
      const items = document.querySelectorAll(selectors[i]);
      if (items.length >= 4) {
        // Filter: only return items that have a link or are clickable
        const clickable = [];
        items.forEach(function (item) {
          if (item.tagName === "A" || item.querySelector("a") ||
              item.onclick || item.style.cursor === "pointer") {
            clickable.push(item);
          }
        });
        if (clickable.length >= 4) return clickable;
      }
    }

    // Fallback: find elements with display:grid and grab direct children
    const allEls = document.querySelectorAll("*");
    for (let i = 0; i < allEls.length; i++) {
      const style = getComputedStyle(allEls[i]);
      if (style.display === "grid" || style.display === "inline-grid") {
        const children = allEls[i].children;
        if (children.length >= 4 && children.length <= 100) {
          const clickable = [];
          for (let j = 0; j < children.length; j++) {
            const child = children[j];
            if (child.tagName === "A" || child.querySelector("a") ||
                child.onclick || getComputedStyle(child).cursor === "pointer") {
              clickable.push(child);
            }
          }
          if (clickable.length >= 4) return clickable;
        }
      }
    }

    return [];
  }

  // ---------- next page detection ----------

  function findNextPageButton() {
    const selectors = [
      "a.next",
      "a[rel='next']",
      ".pagination .next",
      ".pagination .next a",
      ".pager .next",
      ".pager .next a",
      "li.next a",
      "button.next",
      "a:contains('Next')",
      "a:contains('next')",
      "a:contains('>")",
      "a:contains('»')",
      ".page-next",
      "#next-page",
      "a.page-next",
    ];
    for (let i = 0; i < selectors.length; i++) {
      try {
        const el = document.querySelector(selectors[i]);
        if (el) return el;
      } catch (e) { /* invalid selector, skip */ }
    }
    // Text-based search
    const links = document.querySelectorAll("a, button");
    for (let i = 0; i < links.length; i++) {
      const text = (links[i].textContent || "").trim().toLowerCase();
      if (text === "next" || text === "next »" || text === "»" || text === ">" || text === "next page") {
        return links[i];
      }
    }
    return null;
  }

  // ---------- message handler ----------

  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.type === "DETECT_GRID") {
      const items = detectGridItems();
      sendResponse({ count: items.length });
      return false;
    }

    if (request.type === "START_AUTOMATION") {
      runAutomation(request.config);
      sendResponse({ started: true });
      return false;
    }

    if (request.type === "STOP_AUTOMATION") {
      window.__gridAutoStopped = true;
      sendResponse({ stopped: true });
      return false;
    }

    if (request.type === "GET_STATUS") {
      sendResponse({
        status: window.__gridAutoStatus || "idle",
        current: window.__gridAutoCurrent || 0,
        total: window.__gridAutoTotal || 0,
        currentPage: window.__gridAutoPage || 1
      });
      return false;
    }
  });

  // ---------- main automation loop ----------

  async function runAutomation(config) {
    window.__gridAutoStopped = false;
    const delayBetween = (config.delayBetween || 2) * 1000;
    const delayAfterBack = (config.delayAfterBack || 1.5) * 1000;
    const maxPages = config.maxPages || 10;

    for (let page = 1; page <= maxPages; page++) {
      if (window.__gridAutoStopped) break;

      updateStatus("scanning", 0, 0, page);

      // Wait for grid to appear
      await sleep(1500);

      let items = detectGridItems();
      if (items.length === 0) {
        updateStatus("error", 0, 0, page, "No grid items found on page " + page);
        break;
      }

      updateStatus("processing", 0, items.length, page);

      for (let idx = 0; idx < items.length; idx++) {
        if (window.__gridAutoStopped) break;

        updateStatus("processing", idx + 1, items.length, page);

        // Re-query items each time (DOM may have changed after back navigation)
        const freshItems = detectGridItems();
        if (idx >= freshItems.length) break;
        const item = freshItems[idx];

        // Start network capture BEFORE clicking
        startCapturingNetwork();

        // Click the item
        try {
          await humanClick(item);
        } catch (e) {
          stopCapturingNetwork();
          continue;
        }

        // Wait for detail page to load
        await sleep(randomBetween(2000, 4000));

        // Try to find video + thumbnail
        let videoUrl = findVideoUrl();
        let thumbUrl = findThumbnail();

        // If no video found yet, wait a bit more (lazy loading)
        if (!videoUrl) {
          await sleep(3000);
          videoUrl = findVideoUrl();
        }

        // Also try waiting for a <video> element to appear
        if (!videoUrl) {
          try {
            await waitForEl("video", 8000);
            videoUrl = findVideoUrl();
          } catch (e) { /* no video element appeared */ }
        }

        stopCapturingNetwork();

        // Send download request to background
        const globalIndex = ((page - 1) * 24) + idx + 1;
        if (videoUrl || thumbUrl) {
          chrome.runtime.sendMessage({
            type: "DOWNLOAD_FROM_DETAIL",
            videoUrl: videoUrl || null,
            thumbUrl: thumbUrl || null,
            folderName: "video" + globalIndex,
            pageTitle: document.title || ("Video " + globalIndex)
          });
        }

        // Small delay to let download start
        await sleep(1000);

        // Go back to grid
        history.back();

        // Wait for grid page to load
        await sleep(delayAfterBack);
        // Extra wait for dynamic content
        await sleep(randomBetween(500, 1500));
      }

      if (window.__gridAutoStopped) break;

      // Try to go to next page
      updateStatus("paging", items.length, items.length, page);

      const nextBtn = findNextPageButton();
      if (!nextBtn) {
        updateStatus("done", items.length, items.length, page, "No next page button found");
        break;
      }

      await humanClick(nextBtn);
      await sleep(randomBetween(2000, 4000));

      // Check if we actually navigated (URL changed or content changed)
      await sleep(1000);
    }

    if (!window.__gridAutoStopped) {
      updateStatus("done", 0, 0, 0, "Automation complete");
    } else {
      updateStatus("stopped", 0, 0, 0, "Stopped by user");
    }
  }

  function updateStatus(status, current, total, page, message) {
    window.__gridAutoStatus = status;
    window.__gridAutoCurrent = current;
    window.__gridAutoTotal = total;
    window.__gridAutoPage = page;
    chrome.runtime.sendMessage({
      type: "STATUS_UPDATE",
      status: status,
      current: current,
      total: total,
      currentPage: page,
      message: message || ""
    }).catch(function () { /* side panel may be closed */ });
  }

})();
