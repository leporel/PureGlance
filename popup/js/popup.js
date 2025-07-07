document.addEventListener('DOMContentLoaded', () => {
    const toggleSwitch = document.getElementById('toggleSwitch');
    const settingsWrapper = document.getElementById('settings-wrapper');
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
        isLoggingEnabled: true,
        disableOnSubs: false,
        isAreaThresholdEnabled: true,
        isFaceCountEnabled: true 
    }, (data) => {
        toggleSwitch.checked = data.isEnabled;
        updateSettingsVisibility(data.isEnabled);
        toggleLogging.checked = data.isLoggingEnabled;
        disableOnSubsSwitch.checked = data.disableOnSubs;
        enableAreaThreshold.checked = data.isAreaThresholdEnabled;
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
        chrome.storage.local.set({ isAreaThresholdEnabled: enableAreaThreshold.checked });
    });

    enableFaceCount.addEventListener('change', () => {
        chrome.storage.local.set({ isFaceCountEnabled: enableFaceCount.checked });
    });
}); 