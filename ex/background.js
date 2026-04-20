// ============================================================
// background.js — service worker that handles downloads
// and relays messages between content script and side panel.
// ============================================================

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {

  if (request.type === "DOWNLOAD_FROM_DETAIL") {
    downloadVideoAndThumb(request, sender.tab);
    sendResponse({ queued: true });
    return false;
  }

  if (request.type === "STATUS_UPDATE") {
    // Relay to side panel
    chrome.runtime.sendMessage(request).catch(function () {});
    sendResponse({ ok: true });
    return false;
  }

  if (request.type === "OPEN_SIDE_PANEL") {
    chrome.sidePanel.open({ tabId: sender.tab.id });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

function downloadVideoAndThumb(data, tab) {
  const folder = data.folderName || "video";
  const pageUrl = tab ? tab.url : "";
  const title = data.pageTitle || folder;

  // Download thumbnail first
  if (data.thumbUrl) {
    const thumbFilename = folder + "/thumbnail.jpg";
    chrome.downloads.download({
      url: data.thumbUrl,
      filename: thumbFilename,
      saveAs: false,
      conflictAction: "uniquify"
    }, function (downloadId) {
      if (chrome.runtime.lastError) {
        console.warn("Thumbnail download failed:", chrome.runtime.lastError.message);
      }
    });
  }

  // Download video
  if (data.videoUrl) {
    const videoFilename = folder + "/video.mp4";
    chrome.downloads.download({
      url: data.videoUrl,
      filename: videoFilename,
      saveAs: false,
      conflictAction: "uniquify"
    }, function (downloadId) {
      if (chrome.runtime.lastError) {
        console.warn("Video download failed:", chrome.runtime.lastError.message);
      }
    });
  }
}

// When extension icon is clicked, open side panel
chrome.action.onClicked.addListener(function (tab) {
  chrome.sidePanel.open({ tabId: tab.id });
});
