# Documentation

The [main README](../README.md) is the best place to start. This folder holds the design and engineering docs behind the larger pieces of Casa Coqui — the "how" and "why" rather than the code itself.

## Architecture & design — `architecture/`

| Doc | What it covers |
|-----|----------------|
| [notification-system-v2.md](architecture/notification-system-v2.md) | Notification System v2 — the FCM-only push architecture |
| [agent-reservation-flow-plan.md](architecture/agent-reservation-flow-plan.md) | Reservation & Reply Agent flow (canonical plan, v3.3) |
| [role-based-experience-plan.md](architecture/role-based-experience-plan.md) | Role-based experience system (guest / host / cleaner) |
| [notification-follow-up-review.md](architecture/notification-follow-up-review.md) | Follow-up review of the notification system |

## Feature specs & plans — `superpowers/`

- [`specs/`](superpowers/specs/) — design documents for each larger feature (reply-agent port, thread coherence, itinerary app, pricing-autopilot migration, …)
- [`plans/`](superpowers/plans/) — the step-by-step implementation plans that accompanied those specs

## Postmortems — `postmortems/`

Incident write-ups: what broke, the root cause, and the fix.

## Operations

- [getting-started.md](getting-started.md) — project setup guide
- [secrets-management.md](secrets-management.md) — where each secret lives and how to rotate it safely

## Mockups — `mockups/`

Static HTML design mockups used while iterating on screens.
