/**
 * TinyFin Service Worker
 * Handles offline caching for Android PWA
 */

const CACHE_VERSION = 'tinyfin-v3';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;
const API_CACHE = `${CACHE_VERSION}-api`;

// App shell - files needed for the app to work
// Using relative paths so it works in subfolders
const APP_SHELL = [
    './',
    './index.html',
    './css/styles.css',
    './js/jellyfin-api.js',
    './js/download-manager.js',
    './js/app.js',
    './manifest.json',
    './assets/icon.svg',
    './assets/icon-192.svg',
    './assets/icon-512.svg'
];

// External resources to cache
const EXTERNAL_RESOURCES = [
    'https://cdn.jsdelivr.net/npm/hls.js@latest'
];

/**
 * Install event - cache app shell
 */
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                console.log('[SW] Caching app shell');
                // Cache app shell files
                const appShellPromise = cache.addAll(APP_SHELL).catch(err => {
                    console.warn('[SW] Some app shell files failed to cache:', err);
                });
                
                // Cache external resources separately (don't fail install if CDN is down)
                const externalPromise = Promise.all(
                    EXTERNAL_RESOURCES.map(url => 
                        cache.add(url).catch(err => {
                            console.warn('[SW] Failed to cache external resource:', url, err);
                        })
                    )
                );
                
                return Promise.all([appShellPromise, externalPromise]);
            })
            .then(() => {
                console.log('[SW] Install complete');
                return self.skipWaiting();
            })
    );
});

/**
 * Activate event - clean up old caches
 */
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name.startsWith('tinyfin-') && !name.startsWith(CACHE_VERSION))
                        .map((name) => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('[SW] Activate complete');
                return self.clients.claim();
            })
    );
});

/**
 * Fetch event - serve from cache or network
 */
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }
    
    // Skip video streams - don't cache these
    if (url.pathname.includes('/Videos/') || 
        url.pathname.includes('/stream') ||
        url.pathname.includes('.m3u8') ||
        url.pathname.includes('.ts')) {
        return;
    }
    
    // Handle Jellyfin images - cache with network fallback
    if (url.pathname.includes('/Items/') && url.pathname.includes('/Images/')) {
        event.respondWith(cacheFirstWithRefresh(event.request, IMAGE_CACHE));
        return;
    }
    
    // Handle Jellyfin API calls - network first with cache fallback
    if (url.pathname.includes('/Users/') || 
        url.pathname.includes('/Items') ||
        url.pathname.includes('/System/')) {
        event.respondWith(networkFirstWithCache(event.request, API_CACHE));
        return;
    }
    
    // Handle app shell and static assets - cache first
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
});

/**
 * Cache-first strategy (for app shell)
 */
async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    
    if (cached) {
        return cached;
    }
    
    try {
        const response = await fetch(request);
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        console.warn('[SW] Fetch failed:', request.url, error);
        // Return offline page or placeholder if available
        return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
}

/**
 * Cache-first with background refresh (for images)
 */
