# PagePulse — Observability and Rollback Plan

## Task B: Design It for Scale

PagePulse is designed to support more than 10,000 audits per day, bursts of up
to 500 concurrent requests, and a customer-facing response-time SLA.

At this scale, application health cannot be determined only by checking whether
the Node.js process is running.

The production system includes multiple components:

- Load balancer / API gateway
- PagePulse API instances
- Redis
- BullMQ job queue
- Audit workers
- PostgreSQL
- External target websites

A failure or performance problem in any of these components can affect customer
experience.

The observability strategy therefore combines:

- Metrics
- Structured logs
- Distributed traces
- Health and readiness checks
- Dashboards
- Automated alerts

The rollback strategy ensures that a bad production deployment can be detected
quickly and reversed safely.

---

## 1. Observability Goals

The PagePulse observability system should answer five operational questions:

1. Is the customer-facing API available?
2. Are customers receiving responses within the expected SLA?
3. Is the audit-processing pipeline keeping up with incoming work?
4. Are external target websites or internal PagePulse components causing
   failures?
5. Did a recent deployment negatively affect the service?

Observability should provide enough information to detect problems before they
become widespread customer-facing incidents.

### 1.1 Three Observability Signals

PagePulse should use three primary observability signals:

#### Metrics

Metrics show overall system behavior over time.

Examples include:

- Request rate
- API latency
- Error rate
- Queue depth
- Worker utilization
- Cache hit ratio

Metrics are primarily used for:

- Dashboards
- Alerting
- SLA measurement
- Capacity planning

#### Structured Logs

Structured logs record individual events with machine-readable fields.

A PagePulse log event may contain:

{
  "timestamp": "2026-01-01T10:00:00Z",
  "level": "info",
  "requestId": "req_12345",
  "jobId": "audit_67890",
  "event": "audit.completed",
  "durationMs": 850
}

Structured logs make it easier to search and correlate events during incident
investigation.

Sensitive information such as passwords, API keys, authentication tokens and
database credentials must never be included in logs.

#### Distributed Traces

Distributed tracing follows one logical request across multiple components.

For example:

Client Request
→ API
→ Redis Cache
→ BullMQ Queue
→ Worker
→ External Website
→ PostgreSQL
→ Redis Cache

A trace can reveal which component contributed most to a slow or failed audit.

### 1.2 Request Correlation

Every incoming request should receive a unique request ID.

The request ID should propagate through:

API Request
→ API Logs
→ Queue Job
→ Worker Logs
→ Database Operations
→ Audit Result

Asynchronous audit jobs should also receive a unique job ID.

Relevant telemetry should therefore include both:

- `requestId`
- `jobId`

This allows engineers to trace a customer request even when the audit is
processed later by a different worker instance.

### 1.3 Centralized Observability

Logs, metrics and traces should be collected centrally.

Engineers should not need to connect manually to individual API or worker
containers to understand production health.

The conceptual flow is:

API Instances ─────┐
                   |
Audit Workers ─────┤
                   |
Redis ─────────────┤
                   |
BullMQ ────────────┤
                   |
PostgreSQL ────────┤
                   v
          Central Observability
                   |
          Dashboards + Alerts

This becomes increasingly important as PagePulse scales horizontally because
the same audit may interact with several different instances during its
lifecycle.

### 1.4 Observability Principle

The goal is not to collect every possible metric or log line.

PagePulse should collect telemetry that helps engineers:

- Detect customer impact
- Identify the affected component
- Understand the cause
- Determine whether capacity is sufficient
- Evaluate whether a deployment should continue or be rolled back

Observability should therefore be designed around actionable operational
questions rather than collecting data without a clear purpose.

---

## 2. What We Monitor

PagePulse should monitor both customer-facing behavior and the internal
components responsible for processing audits.

Monitoring should cover the API, queue, workers, Redis, PostgreSQL and
external website requests.

The objective is to detect not only complete outages but also gradual
performance degradation before it becomes a serious customer-facing problem.

### 2.1 API Metrics

The API is the primary customer-facing component of PagePulse.

The following metrics should be monitored:

