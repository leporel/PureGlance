document.addEventListener("DOMContentLoaded", async () => {
  let currentTabId = null;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      currentTabId = tabs[0].id;
    }
  } catch (error) {
    console.error("PureGlance: Could not get active tab ID", error);
  }

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

  const toggleSwitch = document.getElementById("toggleSwitch");
  const settingsWrapper = document.getElementById("settings-wrapper");
  const toggleLogging = document.getElementById("toggleLogging");
  const disableOnSubsSwitch = document.getElementById("disableOnSubsSwitch");
  const videoCountElement = document.getElementById("videoCount");
  const thresholdSlider = document.getElementById("thresholdSlider");
  const thresholdValue = document.getElementById("thresholdValue");
  const faceCountSlider = document.getElementById("faceCountSlider");
  const faceCountValue = document.getElementById("faceCountValue");
  const enableAreaThreshold = document.getElementById("enableAreaThreshold");
  const enableFaceCount = document.getElementById("enableFaceCount");

  const updateSettingsVisibility = (isEnabled) => {
    if (settingsWrapper) {
      settingsWrapper.style.display = isEnabled ? "block" : "none";
    }
  };

  // Load the current state from storage and set the controls
  getStorageData({
    isEnabled: true,
    isLoggingEnabled: false,
    threshold: 5,
    disableOnSubs: true,
    faceCountThreshold: 2,
    isAreaThresholdEnabled: true,
    isFaceCountEnabled: true,
  }).then((data) => {
    toggleSwitch.checked = data.isEnabled;
    updateSettingsVisibility(data.isEnabled);
    toggleLogging.checked = data.isLoggingEnabled;
    disableOnSubsSwitch.checked = data.disableOnSubs;

    thresholdSlider.value = data.threshold;
    thresholdValue.textContent = `${data.threshold}%`;
    thresholdSlider.disabled = !data.isAreaThresholdEnabled;
    enableAreaThreshold.checked = data.isAreaThresholdEnabled;

    faceCountSlider.value = data.faceCountThreshold;
    faceCountValue.textContent = data.faceCountThreshold;
    faceCountSlider.disabled = !data.isFaceCountEnabled;
    enableFaceCount.checked = data.isFaceCountEnabled;
  });

  // Save the state when the controls are changed
  toggleSwitch.addEventListener("change", () => {
    const isEnabled = toggleSwitch.checked;
    setStorageData({ isEnabled: isEnabled });
    updateSettingsVisibility(isEnabled);
  });

  toggleLogging.addEventListener("change", () => {
    setStorageData({ isLoggingEnabled: toggleLogging.checked });
  });

  disableOnSubsSwitch.addEventListener("change", () => {
    setStorageData({ disableOnSubs: disableOnSubsSwitch.checked });
  });

  enableAreaThreshold.addEventListener("change", () => {
    const isEnabled = enableAreaThreshold.checked;
    setStorageData({ isAreaThresholdEnabled: isEnabled });
    thresholdSlider.disabled = !isEnabled;
  });

  enableFaceCount.addEventListener("change", () => {
    const isEnabled = enableFaceCount.checked;
    setStorageData({ isFaceCountEnabled: isEnabled });
    faceCountSlider.disabled = !isEnabled;
  });

  thresholdSlider.addEventListener("input", () => {
    const newThreshold = thresholdSlider.value;
    thresholdValue.textContent = `${newThreshold}%`;
    setStorageData({ threshold: newThreshold });
  });

  faceCountSlider.addEventListener("input", () => {
    const newFaceCountThreshold = faceCountSlider.value;
    faceCountValue.textContent = newFaceCountThreshold;
    setStorageData({ faceCountThreshold: newFaceCountThreshold });
  });

  // Function to request video count with better error handling
  async function requestVideoCount() {
    if (!currentTabId) {
      // videoCountElement.textContent = "Hidden Videos on this page: N/A";
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "get-hidden-video-count",
        tabId: currentTabId,
      });

      if (response && typeof response.count !== "undefined") {
        videoCountElement.textContent = `Hidden Videos on this page: ${response.count}`;
      } else {
        // videoCountElement.textContent = "Hidden Videos on this page: N/A";
      }
    } catch (error) {
      console.error('PureGlance: Error getting video count in tab: ${currentTabId}', error);
      videoCountElement.textContent = "Hidden Videos on this page: N/A";
    }
  }

  // Initial request for video count
  requestVideoCount();

  // Listen for updates pushed from the background script (e.g., on navigation)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Only update count if it's for the current tab to avoid cross-talk
    if (request.type === "hidden-video-count" && request.tabId === currentTabId) {
      videoCountElement.textContent = `Hidden Videos on this page: ${request.count}`;
    }
    // This listener is for passive updates, so we don't send a response.
    // Return true to not close the channel if other listeners are async
    return true; 
  });

  // Periodically update the count (fallback for Firefox)
  setInterval(requestVideoCount, 2000);
});