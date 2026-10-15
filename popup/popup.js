const DEFAULT_SETTINGS = {
  isEnabled: true,
  isLoggingEnabled: false,
  threshold: 5,
  disableOnSubs: true,
  faceCountThreshold: 2,
  isAreaThresholdEnabled: true,
  isFaceCountEnabled: true,
};

// Fallback refresh for browsers where background push messages don't reach the popup (Firefox).
const POLL_INTERVAL_MS = 2000;
// Only links to supported video sites may be opened from the hidden-video list.
const ALLOWED_VIDEO_HOSTS = ["youtube.com", "vk.com", "vkvideo.ru"];
const TOOLTIP_OFFSET_PX = 6;
const TOOLTIP_EDGE_MARGIN_PX = 8;
// Hover preview of a hidden video is shown at this multiple of the grid thumbnail size.
const PREVIEW_ZOOM = 2;
const UNTITLED_VIDEO = "Untitled video";

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

function saveSettings(items) {
  setStorageData(items).catch((error) => {
    console.error("PureGlance: Failed to save settings", items, error);
  });
}

function isAllowedVideoUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ALLOWED_VIDEO_HOSTS.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
      )
    );
  } catch {
    return false;
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// --- Tooltip ---------------------------------------------------------------

function setupTooltips() {
  const tooltip = document.getElementById("tooltip");
  const tooltipText = document.getElementById("tooltipText");
  const tooltipSub = document.getElementById("tooltipSub");
  const tooltipImage = document.getElementById("tooltipImage");
  let activeTarget = null;

  const renderImage = (target, targetRect) => {
    const src = target.dataset.tipImage;
    tooltip.classList.toggle("has-image", Boolean(src));
    tooltipImage.hidden = !src;
    if (!src) {
      tooltipImage.removeAttribute("src");
      return;
    }
    // Explicit width keeps the tooltip measurable before the image finishes decoding.
    tooltipImage.style.width = `${Math.round(targetRect.width * PREVIEW_ZOOM)}px`;
    tooltipImage.src = src;
  };

  const hide = () => {
    activeTarget = null;
    tooltip.hidden = true;
  };

  const show = (target) => {
    activeTarget = target;
    const targetRect = target.getBoundingClientRect();
    tooltipText.textContent = target.dataset.tip;
    tooltipSub.textContent = target.dataset.tipSub || "";
    renderImage(target, targetRect);
    tooltip.hidden = false;

    // Measure after content is set; prefer above the target, flip below if clipped.
    const tipRect = tooltip.getBoundingClientRect();
    const maxLeft = window.innerWidth - tipRect.width - TOOLTIP_EDGE_MARGIN_PX;
    const centeredLeft = targetRect.left + targetRect.width / 2 - tipRect.width / 2;
    const left = Math.max(TOOLTIP_EDGE_MARGIN_PX, Math.min(centeredLeft, maxLeft));

    let top = targetRect.top - tipRect.height - TOOLTIP_OFFSET_PX;
    if (top < TOOLTIP_EDGE_MARGIN_PX) {
      top = targetRect.bottom + TOOLTIP_OFFSET_PX;
    }
    // Large previews in a short popup may fit neither side; keep them inside the window.
    const maxTop = window.innerHeight - tipRect.height - TOOLTIP_EDGE_MARGIN_PX;
    top = Math.max(TOOLTIP_EDGE_MARGIN_PX, Math.min(top, maxTop));
    tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };

  const handlePointer = (event) => {
    const target = event.target.closest?.("[data-tip]");
    if (target === activeTarget) return;
    if (target) {
      show(target);
    } else {
      hide();
    }
  };

  document.addEventListener("mouseover", handlePointer);
  document.addEventListener("focusin", handlePointer);
  document.addEventListener("focusout", hide);
  document.documentElement.addEventListener("mouseleave", hide);
  // Position is computed once on show, so it goes stale when content scrolls.
  document.addEventListener("scroll", hide, { capture: true, passive: true });
}

// --- Settings --------------------------------------------------------------

function updateRangeFill(slider) {
  const min = Number(slider.min);
  const max = Number(slider.max);
  const percent = ((Number(slider.value) - min) / (max - min)) * 100;
  slider.style.setProperty("--fill", `${percent}%`);
}

function bindToggleSetting(input, key, settings, onChange) {
  input.checked = settings[key];
  input.addEventListener("change", () => {
    saveSettings({ [key]: input.checked });
    onChange?.(input.checked);
  });
}

// A rule = on/off switch + slider whose value is shown in an output pill.
function bindRangeRule({ toggle, slider, output, enabledKey, valueKey, format }, settings) {
  const render = () => {
    output.textContent = format(slider.value);
    updateRangeFill(slider);
  };

  slider.value = settings[valueKey];
  slider.disabled = !settings[enabledKey];
  render();

  bindToggleSetting(toggle, enabledKey, settings, (isEnabled) => {
    slider.disabled = !isEnabled;
  });

  slider.addEventListener("input", () => {
    render();
    saveSettings({ [valueKey]: Number(slider.value) });
  });
}

function applyEnabledState(isEnabled) {
  document.body.classList.toggle("is-off", !isEnabled);
  document.getElementById("settings-wrapper").inert = !isEnabled;
  document.getElementById("statusText").textContent = isEnabled
    ? "Filtering is on"
    : "Filtering is paused";
}

async function setupSettings() {
  let settings;
  try {
    settings = await getStorageData(DEFAULT_SETTINGS);
  } catch (error) {
    console.error("PureGlance: Failed to load settings, using defaults", error);
    settings = { ...DEFAULT_SETTINGS };
  }

  applyEnabledState(settings.isEnabled);
  bindToggleSetting(
    document.getElementById("toggleSwitch"),
    "isEnabled",
    settings,
    applyEnabledState
  );
  bindToggleSetting(document.getElementById("toggleLogging"), "isLoggingEnabled", settings);
  bindToggleSetting(document.getElementById("disableOnSubsSwitch"), "disableOnSubs", settings);

  bindRangeRule(
    {
      toggle: document.getElementById("enableAreaThreshold"),
      slider: document.getElementById("thresholdSlider"),
      output: document.getElementById("thresholdValue"),
      enabledKey: "isAreaThresholdEnabled",
      valueKey: "threshold",
      format: (value) => `${value}%`,
    },
    settings
  );
  bindRangeRule(
    {
      toggle: document.getElementById("enableFaceCount"),
      slider: document.getElementById("faceCountSlider"),
      output: document.getElementById("faceCountValue"),
      enabledKey: "isFaceCountEnabled",
      valueKey: "faceCountThreshold",
      format: String,
    },
    settings
  );
}

// --- Hidden videos ---------------------------------------------------------

function createThumb(video) {
  const title = video.title || UNTITLED_VIDEO;
  const thumb = document.createElement("button");
  thumb.type = "button";
  thumb.className = "thumb";
  thumb.dataset.tip = title;
  thumb.dataset.tipSub = video.reason || "";
  thumb.setAttribute("aria-label", title);

  if (isAllowedVideoUrl(video.url)) {
    thumb.dataset.url = video.url;
  } else {
    // aria-disabled instead of disabled: disabled buttons swallow hover events, killing the tooltip.
    thumb.setAttribute("aria-disabled", "true");
  }

  if (isHttpsUrl(video.thumbnail)) {
    thumb.dataset.tipImage = video.thumbnail;
    const img = document.createElement("img");
    img.src = video.thumbnail;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    thumb.append(img);
  }
  return thumb;
}

function setupHiddenVideos(tabId) {
  const toggle = document.getElementById("hiddenToggle");
  const panel = document.getElementById("hiddenList");
  const grid = document.getElementById("thumbGrid");
  const emptyState = document.getElementById("emptyState");
  const countBadge = document.getElementById("videoCount");
  let renderedSignature = null;

  const isExpanded = () => toggle.getAttribute("aria-expanded") === "true";

  const renderList = (videos) => {
    // Skip rebuilding when nothing changed so polling doesn't reload images or reset hover.
    const signature = videos.map((video) => video.id).join(",");
    if (signature === renderedSignature) return;
    renderedSignature = signature;
    grid.replaceChildren(...videos.map(createThumb));
    emptyState.hidden = videos.length > 0;
  };

  const refreshList = async () => {
    if (!tabId) {
      renderList([]);
      return;
    }
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "GET_HIDDEN_VIDEOS" });
      renderList(Array.isArray(response?.videos) ? response.videos : []);
    } catch {
      // Expected on pages without the content script (unsupported sites, browser pages).
      renderList([]);
    }
  };

  const setCount = (count) => {
    countBadge.textContent = String(count);
    if (isExpanded()) refreshList();
  };

  const requestCount = async () => {
    if (!tabId) return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "get-hidden-video-count",
        tabId,
      });
      if (typeof response?.count === "number") {
        setCount(response.count);
      }
    } catch (error) {
      console.error(`PureGlance: Error getting video count in tab ${tabId}`, error);
    }
  };

  const openVideo = (event) => {
    const thumb = event.target.closest(".thumb");
    const url = thumb?.dataset.url;
    if (!url || !isAllowedVideoUrl(url)) return;
    // auxclick also fires for the right button; only the middle one means "open in new tab".
    if (event.type === "auxclick" && event.button !== 1) return;

    const inBackground = event.button === 1 || event.ctrlKey || event.metaKey;
    const navigation = inBackground
      ? chrome.tabs.create({ url, active: false })
      : chrome.tabs.update(tabId, { url });

    navigation
      .then(() => {
        if (!inBackground) window.close();
      })
      .catch((error) => console.error("PureGlance: Failed to open video", error));
  };

  toggle.addEventListener("click", () => {
    const expand = !isExpanded();
    toggle.setAttribute("aria-expanded", String(expand));
    panel.hidden = !expand;
    if (expand) refreshList();
  });
  grid.addEventListener("click", openVideo);
  grid.addEventListener("auxclick", openVideo);

  // Passive updates pushed from the background script (e.g. a new video was hidden).
  chrome.runtime.onMessage.addListener((request) => {
    if (request.type === "hidden-video-count" && request.tabId === tabId) {
      setCount(request.count);
    }
  });

  requestCount();
  setInterval(requestCount, POLL_INTERVAL_MS);
}

async function getActiveTabId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  } catch (error) {
    console.error("PureGlance: Could not get active tab ID", error);
    return null;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  setupTooltips();
  setupSettings();
  setupHiddenVideos(await getActiveTabId());
});
