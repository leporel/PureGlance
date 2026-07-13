// Create a global object to store site-specific modules.
window.PureGlanceModules = window.PureGlanceModules || {};

window.PureGlanceModules.vkvideo = {
  // Selector for finding thumbnail containers on VK Video and VK.com.
  // VK's "vkit" component redesign dropped the [data-thumb] attribute in favor
  // of a plain <img> inside an anchor marked with a stable data-testid.
  thumbnailSelector:
    `.VideoCard[data-thumb], ._video_item[data-thumb],
     a[data-testid="video_card_thumb"] img:not([data-pureglance-id])`,

  // Function to get the thumbnail source URL from the element.
  getThumbnailSrc: function (element) {
    return element.dataset.thumb || element.src;
  },

  // Function to find the main container of a video on VK.
  findVideoContainer: function (element) {
    // Prefer the outer grid cell (main feed) so hiding a video doesn't leave
    // an empty slot behind - it's an ancestor of video_card_layout, and
    // closest() with a combined selector would otherwise match the nearer,
    // inner node first.
    const gridItem = element.closest('div[data-testid="grid-item"]');
    if (gridItem) {
      return gridItem;
    }

    // Selector for vkvideo.ru and modern vk.com pages (e.g. sidebar cards
    // that aren't wrapped in a grid-item).
    const container = element.closest(
      '.VideoCard, ._video_item, div[data-testid="catalog_item_video"], div[data-testid="video_card_layout"]'
    );
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
    return window.location.hostname.includes("vkvideo.ru") && window.location.pathname.startsWith("/subscriptions");
  },
  isProtectedPages: function () {
    return window.location.hostname.includes("vkvideo.ru") && (
    window.location.pathname.startsWith("?q=") || 
    window.location.pathname.startsWith("/history") || 
    window.location.pathname.startsWith("/bookmarks") || 
    window.location.pathname.startsWith("/liked") || 
    window.location.pathname.startsWith("/my_communities"));
  },
};
