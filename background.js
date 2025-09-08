function getStorageData(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve(result);
    });
  });
}

function setStorageData(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve();
    });
  });
}

const isChrome = !!self.chrome?.offscreen;

const OFFSCREEN_DOCUMENT_PATH = "offscreen/offscreen.html";

let detectionQueue = [];
let isOffscreenReady = false;
let isCreatingOffscreen = false;
let closeOffscreenTimeoutId = null;

// --- Firefox Direct Processing ---
let faceDetector = null;
let isDetectorReady = false;
let isInitializingDetector = false;

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

// Firefox: Initialize MediaPipe directly in background script
async function initializeFirefoxDetector() {
  if (isDetectorReady || isInitializingDetector) {
    return;
  }

  isInitializingDetector = true;

  try {
    // Import MediaPipe as ES module
    const { FilesetResolver, FaceDetector } = await import(
      chrome.runtime.getURL(
        "node_modules/@mediapipe/tasks-vision/vision_bundle.mjs"
      )
    );

    const vision = await FilesetResolver.forVisionTasks(
      chrome.runtime.getURL("node_modules/@mediapipe/tasks-vision/wasm")
    );

    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: chrome.runtime.getURL(
          "models/blaze_face_short_range.tflite"
        ),
        delegate: "GPU",
      },
      runningMode: "IMAGE",
    });

    isDetectorReady = true;
    console.log("PureGlance: MediaPipe detector initialized for Firefox");

    // Process any queued items
    processQueue();
  } catch (error) {
    console.error(
      "PureGlance: Failed to initialize MediaPipe detector:",
      error
    );
    isDetectorReady = false;
  } finally {
    isInitializingDetector = false;
  }
}

// Firefox: Process detection directly in background script
async function processFirefoxDetection(item) {
  if (!isDetectorReady) {
    console.error("PureGlance: Detector not ready for Firefox processing");
    return;
  }

  try {
    let imageBitmap;

    if (item.dataUrl) {
      // For dataUrl, convert directly to blob without fetch
      const base64Data = item.dataUrl.split(",")[1];
      const mimeType = item.dataUrl.split(";")[0].split(":")[1];

      // Convert base64 to Uint8Array
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);

      // Create blob and bitmap
      const blob = new Blob([byteArray], { type: mimeType });
      imageBitmap = await createImageBitmap(blob);
    } else if (item.url) {
      const response = await fetch(item.url, { mode: "cors" });
      const blob = await response.blob();
      imageBitmap = await createImageBitmap(blob);
    } else {
      throw new Error("No image data provided");
    }

    const detections = faceDetector.detect(imageBitmap);

    // Process the detection result (same as worker result)
    await handleDetectionResult({
      type: "detection-result",
      detections: detections.detections,
      imageHeight: imageBitmap.height,
      imageWidth: imageBitmap.width,
      id: item.id,
      origWidth: item.origWidth,
      origHeight: item.origHeight,
    });

    imageBitmap.close(); // Clean up resources
  } catch (error) {
    console.error(`PureGlance: Failed to process thumbnail ${item.id}:`, error);
    // Process empty result
    await handleDetectionResult({
      type: "detection-result",
      detections: [],
      id: item.id,
    });
  }
}

async function processQueue() {
  if (isChrome) {
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
  } else {
    // --- Firefox Direct Processing ---
    if (detectionQueue.length === 0) {
      return;
    }

    // Initialize detector if not ready
    if (!isDetectorReady && !isInitializingDetector) {
      await initializeFirefoxDetector();
    }

    if (!isDetectorReady) {
      // Still not ready, wait for initialization
      return;
    }

    const item = detectionQueue.shift();
    jobToTab.set(item.id, item.tabId);

    // Process directly in background script
    await processFirefoxDetection(item);

    // Continue processing queue
    if (detectionQueue.length > 0) {
      processQueue();
    }
  }
}

// Handle detection results (extracted from messageListener)
async function handleDetectionResult(request) {
  const tabId = jobToTab.get(request.id);
  jobToTab.delete(request.id); // Clean up job map

  if (tabId) {
    const { detections, imageHeight, imageWidth, id, origWidth, origHeight } =
      request;
    const {
      isLoggingEnabled,
      threshold,
      faceCountThreshold,
      isAreaThresholdEnabled,
      isFaceCountEnabled,
    } = await getStorageData({
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
      const newCount = currentCount + 1;
      hiddenVideoCountPerTab.set(tabId, newCount);
      notifyPopupOfCountChange(tabId);
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
}

async function messageListener(request, sender, sendResponse) {
  switch (request.type) {
    case "QUEUE_DETECTION":
      // Only process this for content scripts (not for worker messages)
      if (sender && sender.tab && sender.tab.id) {
        const { isEnabled, isLoggingEnabled } = await getStorageData({
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
      if (isChrome) {
        isOffscreenReady = true;
        processQueue();
      }
      return true;

    case "detection-result":
      await handleDetectionResult(request);
      // After processing the result, try to process the next item in the queue.
      processQueue();
      return true;

    case "get-hidden-video-count":
      let tabIdForCount = request.tabId;

      // If no tabId provided, try to get the current active tab
      if (!tabIdForCount) {
        try {
          const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (tabs && tabs[0]) {
            tabIdForCount = tabs[0].id;
          }
        } catch (error) {
          console.error("PureGlance: Failed to get active tab:", error);
        }
      }

      // Also try sender.tab.id as fallback. This is important for popups in some browsers.
      if (!tabIdForCount && sender?.tab?.id) {
        tabIdForCount = sender.tab.id;
      }

      if (tabIdForCount) {
        const count = hiddenVideoCountPerTab.get(tabIdForCount) || 0;
        sendResponse({ count: count });
      } else {
        sendResponse({});
      }
      return true;

    case "RESET_COUNT":
      if (sender && sender.tab && sender.tab.id) {
        hiddenVideoCountPerTab.set(sender.tab.id, 0);
        notifyPopupOfCountChange(sender.tab.id);
      }
      return true;
  }
  return true;
}

chrome.runtime.onMessage.addListener(messageListener);

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

function notifyPopupOfCountChange(tabId) {
  const count = hiddenVideoCountPerTab.get(tabId) || 0;
  chrome.runtime
    .sendMessage({
      type: "hidden-video-count",
      count: count,
      tabId: tabId,
    })
    .catch(() => {
      // Suppress error if popup is not open
    });
}

// Initialize Firefox detector on startup
if (!isChrome) {
  initializeFirefoxDetector();
}
