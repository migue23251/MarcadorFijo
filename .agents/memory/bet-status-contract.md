---
name: Bet status contract
description: The betting history API must support every status that can be persisted in the bets table.
---

The API response and client types must include `void` whenever the database can store voided bets; the history UI should present that state as “Anulada” rather than rejecting the entire list.

**Why:** A single persisted status outside the generated enum caused the complete `/api/bets` response to fail validation with HTTP 500, hiding otherwise valid betting history.

**How to apply:** When adding or observing a new bet status, update the OpenAPI source first, regenerate derived clients and schemas, then update labels, filters, colors, and statistics intentionally.