async function cacheFirstWithRefresh(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    
    // Start network fetch in background
    const networkPromise = fetch(request)
        .then((response) => {
            if (response.ok) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => null);
    
    // Return cached immediately if available, otherwise wait for network
    if (cached) {
        return cached;
    }
    
    const networkResponse = await networkPromise;
    if (networkResponse) {
        return networkResponse;
    }
    
    // Return placeholder image if offline and not cached
    return new Response(
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225">
            <rect fill="#E0E0E0" width="400" height="225"/>
            <polygon points="180,90 180,135 215,112.5" fill="#BDBDBD"/>
        </svg>`,
        { 
            headers: { 'Content-Type': 'image/svg+xml' },
            status: 200 
        }
    );
}

/**
 * Network-first with cache fallback (for API)
 */
async function networkFirstWithCache(request, cacheName) {
    const cache = await caches.open(cacheName);
    
    try {
        const response = await fetch(request);
        if (response.ok) {
            // Cache successful API responses
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        console.log('[SW] Network failed, trying cache:', request.url);
        const cached = await cache.match(request);
        if (cached) {
            return cached;
        }
        
        // Return error response
        return new Response(
            JSON.stringify({ error: 'offline', message: 'No cached data available' }),
            { 
                headers: { 'Content-Type': 'application/json' },
                status: 503 
            }
        );
    }
}

/**
 * Handle messages from the app
 */
self.addEventListener('message', (event) => {
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(
            caches.keys().then((names) => 
                Promise.all(names.map((name) => caches.delete(name)))
            )
        );
    }
    
    // Handle background download request
    if (event.data.type === 'DOWNLOAD_VIDEO') {
        event.waitUntil(
            downloadVideoInBackground(event.data)
                .then(result => {
                    // Notify all clients of completion (no blobs - they're already in IndexedDB)
                    self.clients.matchAll().then(clients => {
                        clients.forEach(client => {
                            client.postMessage({
                                type: 'DOWNLOAD_COMPLETE',
                                itemId: event.data.itemId,
                                size: result.size
                            });
                        });
                    });
                })
                .catch(error => {
                    // Clean up failed download
                    deleteFromIndexedDB(event.data.itemId).catch(() => {});
                    
                    self.clients.matchAll().then(clients => {
                        clients.forEach(client => {
                            client.postMessage({
                                type: 'DOWNLOAD_ERROR',
                                itemId: event.data.itemId,
                                error: error.message
                            });
                        });
                    });
                })
        );
    }
});

// ==================== IndexedDB Helper Functions ====================

const DB_NAME = 'TinyFinDownloads';
const DB_VERSION = 1;

/**
 * Open IndexedDB database
 */
function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            if (!db.objectStoreNames.contains('metadata')) {
                const metadataStore = db.createObjectStore('metadata', { keyPath: 'itemId' });
                metadataStore.createIndex('downloadedAt', 'downloadedAt', { unique: false });
            }
            
            if (!db.objectStoreNames.contains('videos')) {
                db.createObjectStore('videos', { keyPath: 'itemId' });
            }
            
            if (!db.objectStoreNames.contains('thumbnails')) {
                db.createObjectStore('thumbnails', { keyPath: 'itemId' });
            }
        };
    });
}

/**
 * Save video blob to IndexedDB
 */
async function saveVideoToIndexedDB(itemId, blob) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['videos'], 'readwrite');
        const store = transaction.objectStore('videos');
        const request = store.put({ itemId, blob });
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Save thumbnail blob to IndexedDB
 */
async function saveThumbnailToIndexedDB(itemId, blob) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['thumbnails'], 'readwrite');
        const store = transaction.objectStore('thumbnails');
        const request = store.put({ itemId, blob });
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Save metadata to IndexedDB
 */
async function saveMetadataToIndexedDB(metadata) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['metadata'], 'readwrite');
        const store = transaction.objectStore('metadata');
        const request = store.put(metadata);
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Delete item from IndexedDB (cleanup on error)
 */
async function deleteFromIndexedDB(itemId) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['metadata', 'videos', 'thumbnails'], 'readwrite');
        
        transaction.objectStore('metadata').delete(itemId);
        transaction.objectStore('videos').delete(itemId);
        transaction.objectStore('thumbnails').delete(itemId);
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

// ==================== Background Download ====================

/**
 * Download video in service worker and save directly to IndexedDB
 */
async function downloadVideoInBackground(data) {
    const { itemId, streamUrl, thumbnailUrl, item, estimatedSize } = data;
    
    console.log('[SW] Starting background download:', item.Name || itemId);
    
    // Download and save thumbnail first
    if (thumbnailUrl) {
        try {
            const thumbResponse = await fetch(thumbnailUrl);
            const thumbnailBlob = await thumbResponse.blob();
            await saveThumbnailToIndexedDB(itemId, thumbnailBlob);
            console.log('[SW] Thumbnail saved');
        } catch (e) {
            console.warn('[SW] Failed to download thumbnail:', e);
        }
    }
    
    // Download video
    const response = await fetch(streamUrl);
    
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    
    const reader = response.body.getReader();
    const chunks = [];
    let downloadedSize = 0;
    let lastProgressUpdate = 0;
    
    while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(value);
        downloadedSize += value.length;
        
        // Send progress updates (throttled)
        const now = Date.now();
        if (now - lastProgressUpdate > 500) {
            lastProgressUpdate = now;
            
            let progress = -1;
            if (estimatedSize > 0) {
                progress = Math.min(99, Math.round((downloadedSize / estimatedSize) * 100));
            }
            
            // Notify clients of progress
            self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'DOWNLOAD_PROGRESS',
                        itemId,
                        progress,
                        downloadedSize,
                        totalSize: estimatedSize
                    });
                });
            });
        }
    }
    
    // Combine chunks into blob
    // Use generic video type - actual format determined by content
    const videoBlob = new Blob(chunks, { type: 'video/webm' });
    const videoSize = videoBlob.size;
    
    console.log('[SW] Video downloaded, saving to IndexedDB:', `${Math.round(videoSize / 1024 / 1024)}MB`);
    
    // Save video to IndexedDB
    await saveVideoToIndexedDB(itemId, videoBlob);
    
    // Save metadata
    await saveMetadataToIndexedDB({
        itemId: itemId,
        item: item,
        status: 'complete',
        downloadedAt: Date.now(),
        size: videoSize
    });
    
    console.log('[SW] Download complete:', item.Name || itemId);
    
    return { size: videoSize };
}
