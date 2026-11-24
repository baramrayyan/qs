# Studyroom

Studyroom is a React and Firebase quiz app built as a static site for GitHub Pages.

## Local development

1. Install Node.js 18.20 or newer and npm.
2. Copy `.env.example` to `.env.local` and fill in the Firebase web app values from Firebase Console → Project settings → Your apps.
3. Set `VITE_USE_FIREBASE_EMULATORS=true` only when the Firebase Auth and Firestore emulators are running locally.
4. Run `npm install`, then `npm run dev`.

Run `npm run build` to create the static site in `dist/`, or `npm run preview` to view that production build locally.

## Publish to GitHub Pages

The production Firebase web configuration is in `.env.production` and is included in the public client bundle. These Firebase web app values are not server secrets. Protect data with Firebase Authentication and Firestore Security Rules, restrict the API key to your site domains where supported, and add `baramrayyan.github.io` to Firebase Authentication's authorized domains.

Sign in to GitHub with an account that can push to the repository (for GitHub CLI, run `gh auth login` and `gh auth setup-git`). Run `npm run publish` to build the site, copy the current source files to a temporary clone of `main`, commit and push them, then push the generated `dist/` files to the `gh-pages` branch. The upload skips `node_modules`, `dist`, and local-only Firebase configuration files; it includes `.env.production` with the public Firebase configuration.

For the first deployment, open the repository's **Settings → Pages**, select **Deploy from a branch**, then choose the `gh-pages` branch and `/(root)` folder. The site will be available at `https://baramrayyan.github.io/qs/` after GitHub Pages finishes publishing.

The Vite build uses relative asset URLs, so it works under the repository's `/qs/` path.
