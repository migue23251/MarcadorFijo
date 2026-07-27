---
name: Bet status contract
description: The betting history API must support every status that can be persisted in the bets table.
---

The API response and client types must include `void` whenever the database can store voided bets; the history UI should present that state as “Anulada” rather than rejecting the entire list.

**Why:** A single persisted status outside the generated enum caused the complete `/api/bets` response to fail validation with HTTP 500, hiding otherwise valid betting history.

**How to apply:** When adding or observing a new bet status, update the OpenAPI source first, regenerate derived clients and schemas, then update labels, filters, colors, and statistics intentionally.

ROI must use only the stake from resolved `won` and `lost` bets as its denominator; pending and void bets are excluded from the investment base.

**Why:** Including unsettled stakes understates or distorts the user's realized performance.

**How to apply:** Keep pending and void bets in total-history counts, but filter them out of ROI stake and realized-return calculations.