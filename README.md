# Absolute Clipema

A private clip and meme app for a group of friends. Paste a YouTube link or pick a video from your phone, cut out the good bit, tag it, and share the actual video to any app.

- **Setting it up:** [docs/SETUP.md](docs/SETUP.md) (phone-friendly, step by step, no card needed)
- **What it does and how it is built:** [docs/SPEC.md](docs/SPEC.md)
- **Backup robot on an old Android phone:** [docs/PHONE-ROBOT.md](docs/PHONE-ROBOT.md)

## Layout

| Folder | What is in it |
|---|---|
| `web/` | The app itself (plain HTML, CSS and JavaScript, published to GitHub Pages). Firebase and ffmpeg.wasm are bundled in `web/vendor/`. |
| `worker/` | The clip robot (Node.js). Uses yt-dlp and ffmpeg, saves to Backblaze B2. |
| `firestore.rules` | Database security rules. Published automatically on every change. |
| `.github/workflows/` | `robot.yml` makes clips, `deploy-site.yml` publishes the app, `setup.yml` is the one-time setup, `weekly-check.yml` tests YouTube grabbing every Monday. |
| `status/` | The weekly check's last result. |

## Working on it

The app has no build step. To try it locally against the Firebase emulators, put `emulator: { host: "127.0.0.1" }` in `web/config.js`, run `firebase emulators:start --only auth,firestore` with `firestore.rules`, serve `web/` with any static server, and run the robot with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 STORAGE_DIR=/tmp/clips node worker/src/robot.js`.
