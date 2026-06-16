# Puff

A virtual cigarette to help you quit smoking. Hold the screen and blow into your mic to simulate smoking — watch the ember glow, ash build up, and smoke rise.

Built as a Progressive Web App (PWA) that runs entirely in the browser. Add it to your home screen for the full experience.

**[Try it live →](https://wsamuelw.github.io/puff/)**

## Features

- **Hold + Blow mechanic** — hold anywhere on screen and blow into the mic to smoke
- **Double-tap to flick ash** — shake off built-up ash with a double tap
- **Breathing exercises** — guided 4-7-8 breathing for craving moments
- **Health timeline** — track your body's recovery milestones
- **Craving & slip-up logging** — journal your triggers and track patterns
- **Money saved counter** — see how much you've saved since quitting
- **Cross-device sync** — sign in with Google to sync data across devices
- **Dark & light mode** — toggle in settings
- **PWA support** — install to home screen, works offline

## How it works

The app uses the Web Audio API to detect blowing into the microphone. When you hold the screen, the mic activates and blow intensity controls the cigarette — harder blow = brighter ember, more smoke, faster burn.

## Getting started

### Use it

1. Open the app in Safari or Chrome on your phone
2. Tap the screen to start
3. Grant microphone access when prompted
4. Hold the screen and blow to smoke

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
- Canvas 2D rendering
- Web Audio API (mic blow detection)
- Firebase Authentication (Google sign-in)
- Firebase Firestore (cross-device data sync)
- Service Worker (offline support)
- PWA manifest (home screen install)

## Browser support

| Feature | Safari iOS | Chrome Android | Desktop |
|---|---|---|---|
| Core app | ✅ | ✅ | ✅ |
| Mic blow detection | ✅ | ✅ | ✅ |
| PWA install | ✅ | ✅ | ✅ |
| Google sign-in | ✅ | ✅ | ✅ |

## License

MIT
