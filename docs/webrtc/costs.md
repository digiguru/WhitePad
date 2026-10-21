# Cost model

Rates were checked against official documentation on 20 October 2026. These are assumptions for budgeting, not a fixed monthly total or a capacity promise. Prices, account allowances, tax and regional rates can change. The classroom acceptance tests and billing dashboards must establish actual usage.

## Vercel

The frontend serves static assets only. Drawing, signalling and TURN traffic do not traverse Vercel. The documented Pro platform fee is $20/month with one deploying seat and $20 usage credit; content delivery may use a Flat Rate CDN tier or on-demand pricing. The listed on-demand examples include $0.15/GB delivery and $2/million CDN requests, with regional/account differences. Check the project's actual pricing arrangement before release. See [Pro plan](https://vercel.com/docs/plans/pro-plan/) and [Vercel pricing](https://vercel.com/docs/pricing/).

A conservative planning example is 400 fresh asset loads per one-hour deployment-wide session × 120 sessions × 0.15 MB compressed assets = 7.2 GB/month, plus approximately six CDN requests/load = 288,000 requests. At the example rates that is around $1.66 of metered delivery/requests before credit, CDN-tier terms, origin traffic, builds, additional projects and other account usage. Browser caching can reduce it. This suggests base-plan Vercel usage is plausible; it is **not measured production usage** and does not guarantee a fixed bill. This application adds no Vercel Function execution workload.

## Signalling and room metadata, separately

Budget a Workers Paid subscription (currently minimum $5/month) independently of Vercel. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

Durable Object paid allowances include one million requests/month and 400,000 GB-s of duration; listed overages are $0.15/million requests and $12.50/million GB-s. Incoming WebSocket messages have a 20:1 request-billing ratio. SQLite-backed storage includes 25 billion row reads, 50 million row writes and 5 GB-month; listed storage overages are $0.001/million reads, $1/million writes and $0.20/GB-month. See [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

This implementation sends application liveness messages every 20 seconds. At 400 participants × 120 deployment-wide hours, that is approximately 8.64 million inbound liveness messages, or 432,000 request billing units before HTTP, renegotiation, room controls and alarms. Rate-limit bookkeeping performs bounded metadata writes, including per-identity signalling counters; these writes must be included rather than treating sockets as completely free. Sparse real use should fit the request/storage allowances if other account usage is low, but reconnect storms and abuse affect it.

As an intentionally pessimistic duration bound, 15 rooms kept non-hibernatable throughout all 120 hours at 128 MiB/object would consume approximately 810,000 GB-s using 0.125 GB for this estimate. That exceeds the included duration; account billing uses its own memory units/rounding, so inspect actual GB-s rather than relying on this bound. Hibernation should reduce chargeable duration substantially. Expect the $5 subscription plus measured overages, not a guaranteed $5 total. The migration does not store drawings in Durable Objects, R2 or another paid cloud drawing store.

## TURN, separately

Cloudflare lists TURN egress at $0.05/GB with the first 1,000 GB/month shared across Realtime services. Billing measures data sent from the edge to TURN clients and includes protocol overhead. Other Realtime applications consume the same allowance. See [TURN pricing FAQ](https://developers.cloudflare.com/realtime/turn/faq/).

The table conservatively assumes:

- 15 teachers and 385 students, 400 participants total.
- 120 hours with the full deployment in use: **1,800 aggregate classroom-hours**.
- 0.5 MB of application payload per active drawing minute per student, including operation envelopes. This is a planning allowance, not a handwriting measurement.
- TURN volume = application volume × relay fraction × 2.6, allowing two billed relay legs and 30% overhead. The actual selected ICE path and provider billing may be smaller or larger.
- No other usage of the shared 1,000 GB allowance. Recovery bursts, acknowledgements, keepalives and unusually complex drawing can change traffic; replace the multiplier with measured billable egress.

| Active drawing | Relayed peers | Application GB | Budgeted TURN GB | TURN overage USD |
|---:|---:|---:|---:|---:|
| 10% | 0% | 138.60 | 0.00 | 0.00 |
| 10% | 25% | 138.60 | 90.09 | 0.00 |
| 10% | 100% | 138.60 | 360.36 | 0.00 |
| 25% | 0% | 346.50 | 0.00 | 0.00 |
| 25% | 25% | 346.50 | 225.23 | 0.00 |
| 25% | 100% | 346.50 | 900.90 | 0.00 |
| 100% | 0% | 1386.00 | 0.00 | 0.00 |
| 100% | 25% | 1386.00 | 900.90 | 0.00 |
| 100% | 100% | 1386.00 | 3603.60 | 130.18 |

If **120 classroom-hours means the aggregate across all rooms**, divide traffic and deployment-duration estimates above by 15. At 100% drawing and 100% relay that gives 92.4 GB application data and 240.24 GB budgeted TURN data; all nine cases then fit the stated TURN allowance if it is otherwise unused. Subscription/platform fees do not divide by 15.

Run `node tools/webrtc/cost-model.mjs` to reproduce the table. `BYTES_PER_ACTIVE_MINUTE=<measured value>` replaces its payload assumption. Application bytes and RTC candidate-pair statistics are useful operational measurements but are not authoritative TURN billing counters. After a credential-enabled forced-relay run, compare the Cloudflare TURN dashboard's egress delta with the test interval. Report direct/relayed counts, payload, recovery volume, signalling messages, billable TURN egress and rendering measurements separately.

A reasonable initial budget separates Vercel's existing Pro fee, the extra Workers subscription/overages, and TURN overages shown above. Do not add those into a promised fixed total without measuring actual duty cycle, relay rate, asset loads, lesson duration, account sharing and reconnect behavior.