- Requests per second
- Total request count
- HTTP 2xx response rate
- HTTP 4xx response rate
- HTTP 429 rate
- HTTP 5xx response rate
- p50 response latency
- p95 response latency
- p99 response latency
- Active connections
- Request timeout rate

Metrics should also be separated by endpoint where practical.

For example:

`POST /api/v1/audits`

should be monitored separately from:

`GET /health`

and:

`GET /api/v1/audits/:jobId`

This prevents inexpensive health checks from hiding performance problems in
the audit API.

### 2.2 Customer-Facing SLA Metrics

PagePulse should explicitly measure the operations that affect the
customer-facing SLA.

Important measurements include:

- Cached audit response latency
- New audit acknowledgement latency
- Job-status lookup latency
- API availability
- Successful request rate
- Total audit completion time

Latency should be evaluated using percentiles.

For example:

- p50 shows typical customer experience
- p95 exposes slower requests
- p99 exposes severe tail-latency problems

Average latency alone should not be used as the primary SLA indicator.

### 2.3 Queue Metrics

The BullMQ queue is a critical component because it provides backpressure
between incoming API requests and audit workers.

PagePulse should monitor:

- Waiting job count
- Active job count
- Completed job count
- Failed job count
- Delayed job count
- Retry count
- Job enqueue rate
- Job completion rate
- Oldest queued-job age
- Average queue waiting time
- Dead-letter or permanently failed job count

The age of the oldest queued job is especially important.

Queue depth alone can be misleading.

For example, 100 waiting jobs may be healthy if workers process them within a
few seconds.

The same 100 jobs may indicate a serious problem if the oldest job has already
been waiting several minutes.

### 2.4 Worker Metrics

Audit workers perform the expensive part of PagePulse processing.

Each worker pool should expose:

- Number of running workers
- Active audits
- Configured concurrency
- Concurrency utilization
- Audits completed per minute
- Audit failure rate
- Audit timeout rate
- Retry rate
- Average audit duration
- p95 audit duration
- Worker CPU utilization
- Worker memory utilization
- Worker restart count

These metrics help determine whether queue growth is caused by insufficient
worker capacity or another downstream problem.

### 2.5 Redis Metrics

Redis supports several important PagePulse functions:

- Audit caching
- Distributed rate limiting
- Deduplication
- Coordination
- BullMQ infrastructure

The following Redis metrics should be monitored:

- Availability
- Command latency
- Memory utilization
- Connection count
- Connection failures
- Eviction count
- Cache hit count
- Cache miss count
- Cache hit ratio
- Error rate

A reduction in cache hit ratio should also be treated as a capacity signal.

If fewer requests are served from cache, more audits enter the queue and
worker load increases.

### 2.6 PostgreSQL Metrics

PostgreSQL stores durable PagePulse data.

Important database metrics include:

- Database availability
- Query latency
- Active connections
- Connection-pool utilization
- Connection wait time
- Database error rate
- CPU utilization
- Memory utilization
- Storage utilization
- Slow-query count

Connection utilization is especially important when PagePulse horizontally
scales workers.

Increasing the number of workers should not create an uncontrolled increase in
database connections.

### 2.7 External Website Metrics

External websites are dependencies outside PagePulse's control.

Their failures should be measured separately from internal PagePulse failures.

Monitor:

- DNS resolution failures
- Connection failures
- External HTTP 4xx responses
- External HTTP 5xx responses
- Target response latency
- Audit timeout rate
- Redirect-limit failures
- Response-size-limit failures
- SSRF/security rejections

Separating these metrics prevents external website problems from being
incorrectly interpreted as PagePulse infrastructure failures.

### 2.8 Cache Metrics

Caching directly affects both latency and system capacity.

Monitor:

- Cache hit count
- Cache miss count
- Cache hit ratio
- Cache lookup latency
- Cache write failures
- Cache evictions

For example:

Cache Hit Ratio Drops
→ More Cache Misses
→ More Queue Jobs
→ More Worker Activity
→ Higher External Request Volume

This makes cache effectiveness an important operational metric rather than only
a performance optimization.

### 2.9 Rate-Limiting Metrics

PagePulse should monitor:

- Number of rate-limited requests
- HTTP 429 response rate
- Rate-limit violations by client
- Sudden increases in requests from individual clients

A significant increase in HTTP 429 responses may indicate:

