/**
 * TinyFin - Main Application
 * Jellyfin client for kids - YouTube Kids inspired UI
 */

class TinyFinApp {
    constructor() {
        // Screens
        this.setupScreen = document.getElementById('setup-screen');
        this.homeScreen = document.getElementById('home-screen');
        this.playerScreen = document.getElementById('player-screen');
        
        // Setup elements
        this.serverUrlInput = document.getElementById('server-url');
        this.usernameInput = document.getElementById('username');
        this.passwordInput = document.getElementById('password');
        this.connectBtn = document.getElementById('connect-btn');
        this.setupError = document.getElementById('setup-error');
        
        // Home elements
        this.contentGrid = document.getElementById('content-grid');
        this.navButtons = document.querySelectorAll('.nav-btn[data-filter]');
        this.settingsBtn = document.querySelector('.settings-btn');
        this.loading = document.getElementById('loading');
        
        // Player elements
        this.videoPlayer = document.getElementById('video-player');
        this.playerOverlay = document.getElementById('player-overlay');
        this.playPauseBtn = document.getElementById('play-pause-btn');
        this.backBtn = document.getElementById('back-btn');
        this.relatedDrawer = document.getElementById('related-drawer');
        this.drawerContent = document.getElementById('drawer-content');
        this.swipeHint = document.getElementById('swipe-hint');
        
        // Settings modal
        this.settingsModal = document.getElementById('settings-modal');
        this.logoutBtn = document.getElementById('logout-btn');
        this.clearDownloadsBtn = document.getElementById('clear-downloads-btn');
        this.closeSettingsBtn = document.getElementById('close-settings');
        
        // State
        this.currentFilter = 'all';
        this.currentItem = null;
        this.playbackInfo = null;
        this.allItems = [];
        this.isDrawerOpen = false;
        this.touchStartY = 0;
        this.progressInterval = null;
        this.hls = null; // HLS.js instance
        
        // Pagination state
        this.pageSize = 30;
        this.currentPage = 0;
        this.totalItems = 0;
        this.isLoadingMore = false;
        this.hasMoreItems = true;
        
        // Playback state
        this.isStartingPlayback = false;
        
        // Download state - track which items are downloaded (loaded on init)
        this.downloadedItemIds = new Set();
        
        this.init();
    }

    async init() {
        this.bindEvents();
        
        // Initialize download manager
        await this.initDownloadManager();
        
        // Check for saved session
        try {
            const isValid = await jellyfinAPI.validateSession();
            if (isValid) {
                this.showHome();
            } else {
                this.showSetup();
            }
        } catch (error) {
            console.log('Init error (likely harmless):', error);
            this.showSetup();
        }
    }
    
    /**
     * Initialize download manager and set up listeners
     */
    async initDownloadManager() {
        try {
            await downloadManager.init();
            
            // Load downloaded item IDs for quick lookup
            const downloadedItems = await downloadManager.getDownloadedItems();
            this.downloadedItemIds = new Set(downloadedItems.map(item => item.itemId));
            console.log('Downloaded items:', this.downloadedItemIds.size);
            
            // Listen for download events
            downloadManager.addListener((event, data) => this.handleDownloadEvent(event, data));
        } catch (error) {
            console.warn('Failed to initialize download manager:', error);
        }
    }
    
    /**
     * Handle download manager events
     */
    handleDownloadEvent(event, data) {
        console.log('Download event:', event, data);
        
        switch (event) {
            case 'downloadStarted':
                this.updateCardDownloadState(data.itemId, 'downloading', 0);
                break;
                
            case 'downloadProgress':
                this.updateCardDownloadState(data.itemId, 'downloading', data.progress);
                break;
                
            case 'downloadComplete':
                this.downloadedItemIds.add(data.itemId);
                this.updateCardDownloadState(data.itemId, 'downloaded');
                break;
                
            case 'downloadCancelled':
            case 'downloadError':
                this.updateCardDownloadState(data.itemId, 'none');
                break;
                
            case 'downloadDeleted':
                this.downloadedItemIds.delete(data.itemId);
                this.updateCardDownloadState(data.itemId, 'none');
                // Refresh if we're viewing downloads
                if (this.currentFilter === 'downloads') {
                    this.loadContent();
                }
                break;
        }
    }
    
