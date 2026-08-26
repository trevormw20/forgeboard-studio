# Forgeboard

Forgeboard is a deadline-first, mobile-first game development planner. The public app is a static installable PWA. Planner state lives in one JSON file in a separate private GitHub repository and syncs through the GitHub Contents API.

## Security boundary

- This public repository contains app code only—never planner data, access tokens, Gmail credentials, or OpenAI keys.
- Planner records live in `data/workspace.json` in the private `forgeboard-studio-vault` repository.
- The browser GitHub token is device-specific. By default it stays only in memory for the page session; “Remember token” stores it in the browser’s IndexedDB device cache.
- OpenAI and optional Gmail credentials belong only in the private vault repository’s GitHub Actions secrets.
- The OpenAI API is billed separately from ChatGPT subscriptions.

## Connect a device

1. Open the deployed Pages app and choose **Data connection**.
2. Enter owner `trevormw20`, repository `forgeboard-studio-vault`, branch `main`, and path `data/workspace.json`.
3. Create a fine-grained GitHub personal access token. Select only the private vault repository and grant **Contents → Read and write**.
4. Enter the token directly in the app. Do not paste it into chat or commit it.
5. Choose **Save and test**. Repeat on each desktop or phone.

If the token expires, create and enter a replacement. A 30-day expiration is not permanent setup; use a longer expiration if appropriate while keeping repository access narrowly limited.

## Local checks

```bash
npm ci
npm test
npm run lint
npm run build
```

The GitHub Pages workflow runs tests and the production build before every deployment.

Forgeboard is a general project tracker, not a HIPAA-certified system. Do not store patient-identifying or regulated health data here without a separate compliance and security review.
