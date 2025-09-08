<span align="center">

[![Chrome Version](https://img.shields.io/chrome-web-store/v/hifambahdidpghjhockkeedgidonohlc?label=Chrome)](https://chromewebstore.google.com/detail/pureglance/hifambahdidpghjhockkeedgidonohlc)
[![Firefox Version](https://img.shields.io/amo/v/pureglance?label=Firefox)](https://addons.mozilla.org/ru/firefox/addon/pureglance/)

</span>

# PureGlance

<img src="./img/logo_2.png">

PureGlance is a browser extension that helps you avoid clickbait by scanning video thumbnails for close-up faces. If a face takes up a significant portion of the thumbnail, the video is automatically hidden from your feed.

## How it works

The extension uses a lightweight, locally-run face detection model to analyze thumbnails on supported websites. The detection happens in the background and is optimized for performance to not slow down your browsing experience.

You can configure the sensitivity threshold in the extension's popup menu.

## Supported Websites

*   YouTube
*   VKVideo

## Installation

### From source (for development)

1.  Clone this repository: `git clone <repository_url>`
2.  Install the dependencies: `npm install`
3.  Build the extension: `npm run build`
4.  This will create a `dist` directory with two subdirectories: `chrome` and `firefox`.
5.  Load the extension into your browser:
    *   **Chrome/Brave:** Go to `chrome://extensions`, enable "Developer mode", and click "Load unpacked". Select the `dist/chrome` directory.
    *   **Firefox:** Go to `about:debugging`, click "This Firefox", click "Load Temporary Add-on...", and select the `manifest.json` file inside the `dist/firefox` directory. 