- Abusive traffic
- A misconfigured customer
- Legitimate traffic growth
- Rate limits that are configured too aggressively

The metric should therefore be investigated rather than interpreted
automatically as an application failure.

### 2.10 Infrastructure Metrics

API and worker infrastructure should also expose:

- CPU utilization
- Memory utilization
- Instance/container count
- Instance restart count
- Network utilization
- Network errors
- Container health
- Readiness-check failures

These measurements help distinguish application problems from infrastructure
capacity problems.

### 2.11 Deployment Metrics

Every deployment should be correlated with production telemetry.

PagePulse should record:

- Deployment timestamp
- Application version
- Git commit SHA
- Previous application version
- Deployment status

Immediately after a deployment, compare:

- HTTP 5xx rate
- API p95 latency
- Audit failure rate
- Worker restart rate
- Queue depth
- Oldest queued-job age
- Database error rate
- Redis error rate

This makes it easier to determine whether a production regression began after
a specific release.

### 2.12 Core Dashboard

The primary PagePulse production dashboard should display at least:

| Area | Key Metric |
|---|---|
| API | Request rate |
| API | p95 and p99 latency |
| API | HTTP 5xx rate |
| SLA | New audit acknowledgement latency |
| Queue | Queue depth |
| Queue | Oldest queued-job age |
| Workers | Active audits and utilization |
| Workers | Audit failure and timeout rate |
| Cache | Cache hit ratio |
| Redis | Latency and memory utilization |
| PostgreSQL | Query latency and connection utilization |
| External Sites | Timeout and external failure rate |
| Infrastructure | CPU and memory utilization |
| Deployment | Current application version |

This dashboard should provide a fast answer to:

"Is PagePulse healthy right now?"

### 2.13 Monitoring Principle

Monitoring should focus on customer impact first and infrastructure second.

For example:

High CPU usage alone does not necessarily mean customers are experiencing a
problem.

However:

High CPU
+
Increasing API p95 latency
+
Growing queue age

provides much stronger evidence that PagePulse is approaching capacity.

The monitoring strategy should therefore correlate multiple signals rather
than treating every infrastructure metric as an independent incident.

---

## 3. Alerting Strategy

Monitoring tells the PagePulse team what is happening.

Alerting identifies conditions that require engineering attention.

Alerts should focus on customer impact, service reliability and conditions
that may soon cause an outage.

PagePulse should avoid creating alerts for every temporary metric spike.
Where appropriate, an alert should require a threshold to remain violated for
a sustained period before notifying the engineering team.

### 3.1 API Availability Alerts

The customer-facing API is one of the highest-priority components.

Alert when:

- HTTP 5xx error rate increases significantly above the normal baseline
- API availability falls below the defined service objective
- Health or readiness checks repeatedly fail
- Multiple API instances become unavailable
- Request timeout rate increases significantly

A sustained increase in HTTP 5xx responses should be treated as a
high-priority customer-impacting incident.

### 3.2 API Latency Alerts

PagePulse should alert when customer-facing latency exceeds the defined
service objective.

Important signals include:

- p95 cached-audit latency
- p95 new-audit acknowledgement latency
- p95 job-status lookup latency
- p99 API latency

For example:

Normal p95 Latency
→ Within Objective

Sustained p95 Increase
→ Warning

SLA Threshold Exceeded
→ High-Priority Alert

Percentiles should be used instead of average latency because averages can hide
a smaller group of customers experiencing extremely slow responses.

### 3.3 Queue Alerts

Queue health is critical to the asynchronous architecture.

Alert when:

- Queue depth grows continuously
- Oldest queued-job age exceeds the acceptable threshold
- Job enqueue rate remains above completion rate
- Failed-job count increases significantly
- Delayed-job count grows unexpectedly
- Dead-letter queue size increases
- Queue connectivity fails

The oldest queued-job age should be one of the primary alerting signals.

A large queue is not necessarily unhealthy if workers are processing jobs
quickly.

A continuously increasing queue age indicates that PagePulse is not keeping up
with incoming work.

### 3.4 Worker Alerts

Alert when:

