// ============================================================
// sidepanel.js — controls for the automation UI
// ============================================================

(function () {
  "use strict";

  // Elements
  var delayRange = document.getElementById("delayRange");
  var delayVal = document.getElementById("delayVal");
  var backDelayRange = document.getElementById("backDelayRange");
  var backDelayVal = document.getElementById("backDelayVal");
  var maxPagesRange = document.getElementById("maxPagesRange");
  var maxPagesVal = document.getElementById("maxPagesVal");
  var btnDetect = document.getElementById("btnDetect");
  var btnStart = document.getElementById("btnStart");
  var btnStop = document.getElementById("btnStop");
  var statusState = document.getElementById("statusState");
  var statusProgress = document.getElementById("statusProgress");
  var statusPage = document.getElementById("statusPage");
  var statusMessage = document.getElementById("statusMessage");
  var progressBar = document.getElementById("progressBar");
  var logArea = document.getElementById("logArea");

  var gridCount = 0;
  var isRunning = false;

  // Slider updates
  delayRange.addEventListener("input", function () {
    delayVal.textContent = parseFloat(this.value).toFixed(1) + "s";
  });
  backDelayRange.addEventListener("input", function () {
    backDelayVal.textContent = parseFloat(this.value).toFixed(1) + "s";
  });
  maxPagesRange.addEventListener("input", function () {
    maxPagesVal.textContent = this.value;
  });

  // Detect grid
  btnDetect.addEventListener("click", function () {
    btnDetect.disabled = true;
    btnDetect.textContent = "Scanning...";
    addLog("Scanning page for grid items...", "info");

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) {
        btnDetect.disabled = false;
        btnDetect.textContent = "Find Grid Items";
        addLog("No active tab found", "err");
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: "DETECT_GRID" }, function (response) {
        btnDetect.disabled = false;
        btnDetect.textContent = "Find Grid Items";
        if (chrome.runtime.lastError || !response) {
          addLog("Error: " + (chrome.runtime.lastError ? chrome.runtime.lastError.message : "No response"), "err");
          gridCount = 0;
          btnStart.disabled = true;
          return;
        }
        gridCount = response.count;
        if (gridCount > 0) {
          addLog("Found " + gridCount + " grid items!", "ok");
          btnStart.disabled = false;
          statusState.textContent = "Ready";
          statusProgress.textContent = "0 / " + gridCount;
        } else {
          addLog("No grid items found. Make sure you're on the grid page.", "warn");
          btnStart.disabled = true;
          statusState.textContent = "No grid found";
        }
      });
    });
  });

  // Start automation
  btnStart.addEventListener("click", function () {
    if (gridCount === 0) return;
    isRunning = true;
    btnStart.classList.add("hidden");
    btnStop.classList.remove("hidden");
    btnDetect.disabled = true;
    logArea.innerHTML = "";
    addLog("Starting automation for " + gridCount + " items...", "ok");

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "START_AUTOMATION",
        config: {
          delayBetween: parseFloat(delayRange.value),
          delayAfterBack: parseFloat(backDelayRange.value),
          maxPages: parseInt(maxPagesRange.value, 10)
        }
      });
    });
  });

  // Stop automation
  btnStop.addEventListener("click", function () {
    isRunning = false;
    btnStop.classList.add("hidden");
    btnStart.classList.remove("hidden");
    btnStart.disabled = true;
    btnDetect.disabled = false;
    addLog("Sending stop signal...", "warn");

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: "STOP_AUTOMATION" });
    });
  });

  // Listen for status updates from content script
  chrome.runtime.onMessage.addListener(function (request) {
    if (request.type !== "STATUS_UPDATE") return;

    var s = request.status;
    var c = request.current;
    var t = request.total;
    var p = request.currentPage;
    var msg = request.message || "";

    // State display
    var stateMap = {
      "idle": "Idle",
      "scanning": "Scanning grid...",
      "processing": "Downloading...",
      "paging": "Going to next page...",
      "done": "Complete!",
      "error": "Error",
      "stopped": "Stopped"
    };
    statusState.textContent = stateMap[s] || s;

    // Progress
    if (t > 0) {
      statusProgress.textContent = c + " / " + t;
      progressBar.style.width = Math.round((c / t) * 100) + "%";
    } else if (s === "done" || s === "error" || s === "stopped") {
      progressBar.style.width = "100%";
    }

    // Page
    statusPage.textContent = p > 0 ? ("Page " + p) : "—";

    // Message
    statusMessage.textContent = msg;

    // Log
    if (msg) {
      var logClass = "info";
      if (s === "done") logClass = "ok";
      else if (s === "error") logClass = "err";
      else if (s === "stopped") logClass = "warn";
      addLog(msg, logClass);
    }

    // Handle completion
    if (s === "done" || s === "error" || s === "stopped") {
      isRunning = false;
      btnStop.classList.add("hidden");
      btnStart.classList.remove("hidden");
      btnStart.disabled = true;
      btnDetect.disabled = false;
    }
  });

  function addLog(text, type) {
    var entry = document.createElement("div");
    entry.className = "log-entry log-" + (type || "info");
    var now = new Date();
    var time = now.getHours().toString().padStart(2, "0") + ":" +
               now.getMinutes().toString().padStart(2, "0") + ":" +
               now.getSeconds().toString().padStart(2, "0");
    entry.textContent = "[" + time + "] " + text;
    logArea.appendChild(entry);
    logArea.scrollTop = logArea.scrollHeight;
  }

  // Auto-detect on open
  addLog("Panel opened. Click 'Find Grid Items' to begin.", "info");

})();
