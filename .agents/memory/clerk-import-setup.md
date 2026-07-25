---
name: Imported Clerk setup
description: Imported apps may contain external Clerk credentials that must not be replaced without explicit user direction.
---

When an imported app uses Clerk, determine whether its credentials are external or Replit-managed before changing auth configuration. Preserve external credentials when the user defers auth setup, and keep public pages usable without initializing Clerk if the current key is invalid.

**Why:** Imported repositories can carry placeholder or external Clerk settings, and overwriting them can disconnect the app from the owner's authentication tenant.

**How to apply:** Check Clerk management status first; only provision or migrate authentication when the user explicitly chooses that path.