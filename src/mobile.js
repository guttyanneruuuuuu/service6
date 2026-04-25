/* ============================================================
   ZEROPOINT MOBILE — Touch & Mobile Optimizations
   ============================================================ */

/**
 * Detect if device is mobile/touch-capable
 */
export function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

export function isTouchDevice() {
  return (
    typeof window !== 'undefined' &&
    ('ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      navigator.msMaxTouchPoints > 0)
  );
}

/**
 * Prevent 100vh issues on mobile
 */
export function fixMobileViewportHeight() {
  const setHeight = () => {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  };

  setHeight();
  window.addEventListener('resize', setHeight);
  window.addEventListener('orientationchange', setHeight);
}

/**
 * Smooth scroll with mobile optimization
 */
export function smoothScrollToElement(element, options = {}) {
  if (!element) return;

  const defaultOptions = {
    behavior: 'smooth',
    block: 'start',
    inline: 'nearest',
  };

  const finalOptions = { ...defaultOptions, ...options };

  // Use native scrollIntoView if available
  if (element.scrollIntoView) {
    element.scrollIntoView(finalOptions);
  } else {
    // Fallback for older browsers
    element.scrollIntoView();
  }
}

/**
 * Prevent body scroll when modal is open
 */
export function lockBodyScroll() {
  const scrollbarWidth =
    window.innerWidth - document.documentElement.clientWidth;
  document.body.style.overflow = 'hidden';
  document.body.style.paddingRight = `${scrollbarWidth}px`;
}

export function unlockBodyScroll() {
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
}

/**
 * Touch gesture detection
 */
export class TouchGestureDetector {
  constructor(element) {
    this.element = element;
    this.startX = 0;
    this.startY = 0;
    this.startTime = 0;
    this.callbacks = {
      swipeLeft: null,
      swipeRight: null,
      swipeUp: null,
      swipeDown: null,
      tap: null,
      longPress: null,
    };

    this.init();
  }

  init() {
    this.element.addEventListener('touchstart', (e) => this.onTouchStart(e));
    this.element.addEventListener('touchend', (e) => this.onTouchEnd(e));
    this.element.addEventListener('touchmove', (e) => this.onTouchMove(e));
  }

  onTouchStart(e) {
    this.startX = e.touches[0].clientX;
    this.startY = e.touches[0].clientY;
    this.startTime = Date.now();
  }

  onTouchMove(e) {
    // Prevent default scroll behavior for swipe detection
    if (this.detectSwipe(e)) {
      e.preventDefault();
    }
  }

  onTouchEnd(e) {
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const duration = Date.now() - this.startTime;

    const deltaX = endX - this.startX;
    const deltaY = endY - this.startY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Tap (short distance, short duration)
    if (distance < 10 && duration < 300) {
      if (this.callbacks.tap) this.callbacks.tap(e);
      return;
    }

    // Long press
    if (duration > 500 && distance < 10) {
      if (this.callbacks.longPress) this.callbacks.longPress(e);
      return;
    }

    // Swipe detection
    if (duration < 500 && distance > 50) {
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        // Horizontal swipe
        if (deltaX > 0 && this.callbacks.swipeRight) {
          this.callbacks.swipeRight(e);
        } else if (deltaX < 0 && this.callbacks.swipeLeft) {
          this.callbacks.swipeLeft(e);
        }
      } else {
        // Vertical swipe
        if (deltaY > 0 && this.callbacks.swipeDown) {
          this.callbacks.swipeDown(e);
        } else if (deltaY < 0 && this.callbacks.swipeUp) {
          this.callbacks.swipeUp(e);
        }
      }
    }
  }

  detectSwipe(e) {
    const deltaX = Math.abs(e.touches[0].clientX - this.startX);
    const deltaY = Math.abs(e.touches[0].clientY - this.startY);
    return deltaX > 10 || deltaY > 10;
  }

  on(gesture, callback) {
    if (this.callbacks.hasOwnProperty(gesture)) {
      this.callbacks[gesture] = callback;
    }
  }
}

/**
 * Mobile-optimized modal management
 */
export class MobileModal {
  constructor(element) {
    this.element = element;
    this.isOpen = false;
    this.gestureDetector = null;
  }

  open() {
    this.element.hidden = false;
    lockBodyScroll();
    this.isOpen = true;

    // Add swipe-down-to-close gesture
    if (isTouchDevice()) {
      const panel = this.element.querySelector('[class*="__panel"], [class*="__card"]');
      if (panel && !this.gestureDetector) {
        this.gestureDetector = new TouchGestureDetector(panel);
        this.gestureDetector.on('swipeDown', () => this.close());
      }
    }

    // Trigger animation
    requestAnimationFrame(() => {
      this.element.classList.add('modal--open');
    });
  }

