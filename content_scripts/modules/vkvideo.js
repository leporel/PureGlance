// Create a global object to store site-specific modules.
window.PureGlanceModules = window.PureGlanceModules || {};

window.PureGlanceModules.vkvideo = {
  // Selector for finding thumbnail containers on VK Video and VK.com.
  thumbnailSelector: ".VideoCard[data-thumb], ._video_item[data-thumb]",

  // Function to get the thumbnail source URL from the element.
  getThumbnailSrc: function (element) {
    return element.dataset.thumb;
  },

  // Function to find the main container of a video on VK.
  findVideoContainer: function (element) {
    // Selector for vkvideo.ru and modern vk.com pages
    const container = element.closest(".VideoCard, ._video_item");
    if (container) {
      return container;
    }

    // Fallback for older/different vk.com video layouts
    const videoItem = element.closest(".video_item");
    if (videoItem) {
      return videoItem;
    }

    // Generic fallback as a last resort
    return element.parentElement?.parentElement || element.parentElement;
  },

  // Function to check if the current page is the subscription feed.
  isSubscriptionFeed: function () {
    return false;
  },
};
