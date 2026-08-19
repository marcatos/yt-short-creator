# Privacy Policy — YT Short Creator

**Last updated:** 2026-08-19

This policy applies to **YT Short Creator**, a local desktop web application operated by the channel owner for **S.Marcato 42 Racing**. The app runs on the operator’s own computer (typically `http://localhost:3000`); it is not a multi-tenant cloud service.

## Who we are

The operator of the YouTube channel **S.Marcato 42 Racing** is the data controller for use of this software on their machine.

Contact for privacy questions: use the contact method listed on the [YouTube channel](https://www.youtube.com) or the project repository issues page.

## What data the app processes

When you (the operator) connect accounts and run the pipeline, the app may store or process:

- **YouTube OAuth tokens** and connected channel metadata (channel id, title).
- **Meta / Instagram OAuth tokens**, Instagram user id, username, and linked Facebook Page id/name.
- **Video and job metadata** (candidate titles, descriptions, tags, job status) in a local SQLite database.
- **Media files** (source clips, renders, voice-over audio) on local disk.
- **API keys** you configure (LLM, TTS) in local environment files (`.env.local`).

All of the above stay **on the operator’s machine** unless you explicitly upload content to YouTube or Instagram through the app’s publish features.

## How we use data

Data is used only to:

- Sync and analyze the operator’s YouTube library.
- Propose, render, and publish Shorts to **YouTube**.
- Cross-post Italian Reels to **Instagram** when the operator has connected Instagram.
- Run local automation (FFmpeg, workers, optional Inspiration sync).

We do **not** sell personal data. We do **not** use operator data for advertising profiling.

## Third-party services

The app calls APIs you authorize:

| Service | Purpose |
|---------|---------|
| Google / YouTube | OAuth, uploads, captions, channel data |
| Meta / Instagram | OAuth, Reels publishing |
| OpenAI-compatible LLM/TTS (if configured) | Script generation, transcription, voice-over |

Each provider’s own privacy policy applies to data they receive. Tokens are stored locally under `data/` (e.g. YouTube and Instagram token files).

## Retention and deletion

- Data persists on the operator’s PC until deleted manually (database, `media/`, `data/` tokens).
- Disconnecting YouTube or Instagram in the app removes stored OAuth tokens for that service.
- Uninstalling or deleting the project folder removes local data.

## Security

The app is designed for **single-operator local use**. The operator is responsible for securing their PC, `.env.local`, and OAuth credentials. Do not expose `localhost` to the public internet without additional access controls.

## Children

The app is not directed at children under 13. The operator’s racing content is general audience simracing material.

## Changes

We may update this policy when integrations or storage change. The “Last updated” date at the top will reflect revisions.

## Meta Developer disclosure

This privacy policy URL is provided to satisfy Meta app configuration requirements for Instagram Graph API access used solely by the channel operator to publish their own Reels.