- Worker count falls below the required minimum
- Worker restart rate increases
- Worker CPU remains near saturation
- Worker memory approaches the configured limit
- Audit failure rate increases significantly
- Audit timeout rate increases significantly
- Worker concurrency remains fully utilized while queue age increases
- Job completion rate falls unexpectedly

These alerts help distinguish insufficient worker capacity from API-layer
problems.

### 3.5 Redis Alerts

Redis is a critical shared dependency.

Alert when:

- Redis becomes unavailable
- Redis connection failures increase
- Redis command latency rises significantly
- Redis memory approaches its configured limit
- Evictions increase unexpectedly
- Cache hit ratio drops significantly
- BullMQ operations fail because of Redis connectivity

Redis failures may affect several PagePulse capabilities simultaneously,
including caching, rate limiting, deduplication and queue processing.

For this reason, complete Redis unavailability should generate a high-priority
alert.

### 3.6 PostgreSQL Alerts

Alert when:

- PostgreSQL becomes unavailable
- Database error rate increases
- Query latency increases significantly
- Connection-pool utilization approaches its limit
- Applications wait excessively for database connections
- Database CPU remains near saturation
- Storage approaches capacity
- Slow-query count increases unexpectedly

Database connection exhaustion is particularly important because increasing
worker count can increase database pressure.

### 3.7 External Website Failure Alerts

PagePulse should distinguish external-site failures from internal service
failures.

A small number of target website failures should not wake an engineer.

However, alert or investigate when:

- External timeout rate increases dramatically across many targets
- DNS failure rate increases across many domains
- External connection failures increase globally
- Audit failure rate rises across unrelated websites

A broad increase across many unrelated targets may indicate a PagePulse
networking or DNS problem rather than independent website failures.

### 3.8 Rate-Limit and Abuse Alerts

Alert or create a security signal when:

- HTTP 429 responses increase significantly
- One client generates unusually high request volume
- Repeated SSRF-blocked requests are detected
- Large numbers of private-network targets are attempted
- Repeated oversized-response attempts occur
- Abnormal redirect behavior increases

These signals may indicate:

- Client misconfiguration
- Automated abuse
- Security probing
- Legitimate traffic growth requiring capacity review

### 3.9 Deployment Alerts

Every production deployment should enter an enhanced monitoring period.

Immediately after deployment, PagePulse should watch:

- HTTP 5xx rate
- API p95 and p99 latency
- Audit failure rate
- Worker restart count
- Queue depth
- Oldest queued-job age
- Redis errors
- PostgreSQL errors
- Readiness-check failures

If these metrics regress significantly compared with the previous stable
version, the deployment should be stopped or rolled back.

### 3.10 Alert Severity Levels

Alerts should have severity levels so engineers can distinguish urgent
customer-impacting incidents from early warnings.

#### Critical

Examples:

- Public API unavailable
- Queue unavailable
- Redis unavailable when queue processing depends on it
- PostgreSQL unavailable for durable operations
- Severe HTTP 5xx spike
- Deployment causing widespread customer failures

These conditions require immediate investigation.

#### Warning

Examples:

- Queue age trending upward
- Worker utilization consistently high
- Database connection pool nearing capacity
- Redis memory usage increasing
- Cache hit ratio decreasing significantly
- API latency approaching the SLA threshold

Warnings indicate that intervention may soon be required.

#### Informational

Examples:

- Autoscaling added worker capacity
- Temporary traffic spike
- Deployment started
- Deployment completed
- Worker replaced successfully

These events are useful operational context but generally do not require
immediate action.

### 3.11 Multi-Signal Alerting

Where practical, PagePulse should combine multiple signals before escalating an
incident.

For example:

High Worker CPU Alone
→ Warning / Investigation

High Worker CPU
+
Increasing Queue Age
+
Falling Job Completion Rate
→ High-Priority Capacity Alert

Similarly:

Redis Memory Increase Alone
→ Warning

Redis Memory Increase
+
Evictions
+
Cache Hit Ratio Drop
→ Strong Redis Capacity Alert

Multi-signal alerting reduces false positives.

### 3.12 Avoiding Alert Fatigue

Too many alerts can be as harmful as too few.

If engineers regularly ignore an alert, that alert is not serving its purpose.

PagePulse should:

