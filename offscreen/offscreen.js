import {
  FaceDetector,
  FilesetResolver,
} from "../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs";

let faceDetector;
let isDetectorReady = false;

async function setupFaceDetector() {
  console.log("Offscreen script loaded.");

  try {
    if (isDetectorReady) return;
    console.log("Setting up Face Detector...");

    const vision = await FilesetResolver.forVisionTasks(
      chrome.runtime.getURL("../node_modules/@mediapipe/tasks-vision/wasm")
    );
    console.log("Vision task resolver created.");

    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: chrome.runtime.getURL(
          "models/blaze_face_short_range.tflite"
        ),
        delegate: "GPU",
      },
      runningMode: "IMAGE",
    });
    console.log("Face Detector created.");

    isDetectorReady = true;
    console.log("Face Detector is ready. Sending 'offscreen-ready' message.");
    chrome.runtime.sendMessage({ type: "offscreen-ready" });
  } catch (error) {
    console.error("Error setting up Face Detector:", error);
  }
}

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  const { isLoggingEnabled } = request;
  if (request.target !== "offscreen") {
    return;
  }

  if (request.type === "detect-face") {
    if (!isDetectorReady) {
      if (isLoggingEnabled)
        console.warn("Offscreen not ready, waiting for setup...");
      await setupFaceDetector();
    }

    try {
      let imageBitmap;
      if (request.dataUrl) {
        const response = await fetch(request.dataUrl);
        const blob = await response.blob();
        imageBitmap = await createImageBitmap(blob);
      } else if (request.url) {
        const response = await fetch(request.url);
        const blob = await response.blob();
        imageBitmap = await createImageBitmap(blob);
      } else {
        throw new Error("No image data provided");
      }

      if (isLoggingEnabled) {
        console.log(
          "Requested imageBitmap for detection:",
          imageBitmap,
          "Width:",
          imageBitmap?.width,
          "Height:",
          imageBitmap?.height
        );
      }

      const detections = faceDetector.detect(imageBitmap);
      chrome.runtime.sendMessage({
        type: "detection-result",
        detections: detections.detections,
        imageHeight: imageBitmap.height,
        imageWidth: imageBitmap.width,
        id: request.id,
        origWidth: request.origWidth,
        origHeight: request.origHeight,
      });
    } catch (error) {
      if (isLoggingEnabled)
        console.error(
          `PureGlance: Failed to process thumbnail ${request.id}:`,
          error
        );
      chrome.runtime.sendMessage({
        type: "detection-result",
        detections: [],
        imageHeight: 0,
        imageWidth: 0,
        id: request.id,
        origWidth: request.origWidth,
        origHeight: request.origHeight,
      });
    }
  }
});

// Proactively start setting up the face detector as soon as the script loads.
setupFaceDetector();
