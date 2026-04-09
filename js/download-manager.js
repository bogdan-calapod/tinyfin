/**
 * TinyFin Download Manager
 * Handles offline video downloads using IndexedDB
 */

class DownloadManager {
    constructor() {
        this.dbName = 'TinyFinDownloads';
        this.dbVersion = 2;  // Bump version to add segments store
        this.db = null;
        this.activeDownloads = new Set(); // itemId set for tracking
        this.downloadProgress = new Map(); // itemId -> progress (0-100)
        this.listeners = new Set();
        this.pendingDownloads = new Map(); // itemId -> {item, resolve, reject}
        
        // Listen for service worker messages
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                this.handleServiceWorkerMessage(event.data);
            });
        }
    }
    
    /**
     * Handle messages from service worker
     */
    handleServiceWorkerMessage(data) {
        const { type, itemId } = data;
        
        switch (type) {
            case 'DOWNLOAD_PROGRESS':
                this.downloadProgress.set(itemId, data.progress);
                this.notify('downloadProgress', {
                    itemId,
                    progress: data.progress,
                    downloadedSize: data.downloadedSize,
                    totalSize: data.totalSize
                });
                break;
                
            case 'DOWNLOAD_COMPLETE':
                this.handleBackgroundDownloadComplete(itemId, data);
                break;
                
            case 'DOWNLOAD_ERROR':
                this.handleBackgroundDownloadError(itemId, data.error);
                break;
        }
    }
    
    /**
     * Handle successful background download
     * Note: Service worker already saved to IndexedDB, we just update local state
     */
    async handleBackgroundDownloadComplete(itemId, data) {
        const pending = this.pendingDownloads.get(itemId);
        
        // Service worker already saved everything to IndexedDB
        // We just need to update our local state and notify listeners
        
        this.downloadProgress.set(itemId, 100);
        this.notify('downloadComplete', { 
            itemId, 
            item: pending?.item, 
            size: data.size 
        });
        
        console.log('Download complete:', pending?.item?.Name || itemId, `(${Math.round(data.size / 1024 / 1024)}MB)`);
        
        this.activeDownloads.delete(itemId);
        this.downloadProgress.delete(itemId);
        this.pendingDownloads.delete(itemId);
    }
    
    /**
     * Handle background download error
     */
    async handleBackgroundDownloadError(itemId, errorMessage) {
        console.error('Background download failed:', errorMessage);
        
        this.notify('downloadError', { itemId, error: errorMessage });
        await this.deleteDownload(itemId);
        
        this.activeDownloads.delete(itemId);
        this.downloadProgress.delete(itemId);
        this.pendingDownloads.delete(itemId);
    }

    /**
     * Initialize the IndexedDB database
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('Failed to open IndexedDB:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('DownloadManager initialized');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Store for video metadata
                if (!db.objectStoreNames.contains('metadata')) {
                    const metadataStore = db.createObjectStore('metadata', { keyPath: 'itemId' });
                    metadataStore.createIndex('downloadedAt', 'downloadedAt', { unique: false });
                }

                // Store for video blobs (legacy - single file downloads)
                if (!db.objectStoreNames.contains('videos')) {
                    db.createObjectStore('videos', { keyPath: 'itemId' });
                }

                // Store for thumbnails
                if (!db.objectStoreNames.contains('thumbnails')) {
                    db.createObjectStore('thumbnails', { keyPath: 'itemId' });
                }
                
                // Store for HLS segments (new in v2)
                // Key: itemId + segmentIndex, Value: segment blob
                if (!db.objectStoreNames.contains('segments')) {
                    const segmentsStore = db.createObjectStore('segments', { keyPath: ['itemId', 'index'] });
                    segmentsStore.createIndex('itemId', 'itemId', { unique: false });
                }
            };
        });
    }

    /**
     * Add a listener for download events
     */
    addListener(callback) {
        this.listeners.add(callback);
    }

    /**
     * Remove a listener
     */
    removeListener(callback) {
        this.listeners.delete(callback);
    }

    /**
     * Notify all listeners of an event
     */
    notify(event, data) {
        this.listeners.forEach(callback => {
            try {
                callback(event, data);
            } catch (e) {
                console.error('Listener error:', e);
            }
        });
    }

    /**
     * Check if an item is downloaded
     */
    async isDownloaded(itemId) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['metadata'], 'readonly');
            const store = transaction.objectStore('metadata');
            const request = store.get(itemId);

            request.onsuccess = () => {
                resolve(request.result?.status === 'complete');
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Check if an item is currently downloading
     */
    isDownloading(itemId) {
        return this.activeDownloads.has(itemId) || this.pendingDownloads.has(itemId);
    }

    /**
     * Get download progress (0-100)
     */
    getProgress(itemId) {
        return this.downloadProgress.get(itemId) || 0;
    }

    /**
     * Get all downloaded items metadata
     */
    async getDownloadedItems() {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['metadata'], 'readonly');
            const store = transaction.objectStore('metadata');
            const request = store.getAll();

            request.onsuccess = () => {
                const items = request.result.filter(item => item.status === 'complete');
                resolve(items);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Estimate file size based on item duration and bitrate
     * Using 360p: ~800 kbps video + 96 kbps audio = ~896 kbps total
     */
    estimateFileSize(item) {
        // RunTimeTicks is in 100-nanosecond units (10,000,000 = 1 second)
        const runtimeTicks = item.RunTimeTicks;
        if (!runtimeTicks) return 0;
        
        const durationSeconds = runtimeTicks / 10000000;
        // Estimate: 896 kbps = 0.112 MB/s
        const estimatedBytes = durationSeconds * 0.112 * 1024 * 1024;
        
        console.log(`Estimated size for ${Math.round(durationSeconds / 60)}min video: ${Math.round(estimatedBytes / 1024 / 1024)}MB`);
        return Math.round(estimatedBytes);
    }

    /**
     * Start downloading an item (uses service worker for background downloads)
     */
    async downloadItem(item, streamUrl, thumbnailUrl) {
        if (!this.db) await this.init();

        const itemId = item.Id;

        // Check if already downloading or downloaded
        if (this.isDownloading(itemId)) {
            console.log('Already downloading:', itemId);
            return;
        }

        if (await this.isDownloaded(itemId)) {
            console.log('Already downloaded:', itemId);
            return;
        }

        console.log('Starting download:', item.Name || itemId);

        // Mark as downloading
        this.activeDownloads.add(itemId);
        this.downloadProgress.set(itemId, 0);

        // Save initial metadata
        await this.saveMetadata({
            itemId: itemId,
            item: item,
            status: 'downloading',
            downloadedAt: null,
            size: 0
        });

        this.notify('downloadStarted', { itemId, item });

        // Estimate file size for progress
        const estimatedSize = this.estimateFileSize(item);

        // Try to use service worker for background download
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            console.log('Using service worker for background download');
            
            // Store pending download info
            this.pendingDownloads.set(itemId, { item });
            
            // Send download request to service worker
            navigator.serviceWorker.controller.postMessage({
                type: 'DOWNLOAD_VIDEO',
                itemId,
                streamUrl,
                thumbnailUrl,
                item,
                estimatedSize
            });
        } else {
            // Fallback to foreground download
            console.log('Service worker not available, using foreground download');
            this.downloadInForeground(item, streamUrl, thumbnailUrl, estimatedSize);
        }
    }
    
    /**
     * Fallback foreground download (when service worker unavailable)
     */
    async downloadInForeground(item, streamUrl, thumbnailUrl, estimatedSize) {
        const itemId = item.Id;
        
        try {
            // Download thumbnail first
            if (thumbnailUrl) {
                try {
                    const thumbResponse = await fetch(thumbnailUrl);
                    const thumbBlob = await thumbResponse.blob();
                    await this.saveThumbnail(itemId, thumbBlob);
                } catch (e) {
                    console.warn('Failed to download thumbnail:', e);
                }
            }

            // Download video
            const response = await fetch(streamUrl);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            // Read the stream
            const reader = response.body.getReader();
            const chunks = [];
            let downloadedSize = 0;
            let lastProgressUpdate = 0;

            while (true) {
                const { done, value } = await reader.read();

                if (done) break;

                chunks.push(value);
                downloadedSize += value.length;

                // Update progress (throttle to every 100ms)
                const now = Date.now();
                if (now - lastProgressUpdate > 100) {
                    lastProgressUpdate = now;
                    
                    let progress;
                    if (estimatedSize > 0) {
                        progress = Math.min(99, Math.round((downloadedSize / estimatedSize) * 100));
                    } else {
                        progress = -1;
                    }
                    
                    this.downloadProgress.set(itemId, progress);
                    this.notify('downloadProgress', { itemId, progress, downloadedSize, totalSize: estimatedSize });
                }
            }

            // Combine chunks into a single blob
            const videoBlob = new Blob(chunks, { type: 'video/mp4' });

            // Save video to IndexedDB
            await this.saveVideo(itemId, videoBlob);

            // Update metadata
            await this.saveMetadata({
                itemId: itemId,
                item: item,
                status: 'complete',
                downloadedAt: Date.now(),
                size: videoBlob.size
            });

            this.downloadProgress.set(itemId, 100);
            this.notify('downloadComplete', { itemId, item, size: videoBlob.size });

            console.log('Download complete:', item.Name || itemId, `(${Math.round(videoBlob.size / 1024 / 1024)}MB)`);

        } catch (error) {
            console.error('Download failed:', error);
            this.notify('downloadError', { itemId, error: error.message });
            await this.deleteDownload(itemId);

        } finally {
            this.activeDownloads.delete(itemId);
            this.downloadProgress.delete(itemId);
        }
    }

    /**
     * Download video via HLS - stores segments individually for HLS.js playback
     * This ensures proper transcoding with Romanian audio
     */
    async downloadHlsVideo(item, hlsUrl, thumbnailUrl) {
        if (!this.db) await this.init();

        const itemId = item.Id;

        // Check if already downloading or downloaded
        if (this.isDownloading(itemId)) {
            console.log('Already downloading:', itemId);
            return;
        }

        if (await this.isDownloaded(itemId)) {
            console.log('Already downloaded:', itemId);
            return;
        }

        console.log('Starting HLS download:', item.Name || itemId);

        // Mark as downloading
        this.activeDownloads.add(itemId);
        this.downloadProgress.set(itemId, 0);

        // Save initial metadata
        await this.saveMetadata({
            itemId: itemId,
            item: item,
            status: 'downloading',
            downloadedAt: null,
            size: 0,
            segmentCount: 0
        });

        this.notify('downloadStarted', { itemId, item });

        try {
            // Download thumbnail first
            if (thumbnailUrl) {
                try {
                    const thumbResponse = await fetch(thumbnailUrl);
                    const thumbBlob = await thumbResponse.blob();
                    await this.saveThumbnail(itemId, thumbBlob);
                } catch (e) {
                    console.warn('Failed to download thumbnail:', e);
                }
            }

            // Fetch master playlist
            console.log('Fetching HLS manifest:', hlsUrl);
            const masterResponse = await fetch(hlsUrl);
            const masterPlaylist = await masterResponse.text();
            
            // Parse to find the media playlist URL
            const lines = masterPlaylist.split('\n');
            let mediaPlaylistUrl = null;
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    if (trimmed.startsWith('http')) {
                        mediaPlaylistUrl = trimmed;
                    } else {
                        const baseUrl = hlsUrl.substring(0, hlsUrl.lastIndexOf('/') + 1);
                        mediaPlaylistUrl = baseUrl + trimmed;
                    }
                    break;
                }
            }

            if (!mediaPlaylistUrl) {
                if (masterPlaylist.includes('#EXTINF:')) {
                    mediaPlaylistUrl = hlsUrl;
                } else {
                    throw new Error('Could not find media playlist in HLS manifest');
                }
            }

            // Fetch media playlist
            let mediaPlaylist = masterPlaylist;
            if (mediaPlaylistUrl !== hlsUrl) {
                console.log('Fetching media playlist:', mediaPlaylistUrl);
                const mediaResponse = await fetch(mediaPlaylistUrl);
                mediaPlaylist = await mediaResponse.text();
            }

            // Parse segment info from media playlist
            // We need to preserve EXTINF durations for rebuilding the manifest
            const segmentInfos = [];
            const mediaLines = mediaPlaylist.split('\n');
            const mediaBaseUrl = mediaPlaylistUrl.substring(0, mediaPlaylistUrl.lastIndexOf('/') + 1);
            
            let currentDuration = null;
            for (const line of mediaLines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('#EXTINF:')) {
                    // Extract duration
                    currentDuration = trimmed.substring(8).split(',')[0];
                } else if (trimmed && !trimmed.startsWith('#')) {
                    const url = trimmed.startsWith('http') ? trimmed : mediaBaseUrl + trimmed;
                    segmentInfos.push({
                        url: url,
                        duration: currentDuration || '6.0'
                    });
                    currentDuration = null;
                }
            }

            console.log(`Found ${segmentInfos.length} segments to download`);

            if (segmentInfos.length === 0) {
                throw new Error('No segments found in HLS playlist');
            }

            // Download and store each segment individually
            let totalSize = 0;
            
            for (let i = 0; i < segmentInfos.length; i++) {
                const segmentInfo = segmentInfos[i];
                
                const segmentResponse = await fetch(segmentInfo.url);
                if (!segmentResponse.ok) {
                    throw new Error(`Failed to download segment ${i}: ${segmentResponse.status}`);
                }
                
                const segmentBlob = await segmentResponse.blob();
                totalSize += segmentBlob.size;
                
                // Save segment to IndexedDB with its duration
                await this.saveSegment(itemId, i, segmentBlob, segmentInfo.duration);
                
                // Update progress
                const progress = Math.round(((i + 1) / segmentInfos.length) * 100);
                this.downloadProgress.set(itemId, progress);
                this.notify('downloadProgress', { 
                    itemId, 
                    progress, 
                    downloadedSize: i + 1,
                    totalSize: segmentInfos.length 
                });
            }

            console.log('HLS download complete:', `${Math.round(totalSize / 1024 / 1024)}MB`, `${segmentInfos.length} segments`);

            // Update metadata with final info
            await this.saveMetadata({
                itemId: itemId,
                item: item,
                status: 'complete',
                downloadedAt: Date.now(),
                size: totalSize,
                segmentCount: segmentInfos.length,
                isHls: true  // Flag to indicate HLS playback needed
            });

            this.downloadProgress.set(itemId, 100);
            this.notify('downloadComplete', { itemId, item, size: totalSize });

        } catch (error) {
            console.error('HLS download failed:', error);
            this.notify('downloadError', { itemId, error: error.message });
            await this.deleteDownload(itemId);
        } finally {
            this.activeDownloads.delete(itemId);
            this.downloadProgress.delete(itemId);
        }
    }
    
    /**
     * Save a single HLS segment to IndexedDB
     */
    async saveSegment(itemId, index, blob, duration) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['segments'], 'readwrite');
            const store = transaction.objectStore('segments');
            const request = store.put({ 
                itemId, 
                index, 
                blob, 
                duration 
            });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    /**
     * Get all segments for an item
     */
    async getSegments(itemId) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['segments'], 'readonly');
            const store = transaction.objectStore('segments');
            const index = store.index('itemId');
            const request = index.getAll(itemId);

            request.onsuccess = () => {
                // Sort by index
                const segments = request.result.sort((a, b) => a.index - b.index);
                resolve(segments);
            };
            request.onerror = () => reject(request.error);
        });
    }
    
    /**
     * Generate a blob URL manifest for offline HLS playback
     * Returns { manifestUrl, segmentUrls } - caller must revoke URLs when done
     */
    async getHlsPlaybackUrls(itemId) {
        const segments = await this.getSegments(itemId);
        
        if (segments.length === 0) {
            return null;
        }
        
        // Create blob URLs for each segment
        const segmentUrls = segments.map(seg => URL.createObjectURL(seg.blob));
        
        // Build m3u8 manifest pointing to blob URLs
        let manifest = '#EXTM3U\n';
        manifest += '#EXT-X-VERSION:3\n';
        manifest += '#EXT-X-TARGETDURATION:10\n';
        manifest += '#EXT-X-MEDIA-SEQUENCE:0\n';
        
        for (let i = 0; i < segments.length; i++) {
            manifest += `#EXTINF:${segments[i].duration},\n`;
            manifest += `${segmentUrls[i]}\n`;
        }
        
        manifest += '#EXT-X-ENDLIST\n';
        
        // Create blob URL for the manifest itself
        const manifestBlob = new Blob([manifest], { type: 'application/vnd.apple.mpegurl' });
        const manifestUrl = URL.createObjectURL(manifestBlob);
        
        return {
            manifestUrl,
            segmentUrls,
            // Helper to clean up all URLs
            revokeAll: () => {
                URL.revokeObjectURL(manifestUrl);
                segmentUrls.forEach(url => URL.revokeObjectURL(url));
            }
        };
    }

    /**
     * Cancel an active download
     * Note: Cannot cancel service worker downloads, but can clean up state
     */
    cancelDownload(itemId) {
        // Clean up local state
        this.activeDownloads.delete(itemId);
        this.downloadProgress.delete(itemId);
        this.pendingDownloads.delete(itemId);
        
        // Delete any partial download
        this.deleteDownload(itemId);
        
        this.notify('downloadCancelled', { itemId });
    }

    /**
     * Delete a downloaded item (including all HLS segments)
     */
    async deleteDownload(itemId) {
        if (!this.db) await this.init();

        // First, delete all segments for this item
        try {
            const segments = await this.getSegments(itemId);
            const segTransaction = this.db.transaction(['segments'], 'readwrite');
            const segStore = segTransaction.objectStore('segments');
            for (const seg of segments) {
                segStore.delete([itemId, seg.index]);
            }
        } catch (e) {
            console.warn('Error deleting segments:', e);
        }

        const transaction = this.db.transaction(['metadata', 'videos', 'thumbnails'], 'readwrite');

        transaction.objectStore('metadata').delete(itemId);
        transaction.objectStore('videos').delete(itemId);
        transaction.objectStore('thumbnails').delete(itemId);

        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => {
                this.notify('downloadDeleted', { itemId });
                resolve();
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /**
     * Get the video blob for playback
     */
    async getVideoBlob(itemId) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videos'], 'readonly');
            const store = transaction.objectStore('videos');
            const request = store.get(itemId);

            request.onsuccess = () => {
                resolve(request.result?.blob || null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get the thumbnail blob
     */
    async getThumbnailBlob(itemId) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['thumbnails'], 'readonly');
            const store = transaction.objectStore('thumbnails');
            const request = store.get(itemId);

            request.onsuccess = () => {
                resolve(request.result?.blob || null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get a URL for a downloaded video (for playback)
     */
    async getVideoUrl(itemId) {
        const blob = await this.getVideoBlob(itemId);
        if (blob) {
            return URL.createObjectURL(blob);
        }
        return null;
    }

    /**
     * Get a URL for a downloaded thumbnail
     */
    async getThumbnailUrl(itemId) {
        const blob = await this.getThumbnailBlob(itemId);
        if (blob) {
            return URL.createObjectURL(blob);
        }
        return null;
    }

    /**
     * Save metadata to IndexedDB
     */
    async saveMetadata(metadata) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['metadata'], 'readwrite');
            const store = transaction.objectStore('metadata');
            const request = store.put(metadata);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Save video blob to IndexedDB
     */
    async saveVideo(itemId, blob) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videos'], 'readwrite');
            const store = transaction.objectStore('videos');
            const request = store.put({ itemId, blob });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Save thumbnail blob to IndexedDB
     */
    async saveThumbnail(itemId, blob) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['thumbnails'], 'readwrite');
            const store = transaction.objectStore('thumbnails');
            const request = store.put({ itemId, blob });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get total storage used by downloads
     */
    async getStorageUsed() {
        const items = await this.getDownloadedItems();
        return items.reduce((total, item) => total + (item.size || 0), 0);
    }

    /**
     * Clear all downloads
     */
    async clearAllDownloads() {
        if (!this.db) await this.init();

        const transaction = this.db.transaction(['metadata', 'videos', 'thumbnails'], 'readwrite');

        transaction.objectStore('metadata').clear();
        transaction.objectStore('videos').clear();
        transaction.objectStore('thumbnails').clear();

        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => {
                this.notify('allDownloadsCleared', {});
                resolve();
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }
}

// Export singleton instance
const downloadManager = new DownloadManager();
