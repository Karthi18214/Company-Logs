# Site Bill Tracker — Mobile App Development

This directory is configured with **Capacitor** to wrap the React web app into a native mobile app.

## 🚀 Native Android Development

The native Android project is generated in the `client/android` directory.

### 1. Build and Sync Changes
Whenever you modify your React code in `client/src`, you must recompile and sync the assets to the native Android container:
```bash
# 1. Compile the React app (produces client/dist)
npm run build

# 2. Sync built files to the native Android app
npx cap sync
```

### 2. Run / Debug in Android Studio
To compile the native app, run it on a virtual device (emulator), or build a production `.apk` file:
```bash
# Open the project inside Android Studio
npx cap open android
```
Once Android Studio opens:
1. Select a virtual device (emulator) or connect a physical Android phone with USB Debugging enabled.
2. Click the green **Run** button (play icon) at the top of Android Studio.

---

## 🍏 Native iOS Development (CocoaPods required)

To support iOS build generation, your system must have **CocoaPods** installed.

1. Install CocoaPods via Homebrew or RubyGems:
   ```bash
   brew install cocoapods
   ```
2. Add the iOS platform project:
   ```bash
   npx cap add ios
   ```
3. Build, sync, and open in Xcode:
   ```bash
   npm run build
   npx cap sync
   npx cap open ios
   ```
