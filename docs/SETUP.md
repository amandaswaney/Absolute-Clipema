# Absolute Clipema: setup guide

Everything here can be done on a phone. It takes about 45 minutes, once. Nothing needs a credit card.

You will make three free accounts' worth of settings (Firebase, Backblaze, GitHub), paste some values into GitHub as "secrets", press two buttons, and then you are in.

Tip: keep a notes app open. Several steps say "copy this into your notes"; you will paste them into GitHub in step 5. Delete that note when you are done, because some of the values are passwords.

---

## Step 1. Firebase (accounts and database)

1. Go to **https://console.firebase.google.com** and sign in with your Google account.
2. Tap **Create a project**. Name it `absolute-clipema`. Turn **off** Google Analytics. Tap **Create project**, then **Continue**.
3. **Turn on usernames and passwords**
   - In the left menu (tap ☰ on a phone), open **Build → Authentication**, tap **Get started**.
   - Tap **Email/Password**, switch on the first toggle (**Enable**), leave "Email link" off, tap **Save**.
   - (The app uses usernames. Behind the scenes it turns them into fake addresses that never receive email.)
4. **Make the database**
   - Open **Build → Firestore Database**, tap **Create database**.
   - Pick the **Standard** edition if asked. Location: choose one near you (for example `nam5 (United States)`). This cannot be changed later, but any choice works.
   - Choose **Start in production mode**, tap **Create**.
5. **Get the web settings**
   - Go back to **Project Overview** (the house icon at the top of the menu).
   - Tap the **web** icon, which looks like `</>`. Nickname: `web`. Do **not** tick Firebase Hosting. Tap **Register app**.
   - You will see a block of code starting with `const firebaseConfig = {`. Copy everything from `const firebaseConfig` down to the `};` into your notes, labelled **FIREBASE_WEB_CONFIG**. Tap **Continue to console**.
6. **Get the robot's key**
   - Tap the **gear icon → Project settings → Service accounts**.
   - Tap **Generate new private key**, then **Generate key**. A small `.json` file downloads.
   - Open that file and copy all of its text, from the first `{` to the last `}`. Label it **FIREBASE_SERVICE_ACCOUNT** in your notes.
     - iPhone: open the Files app, Downloads, tap the file. Press and hold on the text, **Select All**, **Copy**. If it will not show the text, tap Share and open it in a text app.
     - Android: open it from Downloads with any text viewer, select all, copy.
   - Keep this text secret. It is the robot's master key to your database.

## Step 2. Backblaze B2 (video storage)

1. Go to **https://www.backblaze.com/sign-up/cloud-storage** and make a free B2 account. You never need to add a card or make a purchase.
2. Open **B2 Cloud Storage → Buckets → Create a Bucket**.
   - Bucket name: something unique, like `clipema-aman-2026`. Copy it into your notes as **B2_BUCKET**.
   - Files in Bucket: **Private**. (Public buckets need a $1 card check, so the app uses a private bucket. The robot hands the app a pass to read the videos, and renews it every few days by itself.)
   - Leave encryption and object lock off. Tap **Create a Bucket**.
3. On the new bucket's card, find **Endpoint**, for example `s3.us-east-005.backblazeb2.com`. Copy it into your notes as **B2_ENDPOINT**.
4. Still on the bucket's card, tap **CORS Rules**. Choose **Share everything in this bucket with all HTTPS origins**, and below that choose **Apply CORS rules to both S3 Compatible API and B2 Native API**. Tap **Update CORS Rules**. (This lets the app share the actual video file to WhatsApp and others.)
5. Open **Application Keys → Add a New Application Key**.
   - Name: `clipema-robot`.
   - Allow access to bucket: your bucket.
   - Type of access: **Read and Write**.
   - Tap **Create New Key**.
   - Copy **keyID** into your notes as **B2_KEY_ID**, and **applicationKey** as **B2_APP_KEY**. The applicationKey is only shown once.

## Step 3. Make up your admin code

Make up a code only you know, at least 6 letters or numbers, like `AMAN-BOSS-7731`. Write it in your notes as **ADMIN_SETUP_CODE**. You will use it once to join as the admin.

## Step 4. Turn on the website

1. Open **https://github.com/amandaswaney/Absolute-Clipema**.
2. Tap **Settings** (on a phone, it may be under the `…` menu or you may need "Desktop site").
3. In the left menu, tap **Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.

## Step 5. Add the secrets to GitHub

1. Still in **Settings**, open **Secrets and variables → Actions**.
2. For each item below, tap **New repository secret**, type the **Name** exactly as shown, paste the value from your notes into **Secret**, and tap **Add secret**.

| Name | What to paste |
|---|---|
| `FIREBASE_WEB_CONFIG` | The `const firebaseConfig = { … };` block from step 1.5 |
| `FIREBASE_SERVICE_ACCOUNT` | All the text of the `.json` file from step 1.6 |
| `B2_BUCKET` | Your bucket name |
| `B2_ENDPOINT` | The endpoint, like `s3.us-east-005.backblazeb2.com` |
| `B2_KEY_ID` | keyID |
| `B2_APP_KEY` | applicationKey |
| `ADMIN_SETUP_CODE` | Your made-up admin code |

