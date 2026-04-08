/**
 * TinyFin Service Worker
 * Handles offline caching for Android PWA
 */

const CACHE_VERSION = 'tinyfin-v1';
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
                    // Notify all clients of completion
                    self.clients.matchAll().then(clients => {
                        clients.forEach(client => {
                            client.postMessage({
                                type: 'DOWNLOAD_COMPLETE',
                                itemId: event.data.itemId,
                                ...result
                            });
                        });
                    });
                })
                .catch(error => {
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

/**
 * Download video in service worker (survives tab switches)
 */
async function downloadVideoInBackground(data) {
    const { itemId, streamUrl, thumbnailUrl, item, estimatedSize } = data;
    
    console.log('[SW] Starting background download:', item.Name || itemId);
    
    // Download thumbnail first
    let thumbnailBlob = null;
    if (thumbnailUrl) {
        try {
            const thumbResponse = await fetch(thumbnailUrl);
            thumbnailBlob = await thumbResponse.blob();
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
    
    // Combine chunks
    const videoBlob = new Blob(chunks, { type: 'video/mp4' });
    
    console.log('[SW] Download complete:', item.Name || itemId, `(${Math.round(videoBlob.size / 1024 / 1024)}MB)`);
    
    return {
        videoBlob,
        thumbnailBlob,
        size: videoBlob.size
    };
}
