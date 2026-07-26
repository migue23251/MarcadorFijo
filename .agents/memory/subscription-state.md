---
name: Subscription state
description: How subscription access should be interpreted while the legacy boolean remains in the schema.
---

The subscription expiry timestamp is the source of truth for whether access is currently active. The legacy `active_subscription` flag remains for compatibility with existing records and clients, while API responses derive the current active state from `subscription_expires_at > NOW()`.

**Why:** A stored boolean becomes stale as soon as time passes the expiry date; deriving the state at the API boundary prevents expired plans from retaining access.

**How to apply:** When adding billing or entitlement logic, update the expiry and plan together, keep the legacy flag synchronized for compatibility, and use the derived active state for authorization decisions.