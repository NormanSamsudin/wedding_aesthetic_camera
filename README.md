# Wedding Wish Booth

A video guestbook that runs entirely on your laptop. A tablet at the venue opens the booth over the local wifi, guests record a short video wish, and every wish is saved straight to a folder on your laptop. Nothing is uploaded to the internet.

- **Booth** (on the tablet): welcome, name, family or friends, a 3-2-1 countdown, recording, review, then thank you.
- **Gallery** (on the laptop, TV or projector): a cinema-style page with a featured wish, rows for *Just in*, *From family* and *From friends*, a full-screen player with *Up next*, *Play all*, and *Download all*.

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

Edit `config.json`:

| Setting | What it does |
| --- | --- |
| `couple` | Names on the booth and gallery, e.g. `"Aisyah & Norman"`. The `&` is drawn in the accent colour. |
| `date` | Shown under the names on the welcome screen. |
| `welcomeLine` | Small line above the names. |
| `accent` | Accent colour, e.g. `"#B08D57"` gold, `"#8A9A7B"` sage, `"#C49A9A"` dusty rose. |
| `maxSeconds` | Longest a wish can be (default 60). |
| `galleryPin` | Set a PIN to lock the gallery. Leave `""` for no PIN. |

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

You only do this once per tablet. If the laptop later joins a different network, the server re-issues its certificate automatically and the tablet keeps trusting it. If you delete the `certs/` folder, repeat the setup.

## On the wedding day

1. Turn on the laptop hotspot (or router) and connect the tablet to it.
2. Plug in the laptop, turn off sleep, and run `npm start`.
3. On the tablet, open the booth from its home-screen icon and lock it to the booth with **Guided Access** (iPad) or **App pinning** (Android). The setup page explains how.
4. Keep the tablet charging and set its auto-lock to *Never*.
5. Open the gallery on the laptop at `http://localhost:3000/gallery` to watch wishes as they arrive.
6. Afterwards, copy the `wishes/` folder to a backup drive.

## Where the wishes go

Each wish is saved the moment a guest taps **Send** to `wishes/`:

```
wishes/
  2026-12-12_20-14-05_Farah_3f2a.mp4   the video (or .webm on older Android Chrome)
  2026-12-12_20-14-05_Farah_3f2a.jpg   still frame for the gallery
  index.json                            name, family/friends, time and length of every wish
```

**Download all** in the gallery gives you a zip of every video plus `index.json`.

## Good to know

- Videos are recorded as MP4 when the browser supports it (iPads and recent Chrome), which plays everywhere. Older Android Chrome records WebM, which plays in Chrome, Edge and Firefox but not Safari.
- If a save fails (for example the wifi drops), the guest sees **Try again** and the recording is kept, so they don't have to record again.
- The booth goes back to the welcome screen if a guest walks away for a minute, and after each thank-you screen.
- `wishes/` and `certs/` are in `.gitignore`, so guest videos and your private key are never committed.
