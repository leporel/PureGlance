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

// 1. Site-specific module selection
let siteModule;
const hostname = window.location.hostname;

let settings = {
  disableOnSubs: false,
};

getStorageData({ disableOnSubs: false }).then((data) => {
  settings.disableOnSubs = data.disableOnSubs;
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.disableOnSubs) {
    settings.disableOnSubs = changes.disableOnSubs.newValue;
  }
});

if (hostname.includes("youtube.com")) {
  siteModule = window.PureGlanceModules.youtube;
} else if (hostname.includes("vk.com") || hostname.includes("vkvideo.ru")) {
  siteModule = window.PureGlanceModules.vkvideo;
}

// 2. Thumbnail Processing and hiding logic
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "HIDE_VIDEO") {
    const elementToHide = document.querySelector(
      `[data-pureglance-id="${message.id}"]`
    );
    if (elementToHide && siteModule) {
      const container = siteModule.findVideoContainer(elementToHide);
      if (container) {
        container.style.display = "none";
        container.dataset.pureglanceHidden = "true";
      } else {
        // Fallback for cases where a container is not found
        elementToHide.style.display = "none";
        elementToHide.dataset.pureglanceHidden = "true";
      }
    }
  }

  if (message.type === "URL_CHANGED") {
    // A navigation event occurred, rescan the page.
    scanForThumbnails();
  }
});

function unhideAllVideos() {
  document.querySelectorAll('[data-pureglance-hidden="true"]').forEach((el) => {
    el.style.display = "";
    delete el.dataset.pureglanceHidden;
  });
}

async function processThumbnail(element) {
  if (element.dataset.pureglanceId) {
    return;
  }

  // Use module-specific function to get URL, or fallback to src
  const thumbnailUrl = siteModule.getThumbnailSrc
    ? siteModule.getThumbnailSrc(element)
    : element.src;

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
    // If image fails to load, send the URL for background processing
    chrome.runtime.sendMessage({
      type: "QUEUE_DETECTION",
      id: id,
      url: thumbnailUrl,
    });
  };

  img.src = thumbnailUrl;
}

// 3. Observers
function scanForThumbnails() {
  if (siteModule.isSubscriptionFeed() && settings.disableOnSubs) {
    unhideAllVideos();
    return;
  }
  if (!siteModule || !siteModule.thumbnailSelector) {
    return;
  }
  const thumbnails = document.querySelectorAll(siteModule.thumbnailSelector);
  thumbnails.forEach((element) => {
    if (!element.dataset.pureglanceId) {
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

// Initial scan and start observing
if (siteModule) {
  scanForThumbnails();
  mutationObserver.observe(document.body, { childList: true, subtree: true });
}