- Alert only on actionable conditions
- Use sustained thresholds where appropriate
- Avoid paging for isolated transient errors
- Group related alerts
- Tune thresholds using production data
- Review noisy alerts after incidents
- Remove alerts that provide no operational value

### 3.13 Alert Response Information

Every important alert should provide enough context for investigation.

Where possible, include:

- Affected service
- Metric that triggered the alert
- Current value
- Expected threshold
- Application version
- Deployment timestamp
- Relevant dashboard
- Request or job identifiers when applicable
- Suggested runbook or recovery action

This reduces the time between receiving an alert and understanding the
problem.

### 3.14 Initial Alert Matrix

The exact numeric thresholds should be determined through load testing and
production baselines rather than invented before measurements exist.

An initial alert matrix can therefore define conditions rather than arbitrary
numbers:

| Signal | Condition | Severity |
|---|---|---|
| API availability | Below defined service objective | Critical |
| HTTP 5xx | Sustained increase above baseline | Critical |
| API p95 latency | Exceeds defined SLA threshold | Critical |
| Oldest queue age | Exceeds acceptable processing objective | Critical |
| Queue depth | Sustained growth | Warning |
| Worker utilization | High while queue age increases | Warning |
| Audit failure rate | Significant sustained increase | Critical |
| Redis availability | Unavailable | Critical |
| Redis memory | Approaching capacity | Warning |
| PostgreSQL availability | Unavailable | Critical |
| DB connection pool | Approaching exhaustion | Warning |
| Dead-letter queue | Sustained growth | Warning |
| External failures | Broad increase across unrelated targets | Warning |
| Readiness failures | Multiple production instances affected | Critical |
| Post-deploy regression | Significant customer-impacting regression | Critical |

### 3.15 Alerting Principle

The purpose of alerting is not to prove that PagePulse has many monitoring
rules.

The purpose is to detect conditions where engineering action can prevent or
reduce customer impact.

The preferred progression is:

Metric Changes
→ Warning
→ Sustained Customer Impact
→ Critical Alert
→ Investigation
→ Mitigation or Rollback

This keeps the alerting system focused on actionable production problems.

---

## 4. Bad Deployment Detection and Rollback Strategy

A production deployment should be considered successful only after the new
version has demonstrated healthy behavior under real production traffic.

Passing CI and successfully starting the application are necessary, but they
do not guarantee that the release behaves correctly in production.

PagePulse therefore needs a deployment process that makes releases observable,
gradual and reversible.

### 4.1 Pre-Deployment Checks

Before a new PagePulse version reaches production, the CI pipeline should
verify:

- Dependency installation succeeds
- TypeScript compilation succeeds
- Automated tests pass
- Linting passes where configured
- Security checks pass where configured
- Production build succeeds

A release that fails required CI checks should not be deployed.

### 4.2 Version Every Release

Every production release should have a unique identifier.

This can include:

- Application version
- Git commit SHA
- Container image tag

For example:

`pagepulse:1.4.0`

or:

`pagepulse:<git-commit-sha>`

The running version should also be included in deployment metadata and
observability data where appropriate.

This makes it possible to determine exactly which version is responsible for
production behavior.

### 4.3 Keep the Previous Stable Version Available

PagePulse should retain the previous known-good deployment artifact.

For example:

Current Stable:
`pagepulse:1.3.0`

New Release:
`pagepulse:1.4.0`

If version `1.4.0` causes problems, the platform should be able to restore
`1.3.0` without rebuilding it from source.

Keeping immutable previous artifacts makes rollback faster and more reliable.

### 4.4 Gradual Deployment

PagePulse should avoid replacing every production instance simultaneously.

A safer deployment process is:

1. Deploy a small number of instances using the new version.
2. Run health and readiness checks.
3. Route a limited amount of traffic to the new version.
4. Monitor production metrics.
5. Increase traffic gradually if the release remains healthy.
6. Complete the rollout only after the new version is stable.

This limits the number of customers affected if a defect reaches production.

### 4.5 Canary Deployment

For higher-risk releases, PagePulse can use a canary deployment.

For example:

Previous Stable Version
→ 95% of traffic

New Version
→ 5% of traffic

The percentages are illustrative and should be selected according to the
deployment platform and operational requirements.

