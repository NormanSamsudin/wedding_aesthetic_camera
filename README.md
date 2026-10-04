# Wedding Wish Booth

A video guestbook that runs entirely on your laptop. A tablet at the venue opens the booth over the local wifi, guests record a short video wish, and every wish is saved straight to a folder on your laptop. Nothing is uploaded to the internet.

- **Booth** (on the tablet): one tap on *Start recording* starts a 3-2-1 countdown, then recording, review, and thank you.
- **Gallery** (on the tablet, via *Watch the wishes*): a cinema-style page with a featured wish, *Morning*, *Afternoon*, *Evening* and *Night* filters, a *Just in* row and a row for each session, and a full-screen player with *Up next* and *Play all*.

## What you need

- A laptop with [Node.js](https://nodejs.org) 18 or newer.
- An iPad (Safari) or Android tablet (Chrome).
- A wifi network that both can join. Venue guest wifi often blocks devices from seeing each other, so use your **laptop's hotspot** or a small travel router.

## Set up once

```bash
git clone https://github.com/NormanSamsudin/wedding_aesthetic_camera.git
cd wedding_aesthetic_camera
npm install
```

Optionally edit `config.json`:

| Setting | What it does |
| --- | --- |
| `dataDir` | Where event folders are saved. Leave `""` for the default (see [Events](#events)). |
| `welcomeLine`, `accent`, `maxSeconds`, `language` | Starting values for new events (`language` is `"ms"` or `"en"`). |
| `galleryPin` | Set a PIN to lock the gallery. Leave `""` (the default) so guests can open it from the booth without a PIN. |

The names, date and colour are set per event in the settings page, not here.

Start it:

```bash
npm start
```

The terminal prints the addresses and a QR code. The first run creates a private certificate in `certs/`.

### Trust the laptop on the tablet (once)

Browsers only allow the camera on `https://` pages, so the tablet has to trust your laptop's certificate.

1. On the tablet, scan the QR code or open the **setup** address from the terminal (for example `http://192.168.1.20:3000/setup`).
2. Follow the steps on that page to download and install the certificate (iPad and Android instructions are both there).
3. Tap **Open the booth**. It should open with no warning. Allow the camera and microphone.
4. The first time, the booth says **Select an event first**. Tap **Open settings** and create the event (see [Events](#events)).

You only do this once per tablet. If the laptop later joins a different network, the server re-issues its certificate automatically and the tablet keeps trusting it. If you delete the `certs/` folder, repeat the setup.

## On the wedding day

1. Turn on the laptop hotspot (or router) and connect the tablet to it.
2. Plug in the laptop, turn off sleep, and run `npm start`. Check the terminal says *Recording into* the right event.
3. On the tablet, open the booth from its home-screen icon and lock it to the booth with **Guided Access** (iPad) or **App pinning** (Android). The setup page explains how.
4. Keep the tablet charging and set its auto-lock to *Never*.
5. Afterwards, copy the event's folder to a backup drive.

## Or run everything on an Android tablet

No laptop needed: run the server on the tablet with [Termux](https://github.com/termux/termux-app/releases) (install from F-Droid or GitHub, not the Play Store) and open `http://localhost:3000` in Chrome. Chrome allows the camera on `localhost`, so there is no certificate to install.

```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs-lts git
termux-setup-storage
git clone https://github.com/NormanSamsudin/wedding_aesthetic_camera.git
cd wedding_aesthetic_camera && npm install
termux-wake-lock
npm start
```

Set Termux's battery usage to *Unrestricted* so Android doesn't stop it. Because of `termux-setup-storage`, the event folders are saved in the tablet's shared storage under **WishBooth**, so they show up in the Files app and can be copied to a USB drive or laptop from there.

## Events

Every wedding (or any occasion) is an **event** with its own folder. The booth won't record until an event is selected, so wishes always land in the right folder.

Open **`/settings`** on the booth (for example `http://localhost:3000/settings`), or hold the names on the booth's welcome screen for three seconds. There you can:

- create an event with its names, date, line above the names, accent colour, longest wish length, booth language (Bahasa Melayu or English) and the ideas shown while guests record (creating one also selects it),
- select which event the booth records into,
- edit an event,
- open **Wishes** to watch an event's wishes and hide any you don't want in the gallery (the video stays in the folder, and you can show it again),
- see how much space is left,
- set a **PIN** so guests can't open settings. If you forget it, delete `lock.json` from the folder that holds the event folders.

Each wish is saved to the selected event's folder the moment a guest taps **Send**:

```
WishBooth/                              (or events/ in this folder on a laptop)
  active.json                           which event the booth records into
  aisyah-norman-12-12-2026/
    event.json                          names, date, colour, max length
    index.json                          time and length of every wish
    2026-12-12_20-14-05_wish_3f2a.mp4   the video (or .webm on older Android Chrome)
    2026-12-12_20-14-05_wish_3f2a.jpg   still frame for the gallery
```

The folder is `~/storage/shared/WishBooth` on a tablet running Termux (after `termux-setup-storage`), otherwise `events/` next to `server.js`. Set `dataDir` in `config.json` to put it somewhere else. The settings page and the terminal both show the full path. To keep the videos, copy the event's folder.

The gallery shows the selected event. To look back at another event, tap **Wishes** next to it in settings.

## Good to know

- Videos are recorded as MP4 when the browser supports it (iPads and recent Chrome), which plays everywhere. Older Android Chrome records WebM, which plays in Chrome, Edge and Firefox but not Safari.
- If a save fails (for example the wifi drops or Termux is stopped), the wish is kept in the tablet's browser and the guest still gets a thank-you. The booth sends it every 30 seconds until the server is back, with the time it was recorded, and the welcome screen shows how many are waiting. Don't clear Chrome's site data while any are waiting.
- When less than 1 GB is free, the welcome screen shows a small "storage almost full" note. Settings shows the free space and roughly how many more wishes fit.
- While counting down and recording, an idea of what to say fades in and changes every few seconds. Leave an event's ideas empty to use the built-in ones in its language.
- The booth goes back to the welcome screen if a guest leaves the review screen for a minute, and after each thank-you screen.
- Guests can tap **Watch the wishes** on the booth's welcome screen to browse the gallery, and **Start recording** to go straight back into the countdown. The gallery opens inside the booth page, so the tablet stays full screen and the camera stays on. It returns to the booth by itself after two minutes without a touch (unless a wish is playing).
- Gallery sessions: Morning 5 am to 12 pm, Afternoon 12 pm to 5 pm, Evening 5 pm to 9 pm, Night 9 pm to 5 am (a 1 am wish counts as the night before). Change the hours in `SESSIONS` in `public/gallery/gallery.js`, and the words in `public/i18n.js`.
- `events/`, `wishes/` and `certs/` are in `.gitignore`, so guest videos and your private key are never committed. Wishes recorded before events existed stay in `wishes/` and aren't shown in the gallery.