  close() {
    this.element.hidden = true;
    unlockBodyScroll();
    this.isOpen = false;
    this.element.classList.remove('modal--open');
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
}

/**
 * Safe area padding helper
 */
export function applySafeAreaPadding(element) {
  if (!element) return;

  const style = element.style;
  style.paddingLeft = 'max(12px, env(safe-area-inset-left))';
  style.paddingRight = 'max(12px, env(safe-area-inset-right))';
  style.paddingBottom = 'max(12px, env(safe-area-inset-bottom))';
}

/**
 * Prevent zoom on input focus (iOS)
 */
export function preventIOSZoom() {
  const inputs = document.querySelectorAll('input, select, textarea');
  inputs.forEach((input) => {
    input.addEventListener('focus', () => {
      // Temporarily set font-size to prevent zoom
      const originalSize = window.getComputedStyle(input).fontSize;
      input.style.fontSize = '16px';

      setTimeout(() => {
        input.style.fontSize = originalSize;
      }, 100);
    });
  });
}

/**
 * Handle orientation changes
 */
export function onOrientationChange(callback) {
  window.addEventListener('orientationchange', () => {
    // Wait for layout to settle
    setTimeout(callback, 100);
  });

  window.addEventListener('resize', () => {
    // Detect if orientation changed
    const isPortrait = window.innerHeight > window.innerWidth;
    if (
      (isPortrait && window.lastOrientation === 'landscape') ||
      (!isPortrait && window.lastOrientation === 'portrait')
    ) {
      window.lastOrientation = isPortrait ? 'portrait' : 'landscape';
      callback();
    }
  });

  window.lastOrientation = window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
}

/**
 * Haptic feedback (vibration API)
 */
export function hapticFeedback(pattern = [10]) {
  if (navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

export function hapticTap() {
  hapticFeedback([10]);
}

export function hapticSuccess() {
  hapticFeedback([10, 20, 10]);
}

export function hapticError() {
  hapticFeedback([20, 10, 20]);
}

/**
 * Mobile-optimized toast notifications
 */
export function showMobileToast(message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'mobile-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 20px;
    right: 20px;
    padding: 16px;
    background: rgba(0, 0, 0, 0.9);
    color: white;
    border-radius: 12px;
    font-size: 14px;
    z-index: 9999;
    animation: toastSlideUp 0.3s ease-out;
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastSlideDown 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Initialize all mobile optimizations
 */
export function initMobileOptimizations() {
  if (!isMobileDevice() && !isTouchDevice()) {
    return; // Not a mobile device
  }

  // Fix viewport height
  fixMobileViewportHeight();

  // Prevent iOS zoom on input
  preventIOSZoom();

  // Handle orientation changes
  onOrientationChange(() => {
    // Trigger layout recalculation
    window.dispatchEvent(new Event('mobileOrientationChange'));
  });

  // Add mobile-specific body class
  document.body.classList.add('is-mobile');
}

/**
 * Mobile-specific scroll behavior
 */
export function enableMobileScrollOptimization() {
  // Use -webkit-overflow-scrolling for momentum scrolling on iOS
  const scrollableElements = document.querySelectorAll(
    '[class*="scroll"], [class*="overflow"]'
  );
  scrollableElements.forEach((el) => {
    el.style.webkitOverflowScrolling = 'touch';
  });
}

/**
 * Detect if in fullscreen mode
 */
export function isFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

/**
 * Request fullscreen (for immersive experience)
 */
export async function requestFullscreen(element = document.documentElement) {
  try {
    if (element.requestFullscreen) {
      await element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) {
      await element.webkitRequestFullscreen();
    } else if (element.mozRequestFullScreen) {
      await element.mozRequestFullScreen();
    } else if (element.msRequestFullscreen) {
      await element.msRequestFullscreen();
    }
  } catch (error) {
    console.error('Fullscreen request failed:', error);
  }
}

/**
 * Exit fullscreen
 */
export async function exitFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (document.webkitFullscreenElement) {
      await document.webkitExitFullscreen();
    } else if (document.mozFullScreenElement) {
      await document.mozCancelFullScreen();
    } else if (document.msFullscreenElement) {
      await document.msExitFullscreen();
    }
  } catch (error) {
    console.error('Exit fullscreen failed:', error);
  }
}

/**
 * Get safe area insets
 */
export function getSafeAreaInsets() {
  const root = document.documentElement;
  const style = getComputedStyle(root);

  return {
    top: parseFloat(style.getPropertyValue('--safe-area-inset-top') || '0'),
    right: parseFloat(style.getPropertyValue('--safe-area-inset-right') || '0'),
    bottom: parseFloat(style.getPropertyValue('--safe-area-inset-bottom') || '0'),
    left: parseFloat(style.getPropertyValue('--safe-area-inset-left') || '0'),
  };
}
