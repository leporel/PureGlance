// Create a global object to store site-specific modules.
window.PureGlanceModules = window.PureGlanceModules || {};

window.PureGlanceModules.youtube = {
  // Selector for finding thumbnail images.
  thumbnailSelector:
    'a#thumbnail img.yt-core-image:only-child:not([src*="avatar"]):not(.yt-spec-avatar-shape__image):not([data-pureglance-id])',

  // Function to find the main container of a video to hide it.
  findVideoContainer: function (element) {
    const selectors = [
      "ytd-rich-item-renderer", // Main feed, search results
      "ytd-grid-video-renderer", // Grid view (e.g., channel page)
      "ytd-compact-video-renderer", // Sidebar (up next)
      "ytd-video-renderer", // Subscriptions page
      "ytd-watch-next-secondary-results-renderer", // End of video recommendations
    ];

    for (const selector of selectors) {
      const container = element.closest(selector);
      if (container) {
        return container;
      }
    }
    // Fallback for other potential layouts.
    return (
      element.parentElement?.parentElement?.parentElement ||
      element.parentElement
    );
  },
  
  // Function to check if the current page is the YouTube subscription feed.
  isSubscriptionFeed: function () {
    return window.location.hostname.includes("youtube.com") && window.location.pathname.startsWith("/feed/subscriptions");
  },
};
