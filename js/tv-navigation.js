/**
 * TinyFin - Android TV Navigation Support
 * Adds D-pad/remote control navigation for TV devices
 */

class TVNavigation {
    constructor(app) {
        this.app = app;
        this.currentFocusIndex = 0;
        this.focusableElements = [];
        this.isEnabled = this.detectTV();
        this.gridColumns = 3; // Default for content grid
        
        console.log('TinyFin TV Navigation:', {
            enabled: this.isEnabled,
            url: window.location.href,
            localStorage: localStorage.getItem('tinyfin_tvMode')
        });
        
        if (this.isEnabled) {
            console.log('✅ TV mode ENABLED - D-pad navigation active');
            console.log('Use arrow keys to navigate, Enter to select, Escape to go back');
            this.init();
        } else {
            console.log('ℹ️ TV mode disabled. Add ?tv=1 to URL to enable TV mode');
        }
    }

    /**
     * Detect if running on Android TV or similar device
     * Checks for ?tv=1 URL parameter or localStorage setting
     */
    detectTV() {
        // Check URL parameter first
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('tv') === '1') {
            // Save to localStorage so it persists
            localStorage.setItem('tinyfin_tvMode', 'true');
            return true;
        }
        
        // Check localStorage for saved TV mode preference
        if (localStorage.getItem('tinyfin_tvMode') === 'true') {
            return true;
        }
        
