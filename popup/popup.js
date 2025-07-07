document.addEventListener('DOMContentLoaded', () => {
    const toggleSwitch = document.getElementById('toggleSwitch');
    const settingsWrapper = document.getElementById('settings-wrapper');
    const toggleLogging = document.getElementById('toggleLogging');
    const disableOnSubsSwitch = document.getElementById('disableOnSubsSwitch');
    const videoCountElement = document.getElementById('videoCount');
    const thresholdSlider = document.getElementById('thresholdSlider');
    const thresholdValue = document.getElementById('thresholdValue');
    const faceCountSlider = document.getElementById('faceCountSlider');
    const faceCountValue = document.getElementById('faceCountValue');
    const enableAreaThreshold = document.getElementById('enableAreaThreshold');
    const enableFaceCount = document.getElementById('enableFaceCount');

    const updateSettingsVisibility = (isEnabled) => {
        if (settingsWrapper) {
            settingsWrapper.style.display = isEnabled ? 'block' : 'none';
        }
    };

    // Load the current state from storage and set the controls
    chrome.storage.local.get({ 
        isEnabled: true, 
        isLoggingEnabled: false, 
        threshold: 5, 
        disableOnSubs: false, 
        faceCountThreshold: 2,
        isAreaThresholdEnabled: true,
        isFaceCountEnabled: true 
    }, (data) => {
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
    toggleSwitch.addEventListener('change', () => {
        const isEnabled = toggleSwitch.checked;
        chrome.storage.local.set({ isEnabled: isEnabled });
        updateSettingsVisibility(isEnabled);
    });

    toggleLogging.addEventListener('change', () => {
        chrome.storage.local.set({ isLoggingEnabled: toggleLogging.checked });
    });

    disableOnSubsSwitch.addEventListener('change', () => {
        chrome.storage.local.set({ disableOnSubs: disableOnSubsSwitch.checked });
    });

    enableAreaThreshold.addEventListener('change', () => {
        const isEnabled = enableAreaThreshold.checked;
        chrome.storage.local.set({ isAreaThresholdEnabled: isEnabled });
        thresholdSlider.disabled = !isEnabled;
    });

    enableFaceCount.addEventListener('change', () => {
        const isEnabled = enableFaceCount.checked;
        chrome.storage.local.set({ isFaceCountEnabled: isEnabled });
        faceCountSlider.disabled = !isEnabled;
    });

    thresholdSlider.addEventListener('input', () => {
        const newThreshold = thresholdSlider.value;
        thresholdValue.textContent = `${newThreshold}%`;
        chrome.storage.local.set({ threshold: newThreshold });
    });

    faceCountSlider.addEventListener('input', () => {
        const newFaceCountThreshold = faceCountSlider.value;
        faceCountValue.textContent = newFaceCountThreshold;
        chrome.storage.local.set({ faceCountThreshold: newFaceCountThreshold });
    });

    // Get the active tab ID and request hidden video count
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
            const tabId = tabs[0].id;
            chrome.runtime.sendMessage({
                type: 'get-hidden-video-count',
                tabId: tabId
            }, (response) => {
                if (chrome.runtime.lastError) {
                    videoCountElement.textContent = `Error: ${chrome.runtime.lastError.message}`;
                } else if (response && typeof response.count !== 'undefined') {
                    videoCountElement.textContent = `Hidden Videos on this page: ${response.count}`;
                } else {
                    videoCountElement.textContent = 'Hidden Videos on this page: N/A';
                }
            });
        } else {
            videoCountElement.textContent = 'Hidden Videos on this page: N/A';
        }
    });

    // Listen for updates pushed from the background script (e.g., on navigation)
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'hidden-video-count') {
            videoCountElement.textContent = `Hidden Videos on this page: ${request.count}`;
        }
        // This listener is for passive updates, so we don't send a response.
    });
});
