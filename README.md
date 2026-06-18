# Puff

A virtual cigarette to help you quit smoking. Hold the screen and blow into your mic to simulate smoking — watch the ember glow, ash build up, and smoke rise.

Built as a Progressive Web App (PWA) that runs entirely in the browser. Add it to your home screen for the full experience.

**[Try it live →](https://wsamuelw.github.io/puff/)**

## Features

### Core Experience
- **Hold + Blow mechanic** — hold anywhere on screen and blow into the mic to smoke
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
- **Milestone cards** — shareable cards for key quit milestones (1 day, 1 week, 1 month, etc.)
- **Health timeline** — track your body's recovery milestones
- **Progress reminders** — nudge notifications when you haven't logged in

### Account & Sync
- **Google sign-in** — authenticate with your Google account
- **Cross-device sync** — data syncs across all your devices via Firebase
- **GDPR consent** — explicit opt-in for cloud sync and analytics
- **Offline support** — full functionality without internet, syncs when reconnected

### Customisation
- **12 trigger options** — stress, drinking, coffee, meals, boredom, driving, after sex, work break, scrolling, walking, social, morning
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
2. Tap the screen to start
3. Complete the 3-step onboarding tutorial
4. Grant microphone access when prompted
5. Select your trigger and hold the screen to smoke

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
├── app.js              # Core application logic (~2800 lines)
├── style.css           # All styling (~1700 lines)
├── sw.js               # Service worker for offline support
├── manifest.json       # PWA manifest
├── mockups/            # Design mockups for features
├── screenshots/        # App screenshots
├── privacy.html        # Privacy policy
└── terms.html          # Terms of service
```

## Browser support

| Feature | Safari iOS | Chrome Android | Desktop |
|---|---|---|---|
| Core app | ✅ | ✅ | ✅ |
| Mic blow detection | ✅ | ✅ | ✅ |
| PWA install | ✅ | ✅ | ✅ |
| Google sign-in | ✅ | ✅ | ✅ |
| Push notifications | ❌ | ✅ | ✅ |

## License

MIT