During the canary period, compare the new version with the stable version.

Important signals include:

- HTTP 5xx rate
- API p95 latency
- API p99 latency
- Audit failure rate
- Worker failure rate
- Queue growth
- Redis errors
- PostgreSQL errors
- CPU utilization
- Memory utilization

If the new version performs normally, its traffic share can gradually
increase.

### 4.6 Detecting a Bad Deployment

A deployment should be considered unhealthy when production metrics regress
significantly after the release.

Possible indicators include:

- Significant increase in HTTP 5xx responses
- API p95 latency exceeds the defined objective
- Audit failure rate increases
- Worker processes begin crashing
- Readiness checks fail
- Queue depth grows unexpectedly
- Oldest queued-job age increases
- Redis errors begin after deployment
- PostgreSQL errors increase
- CPU or memory consumption increases unexpectedly

Deployment timestamps should be visible on dashboards so engineers can
correlate regressions with releases.

### 4.7 Automatic Rollback Criteria

Where deployment tooling supports it, PagePulse can automatically stop or
reverse a rollout when predefined critical conditions occur.

For example:

New Version Deployed
→ HTTP 5xx Spike
→ Readiness Failures
→ Rollout Automatically Stopped

Automatic rollback is most appropriate when the signal strongly indicates that
the new version is unhealthy.

Warnings with uncertain causes may instead pause the rollout for manual
investigation.

### 4.8 Rollback Procedure

If a deployment is confirmed to be unhealthy, PagePulse should follow a clear
rollback procedure.

#### Step 1 — Stop the Rollout

Immediately stop increasing traffic to the new version.

Do not deploy the unhealthy version to additional instances.

#### Step 2 — Route Traffic to the Previous Stable API Version

The load balancer should route new customer requests back to the previous
known-good API instances.

If the deployment uses a canary strategy, traffic assigned to the new version
should be shifted back to the stable version.

#### Step 3 — Stop New Workers from Consuming Jobs

If the worker release is affected, unhealthy new workers should stop accepting
additional jobs.

They should be drained or terminated according to the worker shutdown policy.

#### Step 4 — Restore the Previous Worker Version

Start or restore workers using the previous known-good artifact.

These workers can resume processing queued jobs.

#### Step 5 — Verify Dependency Compatibility

Confirm that the previous application version remains compatible with:

- Redis
- BullMQ job payloads
- PostgreSQL schema
- Environment configuration

Backward compatibility is especially important during rollback.

#### Step 6 — Verify Recovery

After restoring the previous version, monitor:

- HTTP 5xx rate
- API p95 latency
- Queue depth
- Oldest queued-job age
- Audit failure rate
- Worker utilization
- Redis errors
- PostgreSQL errors
- Readiness status

Rollback is not complete until these metrics return toward their expected
healthy ranges.

#### Step 7 — Preserve Incident Evidence

Do not immediately discard information from the failed release.

Preserve:

- Logs
- Traces
- Metrics
- Deployment metadata
- Application version
- Error messages
- Failed job information

This information is required for root-cause analysis.

#### Step 8 — Fix Forward Through the Normal Pipeline

The failed release should be corrected in source control.

The fix should then pass:

Code Change
→ Review
→ CI
→ Automated Tests
→ Build
→ Deployment

Production servers should not be manually modified as the normal recovery
method.

### 4.9 Worker Rollback Safety

Workers require special handling because they may have active jobs when a
rollback begins.

A worker should support graceful shutdown.

When asked to stop, it should:

1. Stop accepting new jobs.
2. Continue active jobs where safe.
3. Acknowledge successfully completed jobs.
4. Release Redis and database connections.
5. Exit after active jobs complete or the shutdown deadline is reached.

If a worker crashes or cannot complete a job, queue acknowledgement semantics
should allow the job to be processed again.

Audit processing should therefore be idempotent wherever practical.

### 4.10 Queue Payload Compatibility

A new API version may create jobs that an older worker version must process
after rollback.

Queue payloads should therefore remain backward compatible where possible.

If breaking changes are unavoidable, PagePulse should version job payloads.

For example:

{
  "version": 1,
  "jobId": "audit_12345",
  "url": "https://example.com/"
}

