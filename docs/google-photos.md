# Google Photos in Zero Q

People connect Google Photos by giving permission: they sign in with Google, allow Zero Q to see the photos they select, and pick. Zero Q never sees the rest of their library.

This works out of the box for users once Zero Q has its own Google client ID. That is a one-time step for whoever builds Zero Q. It takes about ten minutes and is free.

## Why a client ID is needed

Google shows its permission screen only to apps registered with it. Since March 2025 the Google Photos Picker is the only way a third-party app can read someone's existing photos, and it needs an OAuth client with the Picker API switched on. There is no way around this, and no API key that a user could paste instead.

## One-time setup

1. Open https://console.cloud.google.com and create a project (any name, for example "Zero Q").
2. In "APIs and services", open "Library", find **Google Photos Picker API** and enable it.
3. Open "Google Auth Platform" and set up the consent screen:
   - Audience: External.
   - App name: Zero Q. Add your support email.
   - Under "Data access", add the scope `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`.
   - Under "Audience", add the Google accounts that may use it while the app is in testing (up to 100).
4. Open "Clients", create a client of type **Web application**, and add both redirect addresses:
   - Chrome, Edge, Brave, Opera, Arc: `https://einjnnhpkldokobkjgnpoglldmlgbchg.chromiumapp.org/`
   - Firefox: `http://127.0.0.1/mozoauth2/03fc1bde06b0a7a031d6c4fad2272a960ddbee51`
5. Copy the client ID (it ends in `.apps.googleusercontent.com`) into `apps/extension/google.json` as `clientId`.
6. Run `npm run build:all` and share the new zips.

To try it before changing the build, paste the client ID into the Google Photos sheet in the extension instead (Me, then Google Photos, then "Set it up"). That uses the redirect address shown in the sheet, so add that address to the client as well.

## What changes when the client ID is built in

- The Chrome build gets a fixed key, so every install has the same extension ID (`einjnnhpkldokobkjgnpoglldmlgbchg`) and the one redirect address above works for everyone.
- **Existing Chrome installs get a new ID once.** The browser keeps data per extension ID, so wardrobe and history start empty after that update. To carry them over: before updating, open Me, "Where your data lives", and choose a folder. After updating, choose the same folder and everything is read back in.
- Firefox keeps its ID. Safari has no web sign-in for extensions, so Google Photos is not offered there.

## Testing and going public

- **Testing (the default):** only the Google accounts you listed can connect, up to 100. They see a Google notice that the app is in testing before the permission screen.
- **Public:** press "Publish app" on the consent screen and submit it for Google's verification. Google's Photos documentation says apps using the Photos APIs must pass OAuth verification. You will need a homepage, a privacy policy, and a short video of the permission flow.

## What Zero Q does with the permission

- Asks first, in its own words, then opens Google's permission screen.
- Requests one scope only: view the photos you select.
- Keeps the access token in session storage for up to an hour and renews it quietly while Google still remembers the permission.
- Downloads the picked photos at up to 1600 pixels and deletes the picker session.
- "Disconnect Google Photos" in Me revokes the token at Google and forgets it.
