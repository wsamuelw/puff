# Puff

A virtual cigarette to help you quit smoking. Hold the screen and blow into your mic to simulate smoking — watch the ember glow, ash build up, and smoke rise.

Built as a Progressive Web App (PWA) that runs entirely in the browser. Add it to your home screen for the full experience.

**[Try it live →](https://wsamuelw.github.io/puff/)**

## Features

### Core Experience
- **Hold + Blow mechanic** — hold anywhere on screen and blow into the mic to smoke
- **Microphone required** — the app needs mic access to detect when you blow
- **Double-tap to flick ash** — shake off built-up ash with a double tap
- **White noise smoking sound** — ambient audio feedback while smoking
- **Background burn** — cigarette continues burning when you switch tabs

### Session Flow
- **Trigger selection** — log what's driving your craving (stress, boredom, coffee, etc.)
- **End screen stats** — see session duration, money saved, and trigger breakdown after each session
- **Smoke another** — start a new session without returning to the home screen

### Analytics & Insights
- **Trigger analytics** — horizontal bars showing your most common craving triggers
- **Time-of-day heatmap** — discover when your cravings hit hardest
- **Weekly summary** — compare this week vs last week (sessions, money saved, trend)
- **Money saved counter** — track savings based on your cigarette price

### Motivation
- **24 achievement badges** — earn badges for streaks, milestones, and healthy choices
- **Streak milestones** — celebrate 3 days, 1 week, 2 weeks, 1 month, 3 months, 6 months, and 1 year of consecutive daily use
- **Health timeline** — track your body's recovery milestones

### Account & Sync
- **Google sign-in** — authenticate with your Google account
- **Cross-device sync** — data syncs across all your devices via Firebase in real-time
- **GDPR consent** — explicit opt-in for cloud sync and analytics
- **Offline support** — full functionality without internet, syncs when reconnected

### Customisation
- **15 trigger options** — stress, anxiety, sadness, anger, tired, drinking, coffee, meals, social drinking, work break, toilet, after sex, boredom, morning routine, late night
- **Editable profile** — customise your name and cigarette price
- **Dark & light mode** — toggle in settings
- **Reset data** — clear all local and cloud data

## How it works

The app uses the Web Audio API to detect blowing into the microphone. When you hold the screen, the mic activates and blow intensity controls the cigarette — harder blow = brighter ember, more smoke, faster burn.

The cigarette renders on a Canvas 2D element with:
- Dynamic ember glow based on blow intensity
- Realistic smoke particle system
- Ash accumulation and filter tracking
- Consistent sizing across viewport changes

## Getting started

### Use it

1. Open the app in Safari or Chrome on your phone
2. Tap "Continue with Google" to sign in
3. Allow microphone access when prompted
4. Select your trigger and hold the screen to smoke
5. Blow into the mic to burn faster

### Run locally

```bash
# Any static server works
npx serve .
# or
python3 -m http.server 8000
```

Open `http://localhost:8000` in your browser.

### Deploy to GitHub Pages

1. Push this folder to a GitHub repo
2. Go to **Settings → Pages**
3. Set source to **main branch**, folder `/ (root)`
4. Your app will be live at `https://<username>.github.io/<repo-name>/`

## Tech stack

- Vanilla JavaScript (no frameworks)
- Canvas 2D rendering (cigarette simulation)
- Web Audio API (mic blow detection + white noise)
- Firebase Authentication (Google sign-in)
- Firebase Firestore (cross-device data sync)
- Service Worker (offline support)
- PWA manifest (home screen install)

## Project structure

```
├── index.html          # Main HTML with all screen overlays
├── app.js              # Core application logic
├── style.css           # All styling
├── sw.js               # Service worker for offline support
├── manifest.json       # PWA manifest
├── privacy.html        # Privacy policy
└── icons/              # PWA icons (192px, 512px)
```

## Browser support

| Feature | Safari iOS | Chrome Android | Desktop |
|---|---|---|---|
| Core app | ✅ | ✅ | ✅ |
| Mic blow detection | ✅ | ✅ | ✅ |
| PWA install | ✅ | ✅ | ✅ |
| Google sign-in | ✅ | ✅ | ✅ |

## License

MIT
