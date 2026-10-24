# Artwork

- `app-icon.png`: Genie and Rookie in a close felt portrait with one discovery spark on midnight teal; 1024 × 1024, square and opaque
  (iOS applies the mask).
- `splash.png`: the launch art, the genius above the clouds and the rookie in the embers.
- `logo.png`: the Genius & Rookie logo, which drops in over the launch intro.
- `avatars.png`: both faces, which name the characters in a saved conversation.
- `welcome.png`: the two peeking over the top of the first launch's welcome card.

`export.py` turns them into the `AppIcon`, `LaunchSplash`, `Logo`, `GeniusAvatar`, `RookieAvatar`
and `WelcomeCharacters` images in `../ios/PipecatVoice/Assets.xcassets`. The exports are checked
in, so building needs no image tools. After changing the artwork, run:

```bash
uv run --no-project --with pillow --with numpy python src/branding/export.py
```
