# Chirp Hunter

Finds the chirping smoke detector in your house, keeps a list of every detector with battery and replacement dates, reminds you when something is due, and walks you through a monthly alarm test.

No account, no server, no tracking. Everything stays on the phone. Audio is analysed live and never recorded.

## Run it

```
npm install
npm run dev          # http://localhost:5173, microphone works on localhost
npm run dev:phone    # https with a self-signed certificate, for opening on a phone
npm start            # production build at http://localhost:4173, works offline once loaded
npm test             # logic tests
```

Open it through one of those addresses. Opening `index.html` directly will not work.

## Demoing it (about two minutes)

Open the app, then tap **Demo tools** on the start screen.

1. **Load samples.** Four detectors appear: fine, battery due, replace soon, expired. The header shows a three month streak.
2. **Play practice chirps.** Five chirps play from the speaker, getting louder, like walking toward a detector. The microphone really hears them: the meter climbs, the phone buzzes, confetti fires on "Found it?". Turn the volume up and keep the phone near the speaker. If the room is noisy, use **Simulate a walk** instead, which needs no sound.
3. **Run demo test.** Detectors pass one by one with a progress bar. The last one stays silent so the failure screen shows too. Demo results do not touch the streak.
4. **Real test, no detector.** In **Test**, start a normal test and tap "Demo: play an alarm sound". The microphone hears the three-beep alarm and the detector passes.
5. **Label reading.** Add a detector and photograph a label (or a screen showing one). The made date is read on the device, offline.
6. **Reminders.** "Add to my calendar" downloads an `.ics` file with the daylight saving battery changes, the monthly test and each detector's ten-year date.

**Clear everything** on the demo page resets the phone to a clean start.

## Notes

- Detection listens for a sharp tone between 2 and 5 kHz, which is where smoke detector beeps are. Thresholds are in `src/audio.js` and may need tuning on a particular phone.
- Phones only allow the microphone on https or localhost.
- Reminders: a web app cannot wake a closed phone, so the calendar file is the reliable route. Notifications fire when the app is opened.
- The start screen animation is a sprite sheet made from a video clip: `node scripts/hatch-sprite.mjs <video> <start> <end> <fps> <outDir>` (needs `playwright-core` and Edge or Chrome).
- Replace the mascot art through `MASCOT_IMAGES` in `src/mascot.js`.
