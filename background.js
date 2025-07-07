const OFFSCREEN_DOCUMENT_PATH = "offscreen/offscreen.html";

let detectionQueue = [];
let isOffscreenReady = false;
let isCreatingOffscreen = false;
let closeOffscreenTimeoutId = null;

// A mapping from a job ID to the tab that it belongs to.
const jobToTab = new Map();
const hiddenVideoCountPerTab = new Map();

async function hasOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const matchedClients = await clients.matchAll();
  return matchedClients.some((c) => c.url === offscreenUrl);
}

async function setupOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    // If it exists but we think it's not ready, it might be in the process of setting up.
    // The 'offscreen-ready' message will resolve this.
    // If it is ready, processQueue can proceed.
    if (isOffscreenReady) {
      processQueue();
    }
    return;
  }

  if (isCreatingOffscreen) {
    return;
  }

  isCreatingOffscreen = true;
  await chrome.offscreen
    .createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["BLOBS"],
      justification: "To process image data for face detection.",
    })
    .finally(() => {
      isCreatingOffscreen = false;
    });
}

function closeOffscreenDocumentCleanup() {
  // We only close the document if the queue is empty.
  // This function is called on a timeout, so we need to re-check.
  if (detectionQueue.length > 0) {
    return;
  }
  isOffscreenReady = false;
  chrome.offscreen.closeDocument().catch((e) => {}); // Ignore error if already closed
}

function processQueue() {
  // If a timeout to close the document was set, clear it because we have work to do.
  if (closeOffscreenTimeoutId) {
    clearTimeout(closeOffscreenTimeoutId);
    closeOffscreenTimeoutId = null;
  }

  if (detectionQueue.length === 0) {
    // No more items, set a timeout to close the offscreen document to conserve resources.
    closeOffscreenTimeoutId = setTimeout(
      closeOffscreenDocumentCleanup,
      25 * 1000
    );
    return;
  }

  if (!isOffscreenReady) {
    // If not ready, ensure the document is being set up.
    // The 'offscreen-ready' message will trigger the processing.
    setupOffscreenDocument();
    return;
  }

  const item = detectionQueue.shift();
  jobToTab.set(item.id, item.tabId);

  chrome.runtime
    .sendMessage({
      target: "offscreen",
      type: "detect-face",
      id: item.id,
      dataUrl: item.dataUrl,
      url: item.url,
      origWidth: item.origWidth,
      origHeight: item.origHeight,
      isLoggingEnabled: item.isLoggingEnabled,
    })
    .catch((error) => {
      console.error(
        `PureGlance: Failed to send item ${item.id} to offscreen. Re-queueing.`,
        error
      );
      detectionQueue.unshift(item); // Put it back
      isOffscreenReady = false; // Assume offscreen is broken
      chrome.offscreen.closeDocument().catch((e) => {}); // Try to close it
    });
}

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  switch (request.type) {
    case "QUEUE_DETECTION":
      if (sender.tab && sender.tab.id) {
        const { isEnabled, isLoggingEnabled } = await chrome.storage.local.get({
          isEnabled: true,
          isLoggingEnabled: false,
        });
        if (isEnabled) {
          detectionQueue.push({
            id: request.id,
            tabId: sender.tab.id,
            dataUrl: request.dataUrl,
            url: request.url,
            origWidth: request.origWidth,
            origHeight: request.origHeight,
            isLoggingEnabled: isLoggingEnabled,
          });
          if (isLoggingEnabled) {
            const sourceInfo = request.url ? `URL: ${request.url}` : "dataUrl";
            console.log(
              `PureGlance: Queued item ${request.id} for detection (${sourceInfo})`
            );
          }
          // Start processing if not already active
          processQueue();
        }
      }
      return true;

    case "offscreen-ready":
      isOffscreenReady = true;
      processQueue();
      return true;

    case "detection-result":
      const tabId = jobToTab.get(request.id);
      jobToTab.delete(request.id); // Clean up job map

      if (tabId) {
        const {
          detections,
          imageHeight,
          imageWidth,
          id,
          origWidth,
          origHeight,
        } = request;
        const {
          isLoggingEnabled,
          threshold,
          faceCountThreshold,
          isAreaThresholdEnabled,
          isFaceCountEnabled,
        } = await chrome.storage.local.get({
          isLoggingEnabled: false,
          threshold: 5,
          faceCountThreshold: 2,
          isAreaThresholdEnabled: true,
          isFaceCountEnabled: true,
        });

        if (isLoggingEnabled) {
          console.log(
            `PureGlance: Received detection result for ${id} on tab ${tabId}. Detections: ${detections.length}`
          );
        }

        let shouldHide = false;
        let reason = "";

        if (
          isFaceCountEnabled &&
          detections.length > 0 &&
          detections.length > faceCountThreshold
        ) {
          shouldHide = true;
          reason = `due to face count (${detections.length} > ${faceCountThreshold})`;
        }

        if (!shouldHide && isAreaThresholdEnabled) {
          const imageArea =
            origWidth && origHeight
              ? origWidth * origHeight
              : imageHeight * imageWidth;

          const scaleX = origWidth ? origWidth / imageWidth : 1;
          const scaleY = origHeight ? origHeight / imageHeight : 1;

          for (const detection of detections) {
            const scaledWidth = detection.boundingBox.width * scaleX;
            const scaledHeight = detection.boundingBox.height * scaleY;
            const faceArea = scaledWidth * scaledHeight;

            const ratio = faceArea / imageArea;
            if (isLoggingEnabled) {
              console.log(
                `  - Face area: ${faceArea.toFixed(0)} (scaled from ${
                  detection.boundingBox.width
                }x${
                  detection.boundingBox.height
                }), Image area: ${imageArea}, Ratio: ${ratio.toFixed(4)}`
              );
            }
            if (ratio >= threshold / 100) {
              shouldHide = true;
              reason = `due to large face ratio (${ratio.toFixed(4)} >= ${
                threshold / 100
              })`;
              break;
            }
          }
        }

        if (shouldHide) {
          if (isLoggingEnabled)
            console.log(
              `PureGlance: Hiding video ${id} on tab ${tabId} ${reason}.`
            );
          const currentCount = hiddenVideoCountPerTab.get(tabId) || 0;
          hiddenVideoCountPerTab.set(tabId, currentCount + 1);
          chrome.tabs
            .sendMessage(tabId, {
              type: "HIDE_VIDEO",
              id: id,
            })
            .catch(() => {
              /* Suppress error */
            });
        }
      }

      // After processing the result, try to process the next item in the queue.
      processQueue();
      return true;

    case "get-hidden-video-count":
      const tabIdForCount = request.tabId;
      const count = tabIdForCount
        ? hiddenVideoCountPerTab.get(tabIdForCount) || 0
        : 0;
      sendResponse({ count: count });
      return true; // Keep message channel open for async response
  }
  return true;
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  // Filter for main frame navigations on supported sites
  if (
    details.frameId === 0 &&
    details.url &&
    (details.url.includes("youtube.com") ||
      details.url.includes("vk.com") ||
      details.url.includes("vkvideo.ru"))
  ) {
    // Reset the counter for the tab
    hiddenVideoCountPerTab.set(details.tabId, 0);

    // Notify the popup to update the count
    chrome.runtime
      .sendMessage({ type: "hidden-video-count", count: 0 })
      .catch(() => {
        /* Suppress error */
      });

    // Notify the content script that the page has changed
    chrome.tabs
      .sendMessage(details.tabId, { type: "URL_CHANGED" })
      .catch(() => {
        /* Suppress error */
      });
  }
});
