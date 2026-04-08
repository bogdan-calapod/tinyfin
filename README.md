# TinyFin

A kid-friendly Jellyfin web client designed for young children who cannot read. Inspired by YouTube Kids.

## Features

- **No Text UI**: Large colorful posters and icons only
- **Simple Navigation**: Three big buttons - All, Favorites, Recent
- **Touch Optimized**: Large tap targets, swipe gestures
- **Flat Content View**: All movies, shows, and videos in one scrollable grid
- **Related Content Drawer**: Swipe up during playback to see related videos or next episodes
- **Auto-play**: Automatically plays next episode or related content

## Deployment

### GitHub Pages

1. Fork or push this repo to GitHub
2. Go to Settings > Pages
3. Set source to "Deploy from a branch"
4. Select `main` branch and `/ (root)` folder
5. Your app will be available at `https://username.github.io/tinyfin/`

### Self-Hosted

Simply serve the files with any static web server:

```bash
# Python
python -m http.server 8080

# Node.js
npx serve

# Nginx/Apache
# Just point document root to this directory
```

## Setup

1. Open the app in a browser
2. Enter your Jellyfin server URL (e.g., `https://jellyfin.example.com`)
3. Enter credentials for a user account with access to kid-friendly content
4. The app remembers login credentials in the browser

## Tips for Parents

- **Create a dedicated Jellyfin user** for your child with only appropriate libraries visible
- **Use Jellyfin's parental controls** to restrict content
- **Add to Home Screen** on the tablet for app-like experience
- **Lock orientation** to landscape for best experience

## Navigation

| Icon | Function |
|------|----------|
| Grid (Orange) | Show all content |
| Heart (Pink) | Show favorites |
| Star (Yellow) | Show recently watched |
| Gear (Purple) | Settings / Logout |

## Playback Controls

- **Tap screen**: Show/hide play/pause button
- **Swipe up** from bottom: Open related videos drawer
- **Swipe down** on drawer: Close it
- **Back arrow** (top left): Return to home

## Browser Support

- Chrome/Chromium (recommended)
- Safari (iOS/macOS)
- Firefox
- Edge

## License

MIT
