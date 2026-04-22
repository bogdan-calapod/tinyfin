/**
 * TinyFin - Jellyfin API Client
 * Simple API wrapper for Jellyfin server communication
 */

class JellyfinAPI {
    constructor() {
        this.serverUrl = '';
        this.accessToken = '';
        this.userId = '';
        this.deviceId = this.getDeviceId();
    }

    /**
     * Generate or retrieve a persistent device ID
     */
    getDeviceId() {
        let deviceId = localStorage.getItem('tinyfin_deviceId');
        if (!deviceId) {
            deviceId = 'tinyfin_' + Math.random().toString(36).substring(2, 15);
            localStorage.setItem('tinyfin_deviceId', deviceId);
        }
        return deviceId;
    }

    /**
     * Get authorization header for API requests
     */
    getAuthHeader() {
        let auth = `MediaBrowser Client="TinyFin", Device="Tablet", DeviceId="${this.deviceId}", Version="1.0.0"`;
        if (this.accessToken) {
            auth += `, Token="${this.accessToken}"`;
        }
        return auth;
    }

    /**
     * Make an authenticated API request
     */
    async request(endpoint, options = {}) {
        const url = `${this.serverUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            'X-Emby-Authorization': this.getAuthHeader(),
            ...options.headers
        };

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // Some endpoints return no content
            const text = await response.text();
            return text ? JSON.parse(text) : null;
        } catch (error) {
            console.error('API Request failed:', error);
            throw error;
        }
    }

    /**
     * Connect to Jellyfin server and authenticate
     */
    async connect(serverUrl, username, password) {
        // Normalize server URL - handle common mistakes
        let normalizedUrl = serverUrl.trim().replace(/\/+$/, '');
        
        // Add https:// if no protocol specified
        if (!normalizedUrl.match(/^https?:\/\//i)) {
            normalizedUrl = 'https://' + normalizedUrl;
        }
        
        this.serverUrl = normalizedUrl;
        
        // Test server connection first
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(`${this.serverUrl}/System/Info/Public`, {
                method: 'GET',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }
            
            const serverInfo = await response.json();
            console.log('Connected to Jellyfin server:', serverInfo.ServerName, 'v' + serverInfo.Version);
            
        } catch (error) {
            console.error('Server connection test failed:', error);
            if (error.name === 'AbortError') {
                throw new Error('Connection timed out. Check the server URL.');
            }
            if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                throw new Error('Cannot reach server. Check URL and CORS settings.');
            }
            throw new Error('Cannot connect to server: ' + error.message);
        }

        // Authenticate
        try {
            const authResult = await this.request('/Users/AuthenticateByName', {
                method: 'POST',
                body: JSON.stringify({
                    Username: username,
                    Pw: password
                })
            });

            if (!authResult || !authResult.AccessToken) {
                throw new Error('Invalid response from server');
            }

            this.accessToken = authResult.AccessToken;
            this.userId = authResult.User.Id;

            // Save credentials
            this.saveCredentials();

            return authResult.User;
        } catch (error) {
            console.error('Authentication failed:', error);
            if (error.message.includes('401')) {
                throw new Error('Invalid username or password');
            }
            throw new Error('Login failed: ' + error.message);
        }
    }

    /**
     * Save credentials to localStorage
     */
    saveCredentials() {
        localStorage.setItem('tinyfin_serverUrl', this.serverUrl);
        localStorage.setItem('tinyfin_accessToken', this.accessToken);
        localStorage.setItem('tinyfin_userId', this.userId);
    }

    /**
     * Load saved credentials
     */
    loadCredentials() {
        this.serverUrl = localStorage.getItem('tinyfin_serverUrl') || '';
        this.accessToken = localStorage.getItem('tinyfin_accessToken') || '';
        this.userId = localStorage.getItem('tinyfin_userId') || '';
        return this.serverUrl && this.accessToken && this.userId;
    }

    /**
     * Clear saved credentials (logout)
     */
    clearCredentials() {
        localStorage.removeItem('tinyfin_serverUrl');
        localStorage.removeItem('tinyfin_accessToken');
        localStorage.removeItem('tinyfin_userId');
        this.serverUrl = '';
        this.accessToken = '';
        this.userId = '';
    }

    /**
     * Validate that stored credentials are still valid
     */
    async validateSession() {
        if (!this.loadCredentials()) {
            return false;
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const url = `${this.serverUrl}/Users/${this.userId}`;
            const response = await fetch(url, {
                headers: {
                    'X-Emby-Authorization': this.getAuthHeader()
                },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                // Only clear credentials on auth errors (401/403)
                // Other errors (500, etc.) might be temporary server issues
                if (response.status === 401 || response.status === 403) {
                    console.log('Session expired, clearing credentials');
                    this.clearCredentials();
                    return false;
                }
                // For other errors, assume session might still be valid
                // but server is having issues - keep credentials
                console.log('Server error during validation:', response.status);
                return true; // Optimistically assume valid, let app try to work
            }
            
            return true;
        } catch (error) {
            // Network errors (offline, timeout, etc.) - don't clear credentials
            // User might just be offline, credentials could still be valid
            console.log('Session validation failed (network issue?):', error.message);
            return true; // Keep credentials, let app work offline
        }
    }

    /**
     * Get all media items grouped by type
     * Order: Home Videos/Photos, Movies, Shows (Episodes)
     */
    async getAllItems(options = {}) {
        if (options.isFavorite) {
            // For favorites, just fetch normally
            const params = new URLSearchParams({
                UserId: this.userId,
                IncludeItemTypes: 'Movie,Episode,Video,Photo',
                Recursive: 'true',
                Fields: 'PrimaryImageAspectRatio,SeriesInfo,ParentId,Overview',
                ImageTypeLimit: 1,
                EnableImageTypes: 'Primary,Backdrop,Thumb',
                SortBy: options.sortBy || 'SortName',
                SortOrder: options.sortOrder || 'Ascending',
                Limit: options.limit || 100,
                StartIndex: options.startIndex || 0,
                IsFavorite: 'true'
            });
            return this.request(`/Users/${this.userId}/Items?${params}`);
        }

        // Fetch each category separately and combine
        const baseParams = {
            UserId: this.userId,
            Recursive: 'true',
            Fields: 'PrimaryImageAspectRatio,SeriesInfo,ParentId,Overview',
            ImageTypeLimit: 1,
            EnableImageTypes: 'Primary,Backdrop,Thumb',
            SortBy: options.sortBy || 'SortName',
            SortOrder: options.sortOrder || 'Ascending'
        };

        // Calculate limits for each category (distribute evenly if paginating)
        const limit = options.limit || 100;
        const startIndex = options.startIndex || 0;

        // Determine which categories to fetch based on excludeMovies option
        const includeMovies = !options.excludeMovies;

        // Fetch categories in parallel
        const requests = [
            this.request(`/Users/${this.userId}/Items?${new URLSearchParams({
                ...baseParams,
                IncludeItemTypes: 'Video,Photo',
                Limit: limit,
                StartIndex: startIndex
            })}`),
            this.request(`/Users/${this.userId}/Items?${new URLSearchParams({
                ...baseParams,
                IncludeItemTypes: 'Episode',
                Limit: limit,
                StartIndex: startIndex
            })}`)
        ];

        // Only fetch movies if not excluded
        if (includeMovies) {
            requests.splice(1, 0, this.request(`/Users/${this.userId}/Items?${new URLSearchParams({
                ...baseParams,
                IncludeItemTypes: 'Movie',
                Limit: limit,
                StartIndex: startIndex
            })}`));
        }

        const results = await Promise.all(requests);

        // Combine items based on what was fetched
        let combinedItems;
        let totalCount;

        if (includeMovies) {
            const [homeVideos, movies, episodes] = results;
            combinedItems = [
                ...(homeVideos.Items || []),
                ...(movies.Items || []),
                ...(episodes.Items || [])
            ];
            totalCount = (homeVideos.TotalRecordCount || 0) + 
                        (movies.TotalRecordCount || 0) + 
                        (episodes.TotalRecordCount || 0);
        } else {
            const [homeVideos, episodes] = results;
            combinedItems = [
                ...(homeVideos.Items || []),
                ...(episodes.Items || [])
            ];
            totalCount = (homeVideos.TotalRecordCount || 0) + 
                        (episodes.TotalRecordCount || 0);
        }

        return {
            Items: combinedItems,
            TotalRecordCount: totalCount
        };
    }

    /**
     * Get movies only
     */
    async getMovies(limit = 100, startIndex = 0) {
        const params = new URLSearchParams({
            UserId: this.userId,
            IncludeItemTypes: 'Movie',
            Recursive: 'true',
            SortBy: 'SortName',
            SortOrder: 'Ascending',
            Fields: 'PrimaryImageAspectRatio',
            ImageTypeLimit: 1,
            EnableImageTypes: 'Primary,Backdrop,Thumb',
            Limit: limit,
            StartIndex: startIndex
        });

        return this.request(`/Users/${this.userId}/Items?${params}`);
    }

    /**
     * Get TV shows/episodes only
     * Sorted by Series Name, then Season, then Episode Number
     * This ensures pagination loads all episodes of one show before moving to the next
     */
    async getShows(limit = 100, startIndex = 0) {
        const params = new URLSearchParams({
            UserId: this.userId,
            IncludeItemTypes: 'Episode',
            Recursive: 'true',
            SortBy: 'SeriesSortName,ParentIndexNumber,IndexNumber',
            SortOrder: 'Ascending',
            Fields: 'PrimaryImageAspectRatio,SeriesInfo,ParentId',
            ImageTypeLimit: 1,
            EnableImageTypes: 'Primary,Backdrop,Thumb',
            Limit: limit,
            StartIndex: startIndex
        });

        return this.request(`/Users/${this.userId}/Items?${params}`);
    }

    /**
     * Get videos/photos only (home videos, personal content)
     */
    async getVideos(limit = 100, startIndex = 0) {
        const params = new URLSearchParams({
            UserId: this.userId,
            IncludeItemTypes: 'Video,Photo',
            Recursive: 'true',
            SortBy: 'SortName',
            SortOrder: 'Ascending',
            Fields: 'PrimaryImageAspectRatio',
            ImageTypeLimit: 1,
            EnableImageTypes: 'Primary,Backdrop,Thumb',
            Limit: limit,
            StartIndex: startIndex
        });

        return this.request(`/Users/${this.userId}/Items?${params}`);
    }

    /**
     * Get recently played items
     */
    async getRecentlyPlayed(limit = 50, startIndex = 0) {
        const params = new URLSearchParams({
            UserId: this.userId,
            IncludeItemTypes: 'Movie,Episode,Video',
            Recursive: 'true',
            StartIndex: startIndex,
            Fields: 'PrimaryImageAspectRatio,SeriesInfo,ParentId',
            ImageTypeLimit: 1,
            EnableImageTypes: 'Primary,Backdrop,Thumb',
            SortBy: 'DatePlayed',
            SortOrder: 'Descending',
            Filters: 'IsPlayed',
            Limit: limit
        });

        const result = await this.request(`/Users/${this.userId}/Items?${params}`);
        return result;
    }

    /**
     * Get favorite items
     */
    async getFavorites(limit = 100, startIndex = 0) {
        return this.getAllItems({ isFavorite: true, limit, startIndex, sortBy: 'SortName' });
    }

    /**
     * Get related/similar items
     */
    async getSimilarItems(itemId, limit = 20) {
        const params = new URLSearchParams({
            UserId: this.userId,
            Limit: limit,
            Fields: 'PrimaryImageAspectRatio,SeriesInfo'
        });

        const result = await this.request(`/Items/${itemId}/Similar?${params}`);
        return result;
    }

    /**
     * Get next episodes in a series
     */
    async getNextEpisodes(seriesId, currentEpisodeId, limit = 20) {
        const params = new URLSearchParams({
            UserId: this.userId,
            SeriesId: seriesId,
            IncludeItemTypes: 'Episode',
            Recursive: 'true',
            Fields: 'PrimaryImageAspectRatio,SeriesInfo',
            SortBy: 'ParentIndexNumber,IndexNumber',
            SortOrder: 'Ascending',
            Limit: 100
        });

        const result = await this.request(`/Users/${this.userId}/Items?${params}`);
        
        // Find current episode index and return episodes after it
        const items = result.Items || [];
        const currentIndex = items.findIndex(item => item.Id === currentEpisodeId);
        
        if (currentIndex >= 0 && currentIndex < items.length - 1) {
            return {
                ...result,
                Items: items.slice(currentIndex + 1, currentIndex + 1 + limit)
            };
        }

        return { Items: [], TotalRecordCount: 0 };
    }

    /**
     * Get item details
     */
    async getItem(itemId) {
        return this.request(`/Users/${this.userId}/Items/${itemId}`);
    }

    /**
     * Get playback info for an item
     */
    async getPlaybackInfo(itemId) {
        const params = new URLSearchParams({
            UserId: this.userId,
            StartTimeTicks: 0,
            IsPlayback: true,
            AutoOpenLiveStream: true,
            MaxStreamingBitrate: 20000000
        });
        
        const result = await this.request(`/Items/${itemId}/PlaybackInfo?${params}`, {
            method: 'POST',
            body: JSON.stringify({
                DeviceProfile: this.getDeviceProfile()
            })
        });
        return result;
    }

    /**
     * Get device profile for playback
     * Optimized for Android tablets with transcoding support
     */
    getDeviceProfile() {
        return {
            // Lower bitrate = faster transcoding, less buffering
            // 2Mbps is good quality for 480p on tablets
            MaxStreamingBitrate: 2000000,
            MaxStaticBitrate: 5000000,
            MusicStreamingTranscodingBitrate: 128000,
            
            // Direct play profiles - what the browser can play natively
            DirectPlayProfiles: [
                // MP4 with H.264 - most compatible
                { Container: 'mp4,m4v', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3' },
                // WebM 
                { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9', AudioCodec: 'vorbis,opus' },
            ],
            
            // Transcoding profiles - what to transcode TO
            TranscodingProfiles: [
                {
                    Container: 'ts',
                    Type: 'Video',
                    AudioCodec: 'aac',
                    VideoCodec: 'h264',
                    Context: 'Streaming',
                    Protocol: 'hls',
                    MaxAudioChannels: '2',
                    MinSegments: 2,
                    BreakOnNonKeyFrames: false, // More stable seeking
                    // Faster encoding preset
                    EstimateContentLength: false,
                    TranscodeSeekInfo: 'Auto',
                    CopyTimestamps: false
                }
            ],
            
            // Container profiles
            ContainerProfiles: [],
            
            // Codec profiles - constraints for video/audio
            CodecProfiles: [
                {
                    Type: 'Video',
                    Codec: 'h264',
                    Conditions: [
                        {
                            Condition: 'LessThanEqual',
                            Property: 'Width',
                            Value: '854' // Cap at 480p for fast transcoding
                        },
                        {
                            Condition: 'LessThanEqual',
                            Property: 'Height',
                            Value: '480'
                        },
                        {
                            Condition: 'LessThanEqual',
                            Property: 'VideoLevel',
                            Value: '41' // H.264 Level 4.1
                        }
                    ]
                },
                {
                    Type: 'Audio',
                    Codec: 'aac',
                    Conditions: [
                        {
                            Condition: 'LessThanEqual',
                            Property: 'AudioChannels',
                            Value: '2' // Stereo only - faster
                        }
                    ]
                }
            ],
            
            // Subtitle profiles
            SubtitleProfiles: [
                { Format: 'vtt', Method: 'External' },
                { Format: 'srt', Method: 'External' }
            ],
            
            // Response profiles - prefer certain formats
            ResponseProfiles: [
                {
                    Type: 'Video',
                    Container: 'mp4',
                    MimeType: 'video/mp4'
                }
            ]
        };
    }

    /**
     * Find the preferred audio stream index
     * Prefers Romanian, then English, then falls back to default
     */
    findPreferredAudioStream(mediaSource) {
        console.log('MediaSource:', mediaSource);
        console.log('MediaStreams:', mediaSource.MediaStreams);
        
        const audioStreams = (mediaSource.MediaStreams || []).filter(s => s.Type === 'Audio');
        
        console.log('Audio streams found:', audioStreams.length, audioStreams.map(s => ({
            index: s.Index,
            lang: s.Language,
            title: s.DisplayTitle || s.Title,
            isDefault: s.IsDefault
        })));
        
        if (audioStreams.length === 0) {
            console.log('No audio streams found');
            return null;
        }

        // Preferred languages in order: Romanian first
        const romanianLanguages = ['rum', 'ron', 'ro', 'romanian'];
        
        // Look for Romanian audio
        for (const lang of romanianLanguages) {
            const stream = audioStreams.find(s => 
                s.Language?.toLowerCase() === lang ||
                s.DisplayTitle?.toLowerCase().includes('romanian') ||
                s.Title?.toLowerCase().includes('romanian')
            );
            if (stream) {
                console.log('Found Romanian audio track:', stream.Index, stream.DisplayTitle || stream.Language);
                return stream.Index;
            }
        }

        // If no Romanian, look for English
        const englishLanguages = ['eng', 'en', 'english'];
        for (const lang of englishLanguages) {
            const stream = audioStreams.find(s => 
                s.Language?.toLowerCase() === lang ||
                s.DisplayTitle?.toLowerCase().includes('english') ||
                s.Title?.toLowerCase().includes('english')
            );
            if (stream) {
                console.log('Found English audio track:', stream.Index, stream.DisplayTitle || stream.Language);
                return stream.Index;
            }
        }

        // Fall back to default audio stream
        const defaultStream = audioStreams.find(s => s.IsDefault) || audioStreams[0];
        console.log('Using default audio track:', defaultStream.Index, defaultStream.DisplayTitle || defaultStream.Language);
        return defaultStream.Index;
    }

    /**
     * Get streaming URL for an item
     */
    getStreamUrl(itemId, mediaSourceId, playSessionId, audioStreamIndex = null) {
        const params = new URLSearchParams({
            UserId: this.userId,
            MediaSourceId: mediaSourceId,
            PlaySessionId: playSessionId,
            api_key: this.accessToken,
            Static: 'true'
        });

        if (audioStreamIndex !== null) {
            params.set('AudioStreamIndex', audioStreamIndex);
        }

        return `${this.serverUrl}/Videos/${itemId}/stream?${params}`;
    }

    /**
     * Get HLS streaming URL for transcoding
     * Simplified parameters for better compatibility
     */
    getHlsStreamUrl(itemId, mediaSourceId, playSessionId, audioStreamIndex = null) {
        const params = new URLSearchParams({
            UserId: this.userId,
            MediaSourceId: mediaSourceId,
            PlaySessionId: playSessionId,
            api_key: this.accessToken,
            DeviceId: this.deviceId,
            
            // Video settings - 480p
            VideoCodec: 'h264',
            MaxWidth: 854,
            MaxHeight: 480,
            VideoBitRate: 1500000,
            
            // Audio settings  
            AudioCodec: 'aac',
            AudioBitRate: 128000,
            MaxAudioChannels: 2,
            
            // Required params
            TranscodingMaxAudioChannels: 2,
            SegmentContainer: 'ts',
            MinSegments: 1,
            
            // Let Jellyfin handle stream copy decisions
            RequireAvc: false,
            RequireNonAnamorphic: false,
            
            // Context
            Context: 'Streaming',
            StartTimeTicks: 0
        });

        if (audioStreamIndex !== null) {
            params.set('AudioStreamIndex', audioStreamIndex);
        }

        return `${this.serverUrl}/Videos/${itemId}/master.m3u8?${params}`;
    }

    /**
     * Get primary image URL for an item
     */
    getImageUrl(itemId, imageType = 'Primary', options = {}) {
        const params = new URLSearchParams({
            fillWidth: options.width || 400,
            fillHeight: options.height || 225,
            quality: options.quality || 90
        });

        return `${this.serverUrl}/Items/${itemId}/Images/${imageType}?${params}`;
    }

    /**
     * Get backdrop/thumbnail image - prefer Thumb, then Backdrop, then Primary
     */
    getThumbUrl(item, options = {}) {
        const width = options.width || 400;
        const height = options.height || 225;

        // Check what images are available
        if (item.ImageTags?.Thumb) {
            return this.getImageUrl(item.Id, 'Thumb', { width, height });
        }
        if (item.BackdropImageTags?.length > 0) {
            return this.getImageUrl(item.Id, 'Backdrop', { width, height });
        }
        if (item.ImageTags?.Primary) {
            return this.getImageUrl(item.Id, 'Primary', { width, height });
        }
        // For episodes, try series images
        if (item.SeriesId) {
            if (item.SeriesThumbImageTag) {
                return `${this.serverUrl}/Items/${item.SeriesId}/Images/Thumb?fillWidth=${width}&fillHeight=${height}&quality=90`;
            }
            return `${this.serverUrl}/Items/${item.SeriesId}/Images/Primary?fillWidth=${width}&fillHeight=${height}&quality=90`;
        }

        // Return placeholder
        return null;
    }

    /**
     * Report playback start
     */
    async reportPlaybackStart(itemId, mediaSourceId, playSessionId) {
        await this.request('/Sessions/Playing', {
            method: 'POST',
            body: JSON.stringify({
                ItemId: itemId,
                MediaSourceId: mediaSourceId,
                PlaySessionId: playSessionId,
                PlayMethod: 'DirectStream'
            })
        });
    }

    /**
     * Report playback progress
     */
    async reportPlaybackProgress(itemId, mediaSourceId, playSessionId, positionTicks, isPaused = false) {
        await this.request('/Sessions/Playing/Progress', {
            method: 'POST',
            body: JSON.stringify({
                ItemId: itemId,
                MediaSourceId: mediaSourceId,
                PlaySessionId: playSessionId,
                PositionTicks: positionTicks,
                IsPaused: isPaused,
                PlayMethod: 'DirectStream'
            })
        });
    }

    /**
     * Report playback stopped
     */
    async reportPlaybackStopped(itemId, mediaSourceId, playSessionId, positionTicks) {
        await this.request('/Sessions/Playing/Stopped', {
            method: 'POST',
            body: JSON.stringify({
                ItemId: itemId,
                MediaSourceId: mediaSourceId,
                PlaySessionId: playSessionId,
                PositionTicks: positionTicks
            })
        });
    }

    /**
     * Toggle favorite status
     */
    async toggleFavorite(itemId, isFavorite) {
        const method = isFavorite ? 'DELETE' : 'POST';
        await this.request(`/Users/${this.userId}/FavoriteItems/${itemId}`, { method });
        return !isFavorite;
    }
}

// Export singleton instance
const jellyfinAPI = new JellyfinAPI();