Workers can then explicitly handle supported message versions.

This prevents rollback from leaving queued jobs that the restored workers
cannot understand.

### 4.11 Database Migration Safety

Database schema changes are one of the largest rollback risks.

Suppose a new application version removes a database column and then the
application needs to roll back.

The old application may still depend on that column.

PagePulse should therefore prefer backward-compatible database migrations.

A safer approach is:

#### Expand

Add the new schema without immediately removing the old schema.

#### Migrate

Deploy application changes and migrate or backfill data where required.

#### Verify

Confirm that the new application behaves correctly in production.

#### Contract

Remove obsolete schema only in a later deployment after the old application
version is no longer required.

This expand-and-contract strategy keeps rollback possible during the release
window.

### 4.12 Configuration Rollback

Production regressions may be caused by configuration rather than code.

Examples include incorrect:

- Worker concurrency
- Cache TTL
- Request timeout
- Rate limit
- Database pool size
- Redis configuration
- Environment variables

Configuration changes should therefore be tracked alongside application
deployments.

If configuration caused the incident, restoring the previous application
binary alone may not solve the problem.

The rollback procedure must restore the last known-good configuration as well.

### 4.13 Rollback vs Roll Forward

Rollback is appropriate when:

- Customer impact is significant
- The previous version is known to be healthy
- The regression is clearly associated with the new release
- A safe fix cannot be produced immediately

Rolling forward may be appropriate when:

- The defect is very small and clearly understood
- Rollback would create greater compatibility risk
- A database migration cannot safely be reversed
- A tested fix can be deployed faster and more safely

The priority is restoring reliable customer service, not forcing every
incident to use the same recovery method.

### 4.14 Post-Rollback Actions

After service has recovered:

1. Confirm customer-facing metrics are healthy.
2. Confirm the queue is draining normally.
3. Confirm workers are stable.
4. Review failed jobs.
5. Preserve relevant telemetry.
6. Identify the root cause.
7. Document the incident.
8. Add or improve automated tests where appropriate.
9. Improve monitoring if the issue was difficult to detect.
10. Correct the release before attempting deployment again.

### 4.15 Rollback Flow

The complete PagePulse rollback flow is:

New Release
→ Canary / Gradual Deployment
→ Health Checks
→ Production Monitoring

If Healthy:

→ Increase Traffic
→ Complete Deployment
→ Continue Monitoring

If Unhealthy:

→ Stop Rollout
→ Route Traffic to Previous API Version
→ Drain New Workers
→ Restore Previous Workers
→ Restore Previous Configuration if Required
→ Verify Redis / Queue / Database Compatibility
→ Monitor Recovery
→ Preserve Logs and Traces
→ Root-Cause Analysis
→ Fix Through CI/CD

### 4.16 Rollback Principle

The goal of the PagePulse deployment strategy is not to guarantee that a bad
release will never reach production.

Instead, every release should be:

- Identifiable
- Gradual
- Observable
- Backward compatible where possible
- Easy to stop
- Easy to reverse

A deployment failure should affect the smallest possible percentage of
customers and should be recoverable without rebuilding the previous release or
manually modifying production servers.

---

## 5. Final Observability and Rollback Summary

The PagePulse production architecture must be observable and recoverable as it
scales beyond a single application instance.

The observability strategy focuses on detecting customer impact, identifying
the affected component and providing enough information to make fast
operational decisions.

The rollback strategy ensures that a problematic release can be stopped and
reversed without requiring emergency changes directly on production servers.

### 5.1 What PagePulse Monitors

The primary monitoring areas are:

| Component | Primary Signals |
|---|---|
| API | Request rate, p95/p99 latency, HTTP 5xx rate, availability |
| SLA | Cached response latency, audit acknowledgement latency |
| Queue | Queue depth, oldest-job age, enqueue/completion rate |
| Workers | Utilization, audit duration, failures, timeouts, restarts |
| Redis | Availability, latency, memory, connections, cache hit ratio |
| PostgreSQL | Availability, query latency, connections, storage |
| External Websites | Response latency, timeouts, DNS and HTTP failures |
| Rate Limiting | HTTP 429 rate and abnormal client traffic |
| Infrastructure | CPU, memory, container health and restart count |
| Deployment | Version, Git commit SHA and deployment timestamp |