    /**
     * Update the download state visual on a card
     */
    updateCardDownloadState(itemId, state, progress = 0) {
        const card = document.querySelector(`.content-card[data-id="${itemId}"]`);
        if (!card) return;
        
        // Remove existing download UI
        const existingBtn = card.querySelector('.download-btn');
        const existingProgress = card.querySelector('.download-progress');
        const existingBadge = card.querySelector('.downloaded-badge');
        
        existingBtn?.remove();
        existingProgress?.remove();
        existingBadge?.remove();
        
        // Add new UI based on state
        if (state === 'downloading') {
            card.insertAdjacentHTML('beforeend', this.createDownloadProgressUI(progress));
        } else if (state === 'downloaded') {
            card.insertAdjacentHTML('beforeend', this.createDownloadedBadgeUI());
        } else {
            // Add download button back
            const btn = this.createDownloadButtonUI();
            card.insertAdjacentHTML('beforeend', btn);
            // Re-attach event listener
            const newBtn = card.querySelector('.download-btn');
            if (newBtn) {
                newBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleDownloadClick(itemId);
                });
            }
        }
    }
    
    /**
     * Create download button HTML
     */
    createDownloadButtonUI() {
        return `
            <button class="download-btn" aria-label="Download">
                <svg viewBox="0 0 24 24">
                    <path d="M12 4v12M8 12l4 4 4-4" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M6 18h12" stroke="white" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </button>
        `;
    }
    
    /**
     * Create download progress ring HTML
     */
    createDownloadProgressUI(progress) {
        const circumference = 2 * Math.PI * 18; // radius = 18
        
        // Handle indeterminate state (progress = -1)
        if (progress < 0) {
            return `
                <div class="download-progress indeterminate">
                    <svg viewBox="0 0 44 44">
                        <circle cx="22" cy="22" r="20"/>
                        <circle class="progress-ring" cx="22" cy="22" r="18" 
                                stroke-dasharray="${circumference * 0.25} ${circumference * 0.75}"/>
                    </svg>
                </div>
            `;
        }
        
        const offset = circumference - (progress / 100) * circumference;
        
        return `
            <div class="download-progress">
                <svg viewBox="0 0 44 44">
                    <circle cx="22" cy="22" r="20"/>
                    <circle class="progress-ring" cx="22" cy="22" r="18" 
                            stroke-dasharray="${circumference}" 
                            stroke-dashoffset="${offset}"/>
                </svg>
            </div>
        `;
    }
    
    /**
     * Create downloaded badge HTML
     */
    createDownloadedBadgeUI() {
        return `
            <div class="downloaded-badge">
                <svg viewBox="0 0 24 24">
                    <path d="M9 12l2 2 4-4" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
        `;
    }
    
    /**
     * Handle download button click
     */
    async handleDownloadClick(itemId) {
        // Check if already downloading
        if (downloadManager.isDownloading(itemId)) {
            // Cancel download
            downloadManager.cancelDownload(itemId);
            return;
        }
        
        // Check if already downloaded
        if (await downloadManager.isDownloaded(itemId)) {
            // Show delete confirmation (long press is handled separately)
            return;
        }
        
        // Start download
        try {
            // Get item details
            const item = await jellyfinAPI.getItem(itemId);
            
            // Get playback info to get the stream URL
            const playbackInfo = await jellyfinAPI.getPlaybackInfo(itemId);
            const mediaSource = playbackInfo.MediaSources[0];
            const playSessionId = playbackInfo.PlaySessionId;
            
            // Find preferred audio stream
            const audioStreamIndex = jellyfinAPI.findPreferredAudioStream(mediaSource);
            
            // For download, we want a direct MP4 stream (not HLS)
            // Use a lower bitrate progressive download
            const streamUrl = this.getDownloadStreamUrl(itemId, mediaSource.Id, playSessionId, audioStreamIndex);
            
            // Get thumbnail URL
            const thumbnailUrl = jellyfinAPI.getThumbUrl(item, { width: 400, height: 225 });
            
            // Start download
            downloadManager.downloadItem(item, streamUrl, thumbnailUrl);
            
        } catch (error) {
            console.error('Failed to start download:', error);
        }
    }
    
    /**
     * Get a download-friendly stream URL
     * 
     * Uses WebM container with VP8/Vorbis which supports streaming writes
     * (no moov atom issue like MP4). This allows transcoding to complete
     * properly even when downloaded progressively.
     */
    getDownloadStreamUrl(itemId, mediaSourceId, playSessionId, audioStreamIndex) {
        const params = new URLSearchParams({
            UserId: jellyfinAPI.userId,
            MediaSourceId: mediaSourceId,
            PlaySessionId: playSessionId,
            api_key: jellyfinAPI.accessToken,
            DeviceId: jellyfinAPI.deviceId,
            
            // Use WebM - better for progressive download (no moov atom issue)
            Container: 'webm',
            VideoCodec: 'vp8',
            AudioCodec: 'vorbis',
            
            // Video settings - 360p
            MaxWidth: 640,
            MaxHeight: 360,
            VideoBitRate: 800000,
            
            // Audio settings
            AudioBitRate: 96000,
            MaxAudioChannels: 2
        });
        
        if (audioStreamIndex !== null) {
            params.set('AudioStreamIndex', audioStreamIndex);
        }
        
        return `${jellyfinAPI.serverUrl}/Videos/${itemId}/stream.webm?${params}`;
    }
    
    /**
     * Handle long press on downloaded items (for deletion)
     */
    handleLongPress(itemId) {
        if (this.downloadedItemIds.has(itemId)) {
            this.showDeleteConfirmation(itemId);
        }
    }
    
    /**
     * Show delete confirmation for a download
     */
    async showDeleteConfirmation(itemId) {
        // Simple confirm using a visual indicator - tap the downloaded badge again
        // For now, just delete directly (can add confirmation modal later)
        try {
            await downloadManager.deleteDownload(itemId);
        } catch (error) {
            console.error('Failed to delete download:', error);
        }
    }

    bindEvents() {
        // Setup events
        this.connectBtn.addEventListener('click', () => this.handleConnect());
        this.serverUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.usernameInput.focus();
        });
        this.usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.passwordInput.focus();
        });
        this.passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleConnect();
        });
        
        // Navigation events
        this.navButtons.forEach(btn => {
            btn.addEventListener('click', () => this.handleNavigation(btn.dataset.filter));
        });
        
        // Settings events
        this.settingsBtn.addEventListener('click', () => this.showSettings());
        this.logoutBtn.addEventListener('click', () => this.handleLogout());
        this.clearDownloadsBtn.addEventListener('click', () => this.handleClearDownloads());
        this.closeSettingsBtn.addEventListener('click', () => this.hideSettings());
        this.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.settingsModal) this.hideSettings();
        });
        
        // Player events
        this.videoPlayer.addEventListener('click', () => this.toggleOverlay());
        this.playPauseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePlayPause();
        });
        this.backBtn.addEventListener('click', () => this.exitPlayer());
        
        this.videoPlayer.addEventListener('play', () => {
            this.updatePlayPauseIcon(true);
            // Hide overlay when video starts playing
            this.playerOverlay.classList.remove('visible');
        });
        this.videoPlayer.addEventListener('pause', () => this.updatePlayPauseIcon(false));
        this.videoPlayer.addEventListener('ended', () => this.handleVideoEnded());
        
        // Drawer swipe handling
        this.playerScreen.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: true });
        this.playerScreen.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        this.playerScreen.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: true });
        
        // Online/offline events
        window.addEventListener('online', () => {
            console.log('Back online');
            this.updateOfflineIndicator();
            // Refresh content when back online
            if (this.homeScreen && !this.homeScreen.classList.contains('hidden')) {
                this.loadContent();
            }
        });
        
        window.addEventListener('offline', () => {
            console.log('Gone offline');
            this.updateOfflineIndicator();
        });
        
        // Infinite scroll - listen on home screen element
        let scrollTimeout = null;
        const scrollHandler = () => {
            if (!scrollTimeout) {
                scrollTimeout = setTimeout(() => {
                    scrollTimeout = null;
                    this.handleScroll();
                }, 100);
            }
        };
        
        // Listen on home screen (which now scrolls)
        this.homeScreen.addEventListener('scroll', scrollHandler, { passive: true });
        
        // Also check on touchend for mobile momentum scrolling
        this.homeScreen.addEventListener('touchend', () => {
            setTimeout(() => this.handleScroll(), 300);
        }, { passive: true });
        
        // Hide overlay after inactivity
        let overlayTimeout;
        this.playerScreen.addEventListener('touchstart', () => {
            clearTimeout(overlayTimeout);
            if (!this.isDrawerOpen) {
                this.playerOverlay.classList.add('visible');
                overlayTimeout = setTimeout(() => {
                    if (!this.videoPlayer.paused) {
                        this.playerOverlay.classList.remove('visible');
                    }
                }, 3000);
            }
        });
    }

    // ==================== SCREEN MANAGEMENT ====================

    showScreen(screen) {
        [this.setupScreen, this.homeScreen, this.playerScreen].forEach(s => {
            s.classList.add('hidden');
        });
        screen.classList.remove('hidden');
    }

    showSetup() {
        this.showScreen(this.setupScreen);
        // Pre-fill saved server URL if available
        const savedUrl = localStorage.getItem('tinyfin_lastServerUrl');
        if (savedUrl) this.serverUrlInput.value = savedUrl;
    }

    async showHome() {
        this.showScreen(this.homeScreen);
        await this.loadContent();
    }

    showPlayer() {
        this.showScreen(this.playerScreen);
        // Reset overlay state - hide it initially
        this.playerOverlay.classList.remove('visible');
        this.swipeHint.classList.add('visible');
        setTimeout(() => this.swipeHint.classList.remove('visible'), 5000);
    }

    showSettings() {
        this.settingsModal.classList.remove('hidden');
    }

    hideSettings() {
        this.settingsModal.classList.add('hidden');
    }

    // ==================== AUTHENTICATION ====================

    async handleConnect() {
        const serverUrl = this.serverUrlInput.value.trim();
        const username = this.usernameInput.value.trim();
        const password = this.passwordInput.value;

        if (!serverUrl || !username) {
            this.showError('Please fill in all fields');
            return;
        }

        this.setLoading(true);
        this.hideError();

        try {
            // Save server URL for next time
            localStorage.setItem('tinyfin_lastServerUrl', serverUrl);
            
            await jellyfinAPI.connect(serverUrl, username, password);
            this.showHome();
        } catch (error) {
            console.error('Connection failed:', error);
            this.showError('Connection failed. Please check your details.');
        } finally {
            this.setLoading(false);
        }
    }

    handleLogout() {
        jellyfinAPI.clearCredentials();
        this.hideSettings();
        this.passwordInput.value = '';
        this.showSetup();
    }
    
    async handleClearDownloads() {
        try {
            await downloadManager.clearAllDownloads();
            this.downloadedItemIds.clear();
            
            // Refresh if viewing downloads
            if (this.currentFilter === 'downloads') {
                this.loadContent();
            }
            
            this.hideSettings();
            console.log('All downloads cleared');
        } catch (error) {
            console.error('Failed to clear downloads:', error);
        }
    }

    showError(message) {
        this.setupError.textContent = message;
        this.setupError.classList.add('visible');
    }

    hideError() {
        this.setupError.classList.remove('visible');
    }

    // ==================== CONTENT LOADING ====================

    setLoading(show) {
        this.loading.classList.toggle('hidden', !show);
    }

    /**
     * Save content to localStorage for offline access
     */
    cacheContent(filter, items) {
        try {
            const cacheKey = `tinyfin_content_${filter}`;
            const cacheData = {
                timestamp: Date.now(),
                items: items
            };
            localStorage.setItem(cacheKey, JSON.stringify(cacheData));
        } catch (e) {
            console.warn('Failed to cache content:', e);
        }
    }

    /**
     * Load cached content from localStorage
     */
    loadCachedContent(filter) {
        try {
            const cacheKey = `tinyfin_content_${filter}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const data = JSON.parse(cached);
                // Cache is valid for 24 hours
                if (Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
                    return data.items;
                }
            }
        } catch (e) {
            console.warn('Failed to load cached content:', e);
        }
        return null;
    }

    /**
     * Check if we're online
     */
    isOnline() {
        return navigator.onLine;
    }

    /**
     * Update offline indicator
     */
    updateOfflineIndicator() {
        const indicator = document.getElementById('offline-indicator');
        if (indicator) {
            indicator.classList.toggle('hidden', this.isOnline());
        }
    }

    /**
     * Reset pagination state
     */
    resetPagination() {
        this.currentPage = 0;
        this.totalItems = 0;
        this.allItems = [];
        this.hasMoreItems = true;
        this.isLoadingMore = false;
    }

    /**
     * Load content with pagination (initial load)
     */
    async loadContent() {
        this.resetPagination();
        this.setLoading(true);
        this.contentGrid.innerHTML = '';

        try {
            // Special handling for downloads filter
            if (this.currentFilter === 'downloads') {
                await this.loadDownloadedContent();
                this.setLoading(false);
                return;
            }
            
            let fromCache = false;

            // Try loading from network first
            if (this.isOnline()) {
                try {
                    await this.fetchPage(0);
                } catch (error) {
                    console.warn('Network request failed, trying cache:', error);
                    this.allItems = this.loadCachedContent(this.currentFilter) || [];
                    this.hasMoreItems = false;
                    fromCache = true;
                }
            } else {
                // Offline - load from cache
                console.log('Offline, loading from cache');
                this.allItems = this.loadCachedContent(this.currentFilter) || [];
                this.hasMoreItems = false;
                fromCache = true;
            }

            this.renderContent(this.allItems);
            this.updateOfflineIndicator();
            
            if (fromCache && this.allItems.length > 0) {
                console.log('Showing cached content');
            }
        } catch (error) {
            console.error('Failed to load content:', error);
            this.contentGrid.innerHTML = this.createEmptyState();
        } finally {
            this.setLoading(false);
        }
    }
    
    /**
     * Load downloaded content from IndexedDB
     */
    async loadDownloadedContent() {
        try {
            const downloadedItems = await downloadManager.getDownloadedItems();
            
            if (downloadedItems.length === 0) {
                this.contentGrid.innerHTML = this.createEmptyState();
                return;
            }
            
            // Convert stored items to displayable format
            this.allItems = downloadedItems.map(d => d.item);
            this.hasMoreItems = false;
            
            // Render with special handling for thumbnails
            this.contentGrid.innerHTML = '';
            
            for (const downloadedItem of downloadedItems) {
                const item = downloadedItem.item;
                
                // Try to get cached thumbnail
                let thumbnailUrl = null;
                try {
                    thumbnailUrl = await downloadManager.getThumbnailUrl(item.Id);
                } catch (e) {
                    // Fall back to server thumbnail if available
                    if (this.isOnline()) {
                        thumbnailUrl = jellyfinAPI.getThumbUrl(item, { width: 400, height: 225 });
                    }
                }
                
                const cardHtml = this.createDownloadedContentCard(item, thumbnailUrl);
                this.contentGrid.insertAdjacentHTML('beforeend', cardHtml);
            }
            
            // Attach event handlers
            this.attachCardEventHandlers(this.contentGrid);
            
        } catch (error) {
            console.error('Failed to load downloaded content:', error);
            this.contentGrid.innerHTML = this.createEmptyState();
        }
    }
    
    /**
     * Create a content card for downloaded items (with local thumbnail)
     */
    createDownloadedContentCard(item, thumbnailUrl) {
        const isEpisode = item.Type === 'Episode';
        
        const placeholder = `data:image/svg+xml,${encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225">
                <rect fill="#E0E0E0" width="400" height="225"/>
                <polygon points="180,90 180,135 215,112.5" fill="#BDBDBD"/>
            </svg>
        `)}`;
        
        let badges = this.createDownloadedBadgeUI();
        
        if (isEpisode && item.IndexNumber) {
            badges += `<div class="episode-badge">${item.IndexNumber}</div>`;
        }
        
        return `
            <div class="content-card" data-id="${item.Id}" data-type="${item.Type}" data-series-id="${item.SeriesId || ''}">
                <img src="${thumbnailUrl || placeholder}" 
                     alt="" 
                     onerror="this.src='${placeholder}'">
                <div class="play-overlay">
                    <svg viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.9)"/>
                        <polygon points="10,8 10,16 16,12" fill="#333"/>
                    </svg>
                </div>
                ${badges}
            </div>
        `;
    }

    /**
     * Fetch a specific page of content
     */
    async fetchPage(page) {
        const startIndex = page * this.pageSize;
        let result;

        switch (this.currentFilter) {
            case 'favorites':
                result = await jellyfinAPI.getFavorites(this.pageSize, startIndex);
                break;
            case 'recent':
                result = await jellyfinAPI.getRecentlyPlayed(this.pageSize, startIndex);
                break;
            default:
                result = await jellyfinAPI.getAllItems({ 
                    sortBy: 'SortName', 
                    limit: this.pageSize,
                    startIndex: startIndex
                });
        }

        const newItems = result.Items || [];
        this.totalItems = result.TotalRecordCount || 0;
        
        // Append to existing items
        this.allItems = [...this.allItems, ...newItems];
        
        // Check if there are more items
        this.hasMoreItems = this.allItems.length < this.totalItems;
        this.currentPage = page;

        console.log('fetchPage complete', {
            page,
            newItems: newItems.length,
            totalLoaded: this.allItems.length,
            totalItems: this.totalItems,
            hasMoreItems: this.hasMoreItems
        });

        // Cache all items we've loaded so far
        this.cacheContent(this.currentFilter, this.allItems);

        return newItems;
    }

    /**
     * Load more content (infinite scroll)
     */
    async loadMoreContent() {
        console.log('loadMoreContent called', {
            isLoadingMore: this.isLoadingMore,
            hasMoreItems: this.hasMoreItems,
            isOnline: this.isOnline(),
            currentPage: this.currentPage,
            totalItems: this.totalItems,
            loadedItems: this.allItems.length
        });

        if (this.isLoadingMore || !this.hasMoreItems || !this.isOnline()) {
            console.log('Skipping load - conditions not met');
            return;
        }

        this.isLoadingMore = true;
        this.showLoadingMore(true);

        try {
            const newItems = await this.fetchPage(this.currentPage + 1);
            console.log('Fetched new items:', newItems.length);
            this.appendContent(newItems);
        } catch (error) {
            console.error('Failed to load more content:', error);
        } finally {
            this.isLoadingMore = false;
            this.showLoadingMore(false);
        }
    }

    /**
     * Show/hide the "loading more" indicator
     */
    showLoadingMore(show) {
        let indicator = document.getElementById('loading-more');
        if (show && !indicator) {
            indicator = document.createElement('div');
            indicator.id = 'loading-more';
            indicator.className = 'loading-more';
            indicator.innerHTML = '<div class="spinner-small"></div>';
            this.contentGrid.parentNode.appendChild(indicator);
        } else if (!show && indicator) {
            indicator.remove();
        }
    }

    /**
     * Append new content cards to the grid
     */
    appendContent(items) {
        if (!items.length) return;

        const temp = document.createElement('div');
        temp.innerHTML = items.map(item => this.createContentCard(item)).join('');
        
        // Attach event handlers
        this.attachCardEventHandlers(temp);
        
        // Move cards to grid
        while (temp.firstChild) {
            this.contentGrid.appendChild(temp.firstChild);
        }
    }

    /**
     * Handle scroll for infinite loading
     */
    handleScroll() {
        // Only handle scroll when on home screen
        if (this.homeScreen.classList.contains('hidden')) {
            return;
        }

        // Home screen is the scrolling container
        const container = this.homeScreen;
        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

        if (!this.hasMoreItems || this.isLoadingMore) {
            return;
        }

        // Load more when user scrolls near bottom
        if (distanceFromBottom < 400) {
            console.log('Triggering load more', { distanceFromBottom, scrollTop, scrollHeight, clientHeight });
            this.loadMoreContent();
        }
    }

    renderContent(items) {
        if (!items.length) {
            this.contentGrid.innerHTML = this.createEmptyState();
            return;
        }

        this.contentGrid.innerHTML = items.map(item => this.createContentCard(item)).join('');

        // Add click handlers
        this.attachCardEventHandlers(this.contentGrid);
    }
    
    /**
     * Attach event handlers to content cards
     */
    attachCardEventHandlers(container) {
        container.querySelectorAll('.content-card').forEach(card => {
            const itemId = card.dataset.id;
            
            // Play on click
            card.addEventListener('click', (e) => {
                // Don't play if clicking download button
                if (e.target.closest('.download-btn') || e.target.closest('.downloaded-badge')) {
                    return;
                }
                this.playItem(itemId);
            });
            
            // Download button click
            const downloadBtn = card.querySelector('.download-btn');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleDownloadClick(itemId);
                });
            }
            
            // Long press on downloaded badge to delete
            const downloadedBadge = card.querySelector('.downloaded-badge');
            if (downloadedBadge) {
                let longPressTimer;
                
                downloadedBadge.addEventListener('touchstart', (e) => {
                    e.stopPropagation();
                    longPressTimer = setTimeout(() => {
                        this.showDeleteConfirmation(itemId);
                    }, 800);
                }, { passive: true });
                
                downloadedBadge.addEventListener('touchend', () => {
                    clearTimeout(longPressTimer);
                }, { passive: true });
                
                downloadedBadge.addEventListener('touchmove', () => {
                    clearTimeout(longPressTimer);
                }, { passive: true });
            }
        });
    }

    createContentCard(item, showEpisodeNumber = false) {
        const imageUrl = jellyfinAPI.getThumbUrl(item, { width: 400, height: 225 });
        const isFavorite = item.UserData?.IsFavorite;
        const isEpisode = item.Type === 'Episode';
        const isDownloaded = this.downloadedItemIds.has(item.Id);
        const isDownloading = downloadManager.isDownloading(item.Id);
        
        let badges = '';
        
        // Download state (top-left)
        if (isDownloaded) {
            badges += this.createDownloadedBadgeUI();
        } else if (isDownloading) {
            const progress = downloadManager.getProgress(item.Id);
            badges += this.createDownloadProgressUI(progress);
        } else {
            // Show download button only when online
            if (this.isOnline()) {
                badges += this.createDownloadButtonUI();
            }
        }
        
        // Favorite badge (top-right)
        if (isFavorite) {
            badges += `
                <div class="favorite-badge">
                    <svg viewBox="0 0 24 24">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#E91E63"/>
                    </svg>
                </div>
            `;
        }

        // Series badge (bottom-left)
        if (isEpisode && !showEpisodeNumber) {
            badges += `
                <div class="series-badge">
                    <svg viewBox="0 0 24 24">
                        <rect x="3" y="3" width="7" height="7" rx="1" fill="white"/>
                        <rect x="14" y="3" width="7" height="7" rx="1" fill="white"/>
                        <rect x="3" y="14" width="7" height="7" rx="1" fill="white"/>
                        <rect x="14" y="14" width="7" height="7" rx="1" fill="white"/>
                    </svg>
                </div>
            `;
        }

        // Episode number badge (bottom-right)
        if (isEpisode && showEpisodeNumber && item.IndexNumber) {
            badges += `<div class="episode-badge">${item.IndexNumber}</div>`;
        }

        const placeholder = `data:image/svg+xml,${encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225">
                <rect fill="#E0E0E0" width="400" height="225"/>
                <polygon points="180,90 180,135 215,112.5" fill="#BDBDBD"/>
            </svg>
        `)}`;

        return `
            <div class="content-card" data-id="${item.Id}" data-type="${item.Type}" data-series-id="${item.SeriesId || ''}">
                <img src="${imageUrl || placeholder}" 
                     alt="" 
                     loading="lazy"
                     onerror="this.src='${placeholder}'">
                <div class="play-overlay">
                    <svg viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.9)"/>
                        <polygon points="10,8 10,16 16,12" fill="#333"/>
                    </svg>
                </div>
                ${badges}
            </div>
        `;
    }

    createEmptyState() {
        return `
            <div class="empty-state">
                <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" fill="#E0E0E0"/>
                    <path d="M8 14s1.5 2 4 2 4-2 4-2" stroke="#9E9E9E" stroke-width="2" fill="none" stroke-linecap="round"/>
                    <circle cx="9" cy="9" r="1.5" fill="#9E9E9E"/>
                    <circle cx="15" cy="9" r="1.5" fill="#9E9E9E"/>
                </svg>
            </div>
        `;
    }

    // ==================== NAVIGATION ====================

    handleNavigation(filter) {
        this.currentFilter = filter;
        
        // Update active state
        this.navButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        
        this.loadContent();
    }

    // ==================== PLAYBACK ====================

    /**
     * Destroy any existing HLS instance
     */
    destroyHls() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    }

    /**
     * Load video source with appropriate method (native, HLS.js, or direct)
     */
    async loadVideoSource(streamUrl, isHls) {
        this.destroyHls();

        if (isHls) {
            // Check if native HLS is supported (Safari)
            if (this.videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
                console.log('Using native HLS support');
                this.videoPlayer.src = streamUrl;
            } 
            // Use HLS.js for browsers without native support
            else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                console.log('Using HLS.js with optimized config');
                this.hls = new Hls({
                    // Buffer settings - optimized for transcoding
                    maxBufferLength: 30,           // Max buffer ahead (seconds)
                    maxMaxBufferLength: 60,        // Absolute max buffer
                    maxBufferSize: 60 * 1000000,   // 60 MB max buffer size
                    maxBufferHole: 0.5,            // Max gap in buffer (seconds)
                    
                    // Startup settings - be patient for transcoding
                    startLevel: -1,                // Auto quality selection
                    autoStartLoad: true,
                    startPosition: -1,             // Start from beginning
                    
                    // Low latency optimizations
                    lowLatencyMode: false,         // Not needed for VOD
                    backBufferLength: 30,          // Keep 30s behind playhead
                    
                    // Loading settings - longer timeouts for transcoding
                    manifestLoadingTimeOut: 30000, // 30s timeout for manifest
                    manifestLoadingMaxRetry: 6,
                    manifestLoadingRetryDelay: 2000,
                    manifestLoadingMaxRetryTimeout: 60000,
                    levelLoadingTimeOut: 30000,
                    levelLoadingMaxRetry: 6,
                    levelLoadingRetryDelay: 2000,
                    levelLoadingMaxRetryTimeout: 60000,
                    fragLoadingTimeOut: 60000,     // 60s timeout for segments (transcoding can be slow)
                    fragLoadingMaxRetry: 10,       // More retries
                    fragLoadingRetryDelay: 2000,   // Wait 2s between retries
                    fragLoadingMaxRetryTimeout: 120000,
                    
                    // ABR settings
                    abrEwmaDefaultEstimate: 500000,     // Start assuming 500kbps
                    abrBandWidthFactor: 0.8,           // Conservative bandwidth estimate
                    abrBandWidthUpFactor: 0.5,         // Slow to increase quality
                    abrMaxWithRealBitrate: true,
                    
                    // Enable streaming while transcoding
                    progressive: true,
                    
                    // Debug (disable in production)
                    debug: false,
                });
                
                this.hls.loadSource(streamUrl);
                this.hls.attachMedia(this.videoPlayer);
                
                this.hls.on(Hls.Events.ERROR, (event, data) => {
                    console.warn('HLS error:', data.type, data.details);
                    
                    if (data.fatal) {
                        console.error('HLS fatal error:', data);
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                // Try to recover from network errors
                                console.log('Attempting to recover from network error...');
                                this.hls.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                console.log('Attempting to recover from media error...');
                                this.hls.recoverMediaError();
                                break;
                            default:
                                // Cannot recover
                                this.destroyHls();
                                break;
                        }
                    }
                });
                
                // Wait for manifest to be parsed
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('HLS manifest load timeout'));
                    }, 30000);
                    
                    this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                    
                    this.hls.on(Hls.Events.ERROR, (event, data) => {
                        if (data.fatal) {
                            clearTimeout(timeout);
                            reject(new Error('HLS loading failed: ' + data.details));
                        }
                    });
                });
            } else {
                throw new Error('HLS playback not supported in this browser');
            }
        } else {
            // Direct stream
            console.log('Using direct stream');
            this.videoPlayer.src = streamUrl;
        }
    }

    async playItem(itemId) {
        // Prevent duplicate playback requests
        if (this.isStartingPlayback) {
            console.log('Playback already starting, ignoring duplicate request');
            return;
        }
        this.isStartingPlayback = true;
        
        // Clean up any existing playback first
        this.destroyHls();
        
        this.setLoading(true);

        try {
            // Check if item is downloaded - play offline
            if (this.downloadedItemIds.has(itemId)) {
                await this.playDownloadedItem(itemId);
                return;
            }
            
            // Online playback
            // Get item details
            this.currentItem = await jellyfinAPI.getItem(itemId);
            
            // Get playback info (this creates a new PlaySessionId on the server)
            this.playbackInfo = await jellyfinAPI.getPlaybackInfo(itemId);
            
            const mediaSource = this.playbackInfo.MediaSources[0];
            const playSessionId = this.playbackInfo.PlaySessionId;

            // Find preferred audio stream (Romanian if available)
            const audioStreamIndex = jellyfinAPI.findPreferredAudioStream(mediaSource);

            // Determine stream URL and type
            let streamUrl;
            let isHls = false;

            if (mediaSource.SupportsDirectStream) {
                // Try direct stream first
                streamUrl = jellyfinAPI.getStreamUrl(itemId, mediaSource.Id, playSessionId, audioStreamIndex);
            } else if (mediaSource.SupportsTranscoding) {
                // Fall back to HLS transcoding
                streamUrl = jellyfinAPI.getHlsStreamUrl(itemId, mediaSource.Id, playSessionId, audioStreamIndex);
                isHls = true;
            } else {
                throw new Error('No supported playback method');
            }

            console.log('Playing:', streamUrl, 'HLS:', isHls, 'Audio:', audioStreamIndex);

            // Show player
            this.showPlayer();

            // Load the video source
            await this.loadVideoSource(streamUrl, isHls);
            
            try {
                await this.videoPlayer.play();
                // Ensure overlay is hidden on successful autoplay
                this.playerOverlay.classList.remove('visible');
            } catch (e) {
                console.log('Autoplay blocked, showing play button');
                // Autoplay might be blocked, show play button
                this.playerOverlay.classList.add('visible');
            }

            // Report playback start
            jellyfinAPI.reportPlaybackStart(itemId, mediaSource.Id, playSessionId);

            // Start progress reporting
            this.startProgressReporting();

            // Load related content
            this.loadRelatedContent();

        } catch (error) {
            console.error('Playback failed:', error);
            // Go back to home on error
            this.showHome();
        } finally {
            this.setLoading(false);
            this.isStartingPlayback = false;
        }
    }
    
    /**
     * Play a downloaded item from local storage
     */
    async playDownloadedItem(itemId) {
        try {
            console.log('Playing downloaded item:', itemId);
            
            // Get video blob URL
            const videoUrl = await downloadManager.getVideoUrl(itemId);
            if (!videoUrl) {
                throw new Error('Downloaded video not found');
            }
            
            // Get item metadata from download manager
            const downloadedItems = await downloadManager.getDownloadedItems();
            const downloadedItem = downloadedItems.find(d => d.itemId === itemId);
            
            if (downloadedItem) {
                this.currentItem = downloadedItem.item;
            }
            
            // No playback info for offline - we won't report progress
            this.playbackInfo = null;
            
            // Show player
            this.showPlayer();
            
            // Set video source directly (no HLS needed for downloaded content)
            this.videoPlayer.src = videoUrl;
            
            try {
                await this.videoPlayer.play();
                // Ensure overlay is hidden on successful autoplay
                this.playerOverlay.classList.remove('visible');
            } catch (e) {
                console.log('Autoplay blocked, showing play button');
                this.playerOverlay.classList.add('visible');
            }
            
            // Load related content if online
            if (this.isOnline()) {
                this.loadRelatedContent();
            }
            
        } catch (error) {
            console.error('Offline playback failed:', error);
            this.showHome();
        } finally {
            this.setLoading(false);
            this.isStartingPlayback = false;
        }
    }

    async loadRelatedContent() {
        this.drawerContent.innerHTML = '';

        try {
            let items = [];

            // If it's an episode, show next episodes
            if (this.currentItem.Type === 'Episode' && this.currentItem.SeriesId) {
                const result = await jellyfinAPI.getNextEpisodes(
                    this.currentItem.SeriesId, 
                    this.currentItem.Id
                );
                items = result.Items || [];
            }

            // If no next episodes or not a series, show similar items
            if (items.length === 0) {
                const result = await jellyfinAPI.getSimilarItems(this.currentItem.Id);
                items = result.Items || [];
            }

            // Render items in drawer
            if (items.length > 0) {
                this.drawerContent.innerHTML = items.map(item => 
                    this.createContentCard(item, item.Type === 'Episode')
                ).join('');

                // Add click handlers (special handling for drawer - close before playing)
                this.drawerContent.querySelectorAll('.content-card').forEach(card => {
                    const itemId = card.dataset.id;
                    
                    // Play on click (close drawer first)
                    card.addEventListener('click', (e) => {
                        if (e.target.closest('.download-btn') || e.target.closest('.downloaded-badge')) {
                            return;
                        }
                        this.closeDrawer();
                        this.playItem(itemId);
                    });
                    
                    // Download button
                    const downloadBtn = card.querySelector('.download-btn');
                    if (downloadBtn) {
                        downloadBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.handleDownloadClick(itemId);
                        });
                    }
                    
                    // Long press on downloaded badge to delete
                    const downloadedBadge = card.querySelector('.downloaded-badge');
                    if (downloadedBadge) {
                        let longPressTimer;
                        
                        downloadedBadge.addEventListener('touchstart', (e) => {
                            e.stopPropagation();
                            longPressTimer = setTimeout(() => {
                                this.showDeleteConfirmation(itemId);
                            }, 800);
                        }, { passive: true });
                        
                        downloadedBadge.addEventListener('touchend', () => {
                            clearTimeout(longPressTimer);
                        }, { passive: true });
                        
                        downloadedBadge.addEventListener('touchmove', () => {
                            clearTimeout(longPressTimer);
                        }, { passive: true });
                    }
                });
            }
        } catch (error) {
            console.error('Failed to load related content:', error);
        }
    }

    togglePlayPause() {
        if (this.videoPlayer.paused) {
            this.videoPlayer.play();
        } else {
            this.videoPlayer.pause();
        }
    }

    updatePlayPauseIcon(isPlaying) {
        const playIcon = this.playPauseBtn.querySelector('.play-icon');
        const pauseIcon = this.playPauseBtn.querySelector('.pause-icon');
        
        playIcon.classList.toggle('hidden', isPlaying);
        pauseIcon.classList.toggle('hidden', !isPlaying);
    }

    toggleOverlay() {
        if (!this.isDrawerOpen) {
            this.playerOverlay.classList.toggle('visible');
        }
    }

    showBuffering() {
        const indicator = document.getElementById('buffering-indicator');
        if (indicator) {
            indicator.classList.remove('hidden');
        }
    }

    hideBuffering() {
        const indicator = document.getElementById('buffering-indicator');
        if (indicator) {
            indicator.classList.add('hidden');
        }
    }

    startProgressReporting() {
        this.stopProgressReporting();
        
        this.progressInterval = setInterval(() => {
            if (this.currentItem && this.playbackInfo) {
                const positionTicks = Math.floor(this.videoPlayer.currentTime * 10000000);
                const mediaSource = this.playbackInfo.MediaSources[0];
                
                jellyfinAPI.reportPlaybackProgress(
                    this.currentItem.Id,
                    mediaSource.Id,
                    this.playbackInfo.PlaySessionId,
                    positionTicks,
                    this.videoPlayer.paused
                );
            }
        }, 10000); // Report every 10 seconds
    }

    stopProgressReporting() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }

    exitPlayer() {
        // Report playback stopped (only for online playback)
        if (this.currentItem && this.playbackInfo) {
            const positionTicks = Math.floor(this.videoPlayer.currentTime * 10000000);
            const mediaSource = this.playbackInfo.MediaSources[0];
            
            jellyfinAPI.reportPlaybackStopped(
                this.currentItem.Id,
                mediaSource.Id,
                this.playbackInfo.PlaySessionId,
                positionTicks
            );
        }

        this.stopProgressReporting();
        this.destroyHls();
        this.videoPlayer.pause();
        
        // Revoke blob URL if it was a downloaded video
        const currentSrc = this.videoPlayer.src;
        if (currentSrc && currentSrc.startsWith('blob:')) {
            URL.revokeObjectURL(currentSrc);
        }
        
        this.videoPlayer.removeAttribute('src');
        this.videoPlayer.load();
        this.currentItem = null;
        this.playbackInfo = null;
        this.closeDrawer();
        
        this.showHome();
    }

    handleVideoEnded() {
        // Auto-play next if available
        const firstRelated = this.drawerContent.querySelector('.content-card');
        if (firstRelated) {
            this.playItem(firstRelated.dataset.id);
        } else {
            this.exitPlayer();
        }
    }

    // ==================== DRAWER HANDLING ====================

    handleTouchStart(e) {
        this.touchStartY = e.touches[0].clientY;
    }

    handleTouchMove(e) {
        const touchY = e.touches[0].clientY;
        const deltaY = this.touchStartY - touchY;
        const screenHeight = window.innerHeight;

        // Swipe up from bottom third of screen
        if (!this.isDrawerOpen && this.touchStartY > screenHeight * 0.7 && deltaY > 50) {
            e.preventDefault();
            this.openDrawer();
        }
        
        // Swipe down to close
        if (this.isDrawerOpen && deltaY < -50) {
            e.preventDefault();
            this.closeDrawer();
        }
    }

    handleTouchEnd(e) {
        // Reset
    }

    openDrawer() {
        this.isDrawerOpen = true;
        this.relatedDrawer.classList.add('open');
        this.playerOverlay.classList.remove('visible');
        this.swipeHint.classList.remove('visible');
    }

    closeDrawer() {
        this.isDrawerOpen = false;
        this.relatedDrawer.classList.remove('open');
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new TinyFinApp();
});