        return false;
    }

    /**
     * Initialize TV navigation
     */
    init() {
        // Add TV mode class to body
        document.body.classList.add('tv-mode');
        
        // Bind keyboard events
        this.bindKeyboardEvents();
        
        // Update focusable elements when screen changes
        this.setupObservers();
        
        // Initial focus
        setTimeout(() => this.updateFocusableElements(), 100);
    }

    /**
     * Bind keyboard/remote control events
     */
    bindKeyboardEvents() {
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));
    }

    /**
     * Setup observers to detect screen changes
     */
    setupObservers() {
        // Observe screen changes
        const screens = [this.app.setupScreen, this.app.homeScreen, this.app.playerScreen];
        
        const observer = new MutationObserver(() => {
            setTimeout(() => this.updateFocusableElements(), 50);
        });
        
        screens.forEach(screen => {
            observer.observe(screen, { 
                attributes: true, 
                attributeFilter: ['class'] 
            });
        });

        // Also observe content grid changes
        const gridObserver = new MutationObserver(() => {
            setTimeout(() => this.updateFocusableElements(), 50);
        });
        
        gridObserver.observe(this.app.contentGrid, { 
            childList: true, 
            subtree: true 
        });
    }

    /**
     * Handle keyboard/remote key presses
     */
    handleKeyPress(e) {
        if (!this.isEnabled) return;

        const key = e.key;
        
        // D-pad navigation
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
            e.preventDefault();
            this.navigate(key);
            return;
        }

        // Enter/Select key
        if (key === 'Enter' || key === ' ') {
            e.preventDefault();
            this.activateFocusedElement();
            return;
        }

        // Back button (Escape or Back)
        if (key === 'Escape' || key === 'Backspace') {
            e.preventDefault();
            this.handleBack();
            return;
        }

        // Play/Pause (MediaPlayPause, 'k', or spacebar in player)
        if (key === 'MediaPlayPause' || (key === 'k' && this.isPlayerActive())) {
            e.preventDefault();
            if (this.isPlayerActive()) {
                this.app.togglePlayPause();
            }
            return;
        }
    }

    /**
     * Navigate with D-pad
     */
    navigate(direction) {
        this.updateFocusableElements();
        
        if (this.focusableElements.length === 0) return;

        let newIndex = this.currentFocusIndex;

        // Check if we're in a grid layout (home screen)
        if (this.isHomeScreenActive()) {
            newIndex = this.navigateGrid(direction);
        } else {
            // Linear navigation for setup and other screens
            newIndex = this.navigateLinear(direction);
        }

        if (newIndex !== this.currentFocusIndex && newIndex >= 0 && newIndex < this.focusableElements.length) {
            this.currentFocusIndex = newIndex;
            this.focusElement(this.focusableElements[newIndex]);
        }
    }

    /**
     * Navigate in grid layout (content cards)
     */
    navigateGrid(direction) {
        const total = this.focusableElements.length;
        let newIndex = this.currentFocusIndex;

        // Calculate grid columns dynamically based on visible nav buttons
        const navButtons = this.focusableElements.filter(el => el.classList.contains('nav-btn'));
        const contentCards = this.focusableElements.filter(el => el.classList.contains('content-card'));
        
        // If we're in nav buttons
        if (this.focusableElements[this.currentFocusIndex].classList.contains('nav-btn')) {
            const navIndex = navButtons.indexOf(this.focusableElements[this.currentFocusIndex]);
            
            switch (direction) {
                case 'ArrowLeft':
                    if (navIndex > 0) {
                        return this.focusableElements.indexOf(navButtons[navIndex - 1]);
                    }
                    break;
                case 'ArrowRight':
                    if (navIndex < navButtons.length - 1) {
                        return this.focusableElements.indexOf(navButtons[navIndex + 1]);
                    }
                    break;
                case 'ArrowDown':
                    // Move to first content card
                    if (contentCards.length > 0) {
                        return this.focusableElements.indexOf(contentCards[0]);
                    }
                    break;
            }
            return newIndex;
        }

        // If we're in content cards
        if (this.focusableElements[this.currentFocusIndex].classList.contains('content-card')) {
            const cardIndex = contentCards.indexOf(this.focusableElements[this.currentFocusIndex]);
            const cols = this.gridColumns;
            
            switch (direction) {
                case 'ArrowLeft':
                    if (cardIndex % cols !== 0) {
                        return this.focusableElements.indexOf(contentCards[cardIndex - 1]);
                    }
                    break;
                case 'ArrowRight':
                    if (cardIndex % cols !== cols - 1 && cardIndex < contentCards.length - 1) {
                        return this.focusableElements.indexOf(contentCards[cardIndex + 1]);
                    }
                    break;
                case 'ArrowUp':
                    if (cardIndex >= cols) {
                        return this.focusableElements.indexOf(contentCards[cardIndex - cols]);
                    } else {
                        // Move to nav buttons
                        if (navButtons.length > 0) {
                            return this.focusableElements.indexOf(navButtons[0]);
                        }
                    }
                    break;
                case 'ArrowDown':
                    if (cardIndex + cols < contentCards.length) {
                        return this.focusableElements.indexOf(contentCards[cardIndex + cols]);
                    }
                    break;
            }
        }

        return newIndex;
    }

    /**
     * Navigate linearly (setup screen, modals)
     */
    navigateLinear(direction) {
        const total = this.focusableElements.length;
        let newIndex = this.currentFocusIndex;

        switch (direction) {
            case 'ArrowUp':
            case 'ArrowLeft':
                newIndex = this.currentFocusIndex > 0 ? this.currentFocusIndex - 1 : total - 1;
                break;
            case 'ArrowDown':
            case 'ArrowRight':
                newIndex = this.currentFocusIndex < total - 1 ? this.currentFocusIndex + 1 : 0;
                break;
        }

        return newIndex;
    }

    /**
     * Update the list of focusable elements
     */
    updateFocusableElements() {
        // Get currently visible screen
        let activeScreen = null;
        if (!this.app.setupScreen.classList.contains('hidden')) {
            activeScreen = this.app.setupScreen;
        } else if (!this.app.homeScreen.classList.contains('hidden')) {
            activeScreen = this.app.homeScreen;
        } else if (!this.app.playerScreen.classList.contains('hidden')) {
            activeScreen = this.app.playerScreen;
        }

        if (!activeScreen) return;

        // Find all focusable elements in active screen
        const selectors = [
            'input:not([disabled])',
            'button:not([disabled]):not(.hidden)',
            '.content-card',
            '.nav-btn:not(.hidden)',
            'a[href]'
        ];

        this.focusableElements = Array.from(
            activeScreen.querySelectorAll(selectors.join(','))
        ).filter(el => {
            // Filter out hidden elements
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
        });

        // Ensure current index is valid
        if (this.currentFocusIndex >= this.focusableElements.length) {
            this.currentFocusIndex = Math.max(0, this.focusableElements.length - 1);
        }

        // Focus first element if nothing focused
        if (this.focusableElements.length > 0 && !document.activeElement?.matches(selectors.join(','))) {
            this.focusElement(this.focusableElements[this.currentFocusIndex]);
        }
    }

    /**
     * Focus an element with visual feedback
     */
    focusElement(element) {
        if (!element) return;

        // Remove previous focus
        this.focusableElements.forEach(el => el.classList.remove('tv-focused'));

        // Add focus class
        element.classList.add('tv-focused');
        
        // Actually focus the element
        element.focus();

        // Scroll element into view if needed
        element.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'nearest',
            inline: 'nearest'
        });
    }

    /**
     * Activate the currently focused element
     */
    activateFocusedElement() {
        const element = this.focusableElements[this.currentFocusIndex];
        if (!element) return;

        if (element.tagName === 'INPUT') {
            // For inputs, just focus (virtual keyboard will appear)
            element.focus();
        } else {
            // For buttons/cards, trigger click
            element.click();
        }
    }

    /**
     * Handle back button
     */
    handleBack() {
        // If player is active, exit it
        if (this.isPlayerActive()) {
            this.app.exitPlayer();
            return;
        }

        // If settings modal is open, close it
        if (!this.app.settingsModal.classList.contains('hidden')) {
            this.app.hideSettings();
            return;
        }

        // If delete confirm modal is open, close it
        if (!this.app.deleteConfirmModal.classList.contains('hidden')) {
            this.app.hideDeleteConfirmation();
            return;
        }
    }

    /**
     * Check if home screen is active
     */
    isHomeScreenActive() {
        return !this.app.homeScreen.classList.contains('hidden');
    }

    /**
     * Check if player is active
     */
    isPlayerActive() {
        return !this.app.playerScreen.classList.contains('hidden');
    }
}

// Initialize TV navigation when app is ready
window.addEventListener('DOMContentLoaded', () => {
    // Wait for app to be initialized
    const checkApp = setInterval(() => {
        if (window.app) {
            window.tvNavigation = new TVNavigation(window.app);
            clearInterval(checkApp);
        }
    }, 100);
});
