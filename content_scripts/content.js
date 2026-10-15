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

let idCounter = 0;

// Videos hidden on the current page, keyed by pureglance id. Kept here (not in
// the background) because only the page knows titles and links; reset on navigation.
const hiddenVideos = new Map();
// Guards against oversized strings from page markup reaching the popup.
const MAX_TITLE_LENGTH = 200;

// 1. Site-specific module selection
let siteModule;
const hostname = window.location.hostname;

if (hostname.includes("youtube.com")) {
  siteModule = window.PureGlanceModules.youtube;
} else if (hostname.includes("vk.com") || hostname.includes("vkvideo.ru")) {
  siteModule = window.PureGlanceModules.vkvideo;
}

let settings = {
  disableOnSubs: true,
  isEnabled: true,
};

getStorageData({ disableOnSubs: true, isEnabled: true, isLoggingEnabled: false }).then((data) => {
  settings.disableOnSubs = data.disableOnSubs || false;
  settings.isEnabled = data.isEnabled !== undefined ? data.isEnabled : true;
  settings.isLoggingEnabled = data.isLoggingEnabled || false;

  if (!settings.isEnabled) {
    console.log("PureGlance: Extension disabled after loading settings.");
    unhideAllVideos();
    return;  // Exit early, no setup
  }

  if (settings.isLoggingEnabled) {
    console.log("PureGlance: Extension enabled and starting scan.");
  }

  // Initial scan and start observing
  if (siteModule) {
    scanForThumbnails();
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.disableOnSubs) {
    settings.disableOnSubs = changes.disableOnSubs.newValue;
  }
  if (namespace === "local" && changes.isEnabled) {
    settings.isEnabled = changes.isEnabled.newValue;
    if (!settings.isEnabled) {
      unhideAllVideos();
    } else {
      reHideVideos();
      // When enabling, re-scan to process existing thumbnails
      scanForThumbnails();
    }
  }
});

// 2. Thumbnail Processing and hiding logic
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "HIDE_VIDEO") {
    const elementToHide = document.querySelector(
      `[data-pureglance-id="${message.id}"]`
    );
    if (elementToHide && siteModule) {
      // Fallback to the thumbnail itself for cases where a container is not found
      const container = siteModule.findVideoContainer(elementToHide) || elementToHide;
      container.style.display = "none";
      container.dataset.pureglanceHidden = "true";
      hiddenVideos.set(
        message.id,
        describeVideo(message.id, elementToHide, container, message.reason)
      );
    }
  }

  if (message.type === "GET_HIDDEN_VIDEOS") {
    sendResponse({ videos: Array.from(hiddenVideos.values()) });
  }

  if (message.type === "URL_CHANGED") {
    hiddenVideos.clear();
    // A navigation event occurred, rescan the page.
    scanForThumbnails();
  }
});

function getThumbnailUrl(element) {
  return siteModule.getThumbnailSrc
    ? siteModule.getThumbnailSrc(element)
    : element.src;
}

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
}

function findFirst(root, selectors) {
  for (const selector of selectors) {
    const match = root.querySelector(selector);
    if (match) return match;
  }
  return null;
}

// Collects what the popup needs to show a hidden video: preview, title and link.
function describeVideo(id, thumbnailElement, container, reason) {
  const link =
    thumbnailElement.closest("a[href]") ||
    container.querySelector(siteModule.videoLinkSelector);
  const titleElement = findFirst(container, siteModule.titleSelectors);
  const title =
    titleElement?.getAttribute("title") ||
    titleElement?.textContent ||
    thumbnailElement.alt;

  return {
    id,
    thumbnail: getThumbnailUrl(thumbnailElement) || "",
    url: link?.href || "",
    title: normalizeText(title),
    reason: normalizeText(reason),
  };
}

