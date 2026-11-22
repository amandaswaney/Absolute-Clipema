# Backup robot on an old Android phone

Use this only if YouTube keeps blocking the robot on GitHub even with cookies. The phone runs the same robot code from your home Wi-Fi. Keep it plugged in and on Wi-Fi.

## Install (about 20 minutes)

1. On the old phone, install **F-Droid** from https://f-droid.org, then install **Termux** from inside F-Droid. (The Play Store version of Termux is out of date; do not use it.)
2. Open Termux and type these lines one at a time, pressing Enter after each. Say **y** if asked.

   ```
   pkg update
   pkg install nodejs-lts ffmpeg python git
   pip install --pre "yt-dlp[default]"
   git clone https://github.com/amandaswaney/Absolute-Clipema
   cd Absolute-Clipema/worker
   npm install
   ```

3. Make the settings file. Type `nano .env` and type or paste these lines, with your own values (the same ones you put in GitHub secrets):

   ```
   B2_KEY_ID=your keyID
   B2_APP_KEY=your applicationKey
   B2_BUCKET=your bucket name
   B2_ENDPOINT=s3.us-east-005.backblazeb2.com
   ROBOT_NAME=Old Android phone
   FIREBASE_SERVICE_ACCOUNT_FILE=/data/data/com.termux/files/home/service-account.json
   ```

   Save with **Ctrl+O**, Enter, then **Ctrl+X**. (On the Termux keyboard, Ctrl is on the extra key row.)

4. Copy the Firebase `.json` key file onto the phone, then in Termux run `termux-setup-storage` (allow access) and copy it into place, for example:

   ```
   cp ~/storage/downloads/*firebase-adminsdk*.json ~/service-account.json
   ```

5. Start the robot:

   ```
   termux-wake-lock
   npm run loop
   ```

   It checks for new clips every minute. Leave Termux open. "Last ran" in **Me → Admin → Robot** will say "Old Android phone".

## Keeping it up to date

Once a month, or when clips start failing, stop it with **Ctrl+C** and run:

```
pip install -U --pre "yt-dlp[default]"
cd ~/Absolute-Clipema && git pull && cd worker && npm install
npm run loop
```

## Notes

- The GitHub robot keeps running too. Both can run at once safely: each clip is only ever picked up by one of them.
- If you want only the phone to grab clips, open the repository on GitHub, **Actions → Clip robot → ⋯ → Disable workflow**.
