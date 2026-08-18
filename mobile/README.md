# Mountain Finder — mobile shell (P8.1)

Two screens on a phone, existing to settle one question the rest of this
repository cannot: **do the device frame conventions in `src/live/sensors.ts`
match a real device?**

## Why this is not just "the app yet"

`src/live/sensors.ts` says so in its own header. Every expectation in its 16
tests is derived by hand from the frame convention written directly above
them. That proves the *mathematics*. It cannot prove the *convention* — a sign
error would pass all 16 and invert the overlay on hardware, and no amount of
work in a Linux container closes that, because the missing evidence is a
physical fact about a phone.

So this app deliberately does **not** label peaks yet. Labelling needs terrain,
terrain needs a decision about how a phone carries square degrees of DEM
offline (D7), and building an AR overlay on top of an unverified sign
convention is the ordering mistake this project keeps declining to make. The
horizon comes first. The peaks come after the holds pass.

## Running it — no Mac, no Xcode, no Apple Developer account

1. Install **Expo Go** from the App Store (or Play Store) on your phone.
2. On any computer — macOS, Windows or Linux — with Node 20+:

   ```sh
   cd mobile
   npm install
   npx expo start
   ```

3. Scan the QR code with the Camera app (iOS) or from inside Expo Go (Android).
   The phone and the computer need to be on the same network; add `--tunnel`
   if they are not.

Every native module this app uses — `expo-sensors`, `expo-location`,
`expo-camera`, `react-native-svg` — is bundled into Expo Go, so there is no
native build step. A Mac or an [EAS](https://docs.expo.dev/build/introduction/)
build is only needed later, for a standalone binary, TestFlight, or the App
Store.

## Screen 1 — Calibrate

Four holds whose gravity vector is known a priori from geometry:

| Hold | Expected gravity | Proves |
|---|---|---|
| Upright portrait | `(0, −1, 0)` | `+y` is the top edge; level pitch reads 0°, not ±90° |
| Face up on a table | `(0, 0, −1)` | gravity points **down** (−z), not up — the W3C sign trap |
| Face down on a table | `(0, 0, +1)` | pitch is signed, so camera-up and camera-down are distinct |
| Right edge down | `(+1, 0, 0)` | roll is positive clockwise seen from behind the camera |

Hold the phone in each position, keep it still, tap **Capture**. Two holds on
different axes are enough for a verdict; all four leave nothing untested.

The verdict comes from `src/live/calibration.ts`, which is where all the
judgement lives — this screen only collects taps. It reports one of:

- **`matches-convention`** — the conventions are confirmed against hardware.
  P8.2's open bar closes. Nothing needs changing.
- **`systematic-remap`** — every hold is explained by one wrong signed axis
  permutation, and it names it: *"measured ≈ (x←−y, y←x, z←z) of expected"*.
  That is a one-line correction rather than a search across 48 candidates.
- **`inconsistent`** — no single mapping fits. The phone moved, or a hold was
  done differently than described. Not a convention problem; re-run it.
- **`insufficient`** — the captured holds constrain fewer than two axes.

**Share result + trace** exports the observations, the verdict and the raw
sample buffers as JSON. Send that back: the traces are what turn this from a
verdict into the replayed fixture P8.2 actually asks for.

## Screen 2 — Horizon

The camera preview with a computed horizon line drawn over it, plus bearing
ticks and the live fused pose.

The line is produced by the same `projectToImage` the still pipeline uses, fed
by the same `poseWithSensors` the live loop uses. **Tilt the phone. The line
must stay on the real horizon behind it.** If pitch or roll carries the wrong
sign, the line pulls away — tilt left and it tilts right. That is a convention
error you can read at a glance and that no test here can catch.

The lens selector is an assumption, not a measurement: Expo Go cannot ask the
hardware which camera is active. It scales how far the line spreads across the
frame; it does not change which way the line tilts, which is what the screen is
for.

**Drag the overlay to line it up.** This is D9's interaction, the one the web
app gives you as sliders: push the horizon with a finger until it sits on the
real one. The gesture writes the same visible `TrimState` the sliders write and
stops at the same limits (±30° across, ±20° up), and the panel reports how far
you nudged it. Nothing is ever corrected behind your back.

The drag geometry inverts the projection properly rather than assuming degrees
are linear in pixels — a portrait frame's vertical field is around 108°, where
the naive `fov ÷ pixels` scale lags your finger by 46%. See
`src/live/drag-trim.ts`.

### True north, magnetic north, and why the line still draws

If the compass has a **true** heading, the line is solid blue. If it only has a
**magnetic** one — Core Location reports `trueHeading` as `−1` without a
location fix — the line is drawn **amber and dashed**, labelled `MAG`, with the
error named on screen.

An earlier version refused to draw at all in that case. That was the magnetic
rule applied past its purpose. The rule forbids treating magnetic as true
*silently*; refusing to draw denies you the one gesture that actually fixes the
heading, and denies it hardest when the error is largest. Declination is
bounded, systematic and well inside the ±30° drag range, so the honest answer
is: draw it, say plainly what it is, let you push it into place.

## What is checked here, and what is not

Run from the repository root:

```sh
npm run typecheck:mobile   # tsc over the app AND the shared modules it imports
npx eslint mobile          # lint
```

`typecheck:mobile` compiles this app against the real Expo SDK 57 /
React Native 0.86 / React 19 type definitions, and it pulls `src/core`,
`src/live`, `src/pipeline` and `src/render` in with it — 39 shared files
typechecked under the mobile toolchain, imported across the repository root
**unchanged**, which is P8.1's "no fork, no shim" bar.

What is **not** checked: nobody has run this app. Its self-check is a person
holding a phone. Per the prime directive it therefore ships marked `[~]`, not
ticked — the same honest treatment `P2.4` carries for the fixtures that could
not be recorded through a blocked proxy.

## Layout

```
App.tsx                    two tabs, no navigation library
index.js                   registerRootComponent
metro.config.js            reaches outside this folder to import /src unchanged
src/useDeviceSensors.ts    the ONLY file that touches a device API
src/CalibrateScreen.tsx    collects taps; all judgement is in /src/live/calibration.ts
src/HorizonScreen.tsx      camera + the real projection code + the drag gesture
src/theme.ts               colours and styles
```

The geometry and policy behind both screens are pure modules in the shared
tree, tested here rather than on a phone:

| Module | What it decides |
|---|---|
| `src/live/calibration.ts` | whether the holds confirm the frame convention, and which axis map is wrong if not |
| `src/live/device-samples.ts` | Expo's payloads → the documented sample types (X-7) |
| `src/live/heading-policy.ts` | whether a heading may be drawn, and whether it may be called true |
| `src/live/drag-trim.ts` | how far a finger moves the overlay |

`useDeviceSensors.ts` is the whole impure surface. Everything it produces goes
straight into the pure modules: if a pitch is wrong, the bug is in a module
with tests behind it, not in a component nobody can execute in CI.
