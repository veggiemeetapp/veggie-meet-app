# VeggieMeet — One-Time TestFlight Signing Setup

The VeggieMeet App ID and App Store Connect app record already exist. The developer has prepared the iOS project and generated the attached certificate signing request (CSR).

You only need to create and return two signing files. You can complete everything below from a web browser on Windows. You do not need a Mac or Xcode.

## File provided to you

`VeggieMeet_AppStore_Distribution.certSigningRequest`

SHA-256:

`044c5f6d013e2eda3ed259d48ff6b5f0ef1e16ebdad6f64564589d6f89c28c8a`

This CSR contains a public key only. The matching private key remains securely in the developer's macOS Keychain.

## 1. Create the Apple Distribution certificate

1. Sign in to [Apple Developer](https://developer.apple.com/account/) with the Account Holder Apple Account.
2. Open **Certificates, Identifiers & Profiles**.
3. Select **Certificates** in the sidebar.
4. Click the **+** button.
5. Under **Software**, select **Apple Distribution**.
6. Click **Continue**.
7. Upload `VeggieMeet_AppStore_Distribution.certSigningRequest`.
8. Complete certificate creation and click **Download**.
9. Keep the downloaded `.cer` file.

Important: If Apple says the account has reached its distribution-certificate limit, do not revoke an existing certificate. Send the developer a screenshot of the message first.

## 2. Create the App Store Connect provisioning profile

1. In **Certificates, Identifiers & Profiles**, select **Profiles**.
2. Click the **+** button.
3. Under **Distribution**, select **App Store Connect**.
4. Click **Continue**.
5. Select the App ID **VeggieMeet iOS — `app.veggiemeet.ios`**.
6. Select the new Apple Distribution certificate created in step 1.
7. Enter the profile name: `VeggieMeet App Store Connect`.
8. Click **Generate**, then **Download**.

## 3. Return the two downloaded files

Please send the developer:

1. The Apple Distribution certificate (`.cer`).
2. The App Store Connect provisioning profile (`.mobileprovision`).

Do not send your Apple Account password, two-factor authentication code, or any private key.

After these two files are returned, the developer can install them, sign the VeggieMeet archive, upload the build to TestFlight, and manage testing through their existing App Store Connect Admin access.
