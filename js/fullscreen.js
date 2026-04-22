/**
 * TinyFin - Fullscreen/Immersive Mode Support
 * Hides Android system navigation bar for true fullscreen experience
 */

class FullscreenManager {
    constructor() {
        this.isFullscreen = false;
        this.init();
    }

    init() {
        // Try to enter fullscreen on first user interaction
        this.enableOnInteraction();
        
        // Re-enable fullscreen when visibility changes
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.requestFullscreen();
            }
        });

        // Handle fullscreen changes
        document.addEventListener('fullscreenchange', () => this.handleFullscreenChange());
        document.addEventListener('webkitfullscreenchange', () => this.handleFullscreenChange());
    }

    /**
     * Enable fullscreen on first user interaction
     */
    enableOnInteraction() {
        const events = ['touchstart', 'click', 'keydown'];
        
        const handler = () => {
            this.requestFullscreen();
            // Remove listeners after first interaction
            events.forEach(event => {
                document.removeEventListener(event, handler);
            });
        };

        events.forEach(event => {
            document.addEventListener(event, handler, { once: true });
        });
    }

    /**
     * Request fullscreen mode
     */
    requestFullscreen() {
        const elem = document.documentElement;

        // Try different fullscreen APIs
        if (elem.requestFullscreen) {
            elem.requestFullscreen({ navigationUI: 'hide' }).catch(err => {
                console.log('Fullscreen request failed:', err);
            });
        } else if (elem.webkitRequestFullscreen) {
            elem.webkitRequestFullscreen();
        } else if (elem.mozRequestFullScreen) {
            elem.mozRequestFullScreen();
        } else if (elem.msRequestFullscreen) {
            elem.msRequestFullscreen();
        }

        // Also try Android-specific immersive mode via screen orientation lock
        this.tryLockOrientation();
    }

    /**
     * Try to lock screen orientation (helps maintain fullscreen on Android)
     */
    tryLockOrientation() {
        try {
            if (screen.orientation && screen.orientation.lock) {
                screen.orientation.lock('landscape').catch(err => {
                    console.log('Orientation lock failed:', err);
                });
            }
        } catch (e) {
            console.log('Orientation lock not supported:', e);
        }
    }

    /**
     * Handle fullscreen state changes
     */
    handleFullscreenChange() {
        this.isFullscreen = !!(
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement
        );

        console.log('Fullscreen state:', this.isFullscreen ? 'ENABLED' : 'DISABLED');

        // If we exited fullscreen, try to re-enter after a delay
        if (!this.isFullscreen) {
            setTimeout(() => {
                this.requestFullscreen();
            }, 1000);
        }
    }

    /**
     * Exit fullscreen mode
     */
    exitFullscreen() {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

// Initialize fullscreen manager
window.fullscreenManager = new FullscreenManager();
