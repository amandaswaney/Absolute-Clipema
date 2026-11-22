# Absolute Clipema: spec and build plan

A private, non-commercial clip and meme app for Aman and 5 to 15 friends. Same idea as Vlipsy, with our own name, logo and colours. It costs nothing to run and needs no credit card.

## What it does

- **Install it like an app.** It is a website you add to your home screen (iPhone: Share, then Add to Home Screen. Android: menu, then Install app). No app stores.
- **Invite only.** Aman (the admin) makes a one-time invite code for each friend. Friends join with the code, a username and a password. No email or phone number.
- **No password reset by email.** If someone forgets their password, Aman sets a new temporary one for them from the Admin screen.
- **Make clips from YouTube.** Paste a YouTube link, watch it in the built-in player, mark one or more start and end points, then either join them into one clip or save each as its own clip. Instagram, Threads, X and TikTok links can be tried too (you type the times by hand), but they fail more often.
- **Make clips from your gallery.** Pick a video on your phone, mark the parts you want, and the phone itself cuts it before uploading.
- **60 seconds max** per finished clip. Clips are saved as 720p MP4 with a thumbnail.
- **Details.** Each clip has a name, tags, a category, and is either shared with the group or kept personal (only you see it).
- **Find clips.** Search by name, tag, category or uploader. Home shows Trending this week and New from the group, with category chips.
- **Use clips.** Play, download, or share the actual video file to WhatsApp, Instagram, iMessage and others through the phone's share sheet.
- **Your stuff.** Favourites, your uploads, and your own folders.
- **Deleting.** The person who uploaded a clip, and Aman, can delete it.
- **Admin (Aman only).** Create and cancel invite codes, see members, reset a member's password, remove a member, and check the clip robot's health.
- **Seven colour themes on every screen**, chosen per person under App colours: Pimpin Purple (default), Emerald Green, Sapphire Blue, Ruby Red, Midnight Black, Ivory White and Panda, each with its neon accent.

## How it is built (all free tiers, no card)

| Part | Service | Why |
|---|---|---|
| The app itself | GitHub Pages | Free hosting straight from the GitHub repository |
| Accounts and data | Firebase Authentication and Cloud Firestore (Spark plan) | Free sign-in and database |
| Video and thumbnail files | Backblaze B2 | 10 GB free storage with no card |
| The clip robot | GitHub Actions | Free computer time for public repositories. Runs yt-dlp and ffmpeg to grab only the chosen bits of a YouTube video, cut and join them, and upload the result |
| Gallery cutting | ffmpeg.wasm in the browser | The phone cuts its own videos, so no server is needed |
| Fallback robot | An old Android phone with Termux | Runs the exact same robot code if GitHub ever stops working for YouTube |

There is no server or laptop to keep running.

### How a YouTube clip gets made

1. In the app you paste the link, mark the ranges and fill in the details.
2. The app saves a "job" in the database and pokes the robot on GitHub.
3. The robot wakes up (usually within a minute; if the poke fails it checks every 10 minutes anyway), downloads only the chosen seconds, cuts them precisely, joins or splits them, makes 720p MP4s and thumbnails, uploads them to Backblaze, and adds the clips to the database.
4. Your phone shows the finished clip.

### How a gallery clip gets made

1. You pick a video and mark the ranges.
2. The phone cuts and shrinks it to 720p (this can take a minute for longer clips).
3. The phone uploads the finished file in small pieces to the database, and the robot moves it to Backblaze and makes the thumbnail.

### Keeping it working with no maintenance

- The robot always installs the newest yt-dlp each time it runs, so YouTube fixes arrive automatically.
- A weekly check runs on its own every Monday: it updates yt-dlp, test-grabs a few seconds of a known YouTube video, records the result, and keeps the scheduled jobs switched on (GitHub switches off schedules after 60 days without changes). If the check fails, GitHub emails Aman.
- The Admin screen shows when the robot last ran and whether the weekly check passed.

### Data layout (Firestore)

- `users/{uid}`: username, role (admin or member), theme, favourites, removed flag. Personal clips live in `users/{uid}/clips`, folders in `users/{uid}/folders`.
- `usernames/{name}`: makes usernames unique.
- `invites/{code}`: one-time invite codes.
- `clips/{id}`: group clips (title, tags, category, uploader, video and thumbnail links, length, views, favourites, shares).
- `jobs/{id}`: clips waiting for the robot. Gallery uploads carry their file in `jobs/{id}/chunks`.
- `trash/{id}`: deleted clips waiting for the robot to remove their files from Backblaze.
- `adminTasks/{id}`: password resets and member removals for the robot to carry out.
- `config/status`: robot health. `config/trigger`: the GitHub key that lets the app poke the robot.

Security rules (in `firestore.rules`) only let signed-in members read anything, only let people change their own things, and keep admin actions for Aman.

## Build plan

1. Repository skeleton, Firebase SDK and ffmpeg.wasm bundled in, so nothing depends on outside script hosts.
2. App shell: sign in and join with invite codes, the seven themes, bottom navigation, installable PWA.
3. Browse: Home, Search, clip detail with play, share, download, favourite, add to folder, delete.
4. Library: favourites, my uploads, folders. Me: App colours, install help, change password, sign out.
5. Admin: invites, members, password reset, remove member, robot settings and health.
6. Create: YouTube player with range marking, join or split, gallery picking and in-browser cutting, details, live progress.
7. Robot: GitHub Actions workflows for the clip robot, the one-time setup, the site deploy and the weekly check. Same robot runs on Termux.
8. Security rules, then testing everything against the Firebase emulator in a real browser.
9. Plain step-by-step setup guide for Aman, plus the phone fallback and maintenance notes.

## Known limits

- YouTube sometimes blocks robots on GitHub's computers. A spare Google account's cookies (stored as a GitHub secret) usually fixes it. If it ever stops working completely, the Android phone fallback runs from a home connection.
- Free limits: 10 GB of video on Backblaze (roughly 1,000 to 2,000 short clips), 50,000 database reads a day. That is plenty for a group of 15.
- Clip videos are stored in a public Backblaze bucket with unguessable file names. Anyone with an exact video link can watch that one video, which is what makes sharing work; nobody can browse the collection without an account.
- The code is in a public GitHub repository (needed for free hosting and robot time). No passwords, keys or clips are in the code.
