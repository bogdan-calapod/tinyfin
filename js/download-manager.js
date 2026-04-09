/**
 * TinyFin Download Manager
 * Handles offline video downloads using IndexedDB
 */

class DownloadManager {
    constructor() {
        this.dbName = 'TinyFinDownloads';
        this.dbVersion = 1;
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

                // Store for video blobs (chunks)
                if (!db.objectStoreNames.contains('videos')) {
                    db.createObjectStore('videos', { keyPath: 'itemId' });
                }

                // Store for thumbnails
                if (!db.objectStoreNames.contains('thumbnails')) {
                    db.createObjectStore('thumbnails', { keyPath: 'itemId' });
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
            const videoBlob = new Blob(chunks, { type: 'video/webm' });

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
     * Delete a downloaded item
     */
    async deleteDownload(itemId) {
        if (!this.db) await this.init();

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
