# VeggieMeet App ID Registration for the Owner

## What the owner needs to do now

The owner only needs to register the following App ID once:

```text
app.veggiemeet.ios
```

The VeggieMeet developer already has **Admin access in App Store Connect** and will handle everything else that can be delegated.

## Register the App ID

1. Sign in to [Apple Developer](https://developer.apple.com/account/) using the owner's Apple Account.
2. Open **Certificates, Identifiers & Profiles**.
3. Select **Identifiers**.
4. Search for:

   ```text
   app.veggiemeet.ios
   ```

5. If it already exists, do not create it again. Send a screenshot or confirmation to the developer.
6. If it does not exist, click the **plus button**.
7. Select **App IDs**, then click **Continue**.
8. Select **App**, then click **Continue**.
9. Enter exactly:

   ```text
   Description: VeggieMeet iOS
   Bundle ID type: Explicit
   Bundle ID: app.veggiemeet.ios
   ```

10. Leave optional capabilities disabled for now.
11. Click **Continue**.
12. Review the Bundle ID and click **Register**.
13. Send the developer a screenshot or confirmation that registration succeeded.

## If Apple displays an error

- If Apple says the Bundle ID is unavailable, stop and send the error to the developer.
- Do not choose another Bundle ID without checking with the developer.
- If Apple blocks registration because an agreement must be accepted, follow the Apple prompt and accept only the required agreement.

## No additional access is required

The developer already has Admin access in App Store Connect. The owner does not need to grant any additional permission now.

The developer will not see **Certificates, Identifiers & Profiles** because the membership is registered as an Individual. This is expected and does not block the developer from completing the remaining App Store Connect setup.

## Stop after registration

The owner does not need to do any of the following now:

- Create the VeggieMeet app record in App Store Connect.
- Prepare or build the source code.
- Open Xcode.
- Sign or upload a build.
- Configure TestFlight.
- Enter App Store product information.

The developer will contact the owner later if owner authentication is required for signing and uploading a finished release build.

## Completion checklist

- [ ] `app.veggiemeet.ios` exists under Identifiers.
- [ ] It is an Explicit App ID.
- [ ] The spelling exactly matches `app.veggiemeet.ios`.
- [ ] The developer has received confirmation or a screenshot.

Official reference: [Register an App ID](https://developer.apple.com/help/account/identifiers/register-an-app-id/)