async function unhideAllVideos() {
  const hiddenEls = document.querySelectorAll('[data-pureglance-hidden="true"]');
  hiddenEls.forEach((el) => {
    el.style.display = "";
    // Keep datasets to allow quick re-hiding on re-enable
  });

  if (settings.isLoggingEnabled) {
    console.log(`PureGlance: Unhiding all videos.`);
  }
}

async function processThumbnail(element) {
  if (element.dataset.pureglanceId) {
    return;
  }

  const thumbnailUrl = getThumbnailUrl(element);

  if (!thumbnailUrl) {
    return;
  }

  // Assign an ID before any async operations to prevent reprocessing
  const id = `pg-${idCounter++}`;
  element.dataset.pureglanceId = id;

  // We need to load the image to get its data and dimensions
  const img = new Image();
  // Attempt to prevent canvas tainting
  img.crossOrigin = "Anonymous";

  img.onload = async () => {
    if (!settings.isEnabled) return;
    // Downscale for faster detection
    const targetWidth = 480;
    const targetHeight = 270;
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");

    try {
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      chrome.runtime.sendMessage({
        type: "QUEUE_DETECTION",
        id: id,
        dataUrl: dataUrl,
        origWidth: img.naturalWidth,
        origHeight: img.naturalHeight,
      });
    } catch (e) {
      const { isLoggingEnabled } = await getStorageData({
        isLoggingEnabled: false,
      });
      if (isLoggingEnabled && e.name === "SecurityError") {
        console.warn(
          `PureGlance: Canvas is tainted for image ${img.src}. Falling back to URL method.`
        );
      }
      // Fallback: send only the url
      chrome.runtime.sendMessage({
        type: "QUEUE_DETECTION",
        id: id,
        url: thumbnailUrl,
        origWidth: img.naturalWidth,
        origHeight: img.naturalHeight,
      });
    }
  };

  img.onerror = () => {
    if (!settings.isEnabled) return;
    // If image fails to load, send the URL for background processing
    chrome.runtime.sendMessage({
      type: "QUEUE_DETECTION",
      id: id,
      url: thumbnailUrl,
    });
  };

  img.src = thumbnailUrl;
}

async function reHideVideos() {
  const hiddenEls = document.querySelectorAll('[data-pureglance-hidden="true"]');
  if (hiddenEls.length === 0) return;

  if (settings.isLoggingEnabled) {
    console.log(`PureGlance: Re-hiding ${hiddenEls.length} previously hidden videos.`);
  }

  hiddenEls.forEach((el) => {
    const container = siteModule?.findVideoContainer(el) || el;
    if (container) {
      container.style.display = "none";
    }
  });

}

// 3. Observers
function scanForThumbnails() {
  if (!settings.isEnabled || (siteModule.isSubscriptionFeed() && settings.disableOnSubs) || siteModule.isProtectedPages())  {
    if (settings.isLoggingEnabled) {
      console.log("PureGlance: Skipping scan - disabled or protected page.");
    }
    unhideAllVideos();
    return;
  }
  if (!siteModule || !siteModule.thumbnailSelector) {
    if (settings.isLoggingEnabled) {
      console.log("PureGlance: No site module or selector available.");
    }
    return;
  }
  const thumbnails = document.querySelectorAll(siteModule.thumbnailSelector);
  if (settings.isLoggingEnabled) {
    console.log(`PureGlance: Scanning ${thumbnails.length} thumbnails.`);
  }
  thumbnails.forEach((element) => {
    if (!element.dataset.pureglanceId || element.dataset.pureglanceId == '') {
      processThumbnail(element);
    }
  });
}

const debouncedScan = debounce(scanForThumbnails, 50);

const mutationObserver = new MutationObserver(debouncedScan);

// Also trigger on scroll, in case the MutationObserver is delayed by browser optimizations.
document.addEventListener("scroll", debouncedScan, {
  capture: true,
  passive: true,
});

function debounce(func, delay) {
  let timeout;
  return function (...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), delay);
  };
}