`YOUTUBE_COOKIES` is optional. Only add it if YouTube clips fail (see the last section).

## Step 6. Run the one-time setup

1. Open the **Actions** tab of the repository. If GitHub asks, tap **I understand my workflows, go ahead and enable them**.
2. Tap **One-time setup** in the list, then **Run workflow**, then the green **Run workflow** button.
3. Wait about a minute and tap the run. Open **setup → Set everything up**. At the bottom you will see a list. Every line should start with **OK**.
   - If a line says **FAIL**, it says why (usually a secret pasted wrongly). Fix that secret and run it again. It is safe to run as many times as you like.
4. Now tap **Publish the app** in the Actions list, **Run workflow**, **Run workflow**. Wait about a minute until it has a green tick.

## Step 7. Join as the admin

1. Open **https://amandaswaney.github.io/Absolute-Clipema/** on your phone.
2. Tap **Join**. Invite code: your **ADMIN_SETUP_CODE**. Pick your username and password. There is no "forgot password", so remember it.
3. Put it on your home screen: on iPhone use Safari, tap **Share → Add to Home Screen**. On Android use Chrome, tap **⋮ → Install app**. (The app's **Me** screen explains this too.)
4. Open **Me → Admin → Robot**. "Last ran" should show a time from the last 10 minutes.

## Step 8. Invite your friends

**Me → Admin → Invites**. Type who it is for, tap **Make an invite code**, then **Send**. Each code works once. Your friend opens the link in the message, taps **Join** and types the code.

## Step 9 (optional, recommended). Make clips arrive in about a minute

Without this, the robot checks for new clips every 10 minutes (GitHub can sometimes be a bit slower than that). With it, the app starts the robot the moment someone makes a clip.

1. Open **https://github.com/settings/personal-access-tokens/new**.
2. Token name: `clipema quick start`. Expiration: the longest it offers (set a calendar reminder to redo this step before it runs out; the app keeps working without it, just slower).
3. Repository access: **Only select repositories → Absolute-Clipema**.
4. Permissions: open **Repository permissions**, find **Actions**, set it to **Read and write**. Leave everything else as it is.
5. Tap **Generate token** and copy it (starts with `github_pat_`).
6. In the app: **Me → Admin → Robot → Quick start key**. Paste it, tap **Save key**, then **Test it**.

This key can only start and stop the robot on this one repository. Everyone signed in to the app can technically read it, which is fine for that reason.

---

## Everyday admin

- **Someone forgot their password:** Me → Admin → Members → the key icon next to them. A new password is suggested; tap **Set password** and tell them. It works within a minute or so.
- **Remove someone:** Me → Admin → Members → the bin icon. They are signed out and cannot sign back in. Tap the arrow icon to let them back in.
- **Delete any clip:** open it, tap the pencil, **Delete clip**.

## Free limits (plenty for 15 people)

- Backblaze: 10 GB of video free. A 10-second clip is about 2 to 4 MB, so thousands of clips. If it ever fills up, uploads stop (you are never charged without a card).
- Firebase: 50,000 reads and 20,000 writes a day.
- GitHub: unlimited robot time for public repositories.

## If YouTube clips stop working

Clips from YouTube failing with "YouTube asked the robot to prove it is not a bot", or the weekly check emailing you, means YouTube is blocking GitHub's computers. Two fixes, easiest first:

### Fix 1: give the robot YouTube cookies from a spare Google account

Use a spare Google account, never your main one, in case YouTube gets cross with it.

On an Android phone:
1. Install **Firefox** from the Play Store. In Firefox, open **⋮ → Extensions**, find and add **cookies.txt** (by Lennon Hill), and allow it to run in private tabs.
2. Open a **new private tab**, go to youtube.com and sign in with the spare account.
3. In the same private tab go to **youtube.com/robots.txt**, then open **⋮ → Extensions → cookies.txt** and export cookies for this site. Open the saved file and copy all of its text.
4. Close the private tab straight away (so YouTube does not change those cookies).
5. In GitHub, add a secret called `YOUTUBE_COOKIES` and paste the text.

On a computer you can borrow, the same steps work with Firefox or Chrome and the "Get cookies.txt LOCALLY" extension.

Cookies last weeks to months. If the weekly check fails again later, repeat this.

### Fix 2: run the robot on an old Android phone

See [PHONE-ROBOT.md](PHONE-ROBOT.md). The phone runs the exact same robot from your home internet, which YouTube rarely blocks.

## Every few months

Nothing is required. When you visit:
- Glance at **Me → Admin → Robot**. The weekly check should say **passed**.
- If you made the quick start key, check it has not expired (redo step 9 if it has).
- GitHub emails you if the weekly check fails.