These metrics provide visibility into both customer-facing performance and
internal system health.

### 5.2 What PagePulse Alerts On

High-priority alerts should focus on conditions such as:

- Public API unavailable
- Sustained HTTP 5xx increase
- Customer-facing latency exceeding the defined objective
- Oldest queued-job age exceeding the acceptable threshold
- Significant audit failure increase
- Queue processing unavailable
- Redis unavailable
- PostgreSQL unavailable
- Multiple readiness-check failures
- Significant regression immediately after deployment

Warning-level alerts should identify developing capacity problems such as:

- Increasing queue depth
- High worker utilization
- Redis memory approaching capacity
- Database connection pool approaching exhaustion
- Cache hit ratio decreasing significantly
- Dead-letter queue growth

Exact numeric thresholds should be determined through load testing and
production measurements.

### 5.3 How PagePulse Detects a Bad Deployment

Every production release should be correlated with its:

- Application version
- Git commit SHA
- Container image
- Deployment timestamp

After deployment, PagePulse should compare important production signals with
the previous stable version.

The most important signals include:

- HTTP 5xx rate
- API p95 and p99 latency
- Audit failure rate
- Worker restart rate
- Queue depth
- Oldest queued-job age
- Redis errors
- PostgreSQL errors
- Readiness-check failures

A significant regression shortly after deployment is a strong signal that the
release should be stopped or rolled back.

### 5.4 How PagePulse Rolls Back

The preferred rollback sequence is:

1. Stop the deployment rollout.
2. Stop sending additional traffic to the new API version.
3. Route customer traffic back to the previous stable API version.
4. Stop affected new workers from consuming additional jobs.
5. Drain active worker jobs where safe.
6. Restore the previous known-good worker version.
7. Restore the previous configuration if configuration changed.
8. Verify Redis, queue and PostgreSQL compatibility.
9. Monitor API and worker recovery.
10. Confirm queued jobs are processing normally.
11. Preserve logs, metrics and traces from the failed release.
12. Investigate the root cause.
13. Fix the issue through the normal CI/CD pipeline.

The previous stable container artifact should remain available so rollback does
not depend on rebuilding old source code during an incident.

### 5.5 Safe Deployment Model

The preferred production deployment model is:

Build
→ Automated Tests
→ Versioned Container
→ Deploy Small Percentage
→ Health / Readiness Checks
→ Observe Production Metrics
→ Gradually Increase Traffic
→ Complete Rollout

If metrics regress:

Deploy Small Percentage
→ Regression Detected
→ Stop Rollout
→ Restore Stable Version
→ Verify Recovery

This reduces the blast radius of a defective release.

### 5.6 Data and Queue Compatibility

Rollback must consider more than application code.

The previous application version must remain compatible with:

- Database schema
- Queue job payloads
- Redis data structures
- Environment configuration

PagePulse should therefore prefer:

- Backward-compatible database migrations
- Versioned queue payloads where required
- Expand-and-contract schema changes
- Version-controlled configuration
- Idempotent audit processing

These practices make rolling deployments and rollback significantly safer.

### 5.7 Operational Success Criteria

The observability and rollback strategy is successful when PagePulse can:

1. Detect customer-facing degradation quickly.
2. Determine which component is responsible.
3. Correlate incidents with specific application releases.
4. Detect queue saturation before it becomes uncontrolled.
5. Distinguish external website failures from internal failures.
6. Alert engineers only when action is useful.
7. Stop a bad rollout before it reaches all customers.
8. Restore the previous stable version quickly.
9. Preserve queued work during worker replacement where possible.
10. Verify objectively that the system recovered after rollback.

### 5.8 Final Principle

At production scale, reliability depends not only on preventing failures but
also on detecting and recovering from them quickly.

PagePulse therefore treats observability and rollback as part of the
architecture rather than as operational features added later.

The complete operational cycle is:

Deploy
→ Observe
→ Detect
→ Alert
→ Investigate
→ Mitigate or Roll Back
→ Verify Recovery
→ Learn
→ Improve

This approach allows PagePulse to evolve safely while supporting higher
traffic, asynchronous processing and customer-facing service objectives.

