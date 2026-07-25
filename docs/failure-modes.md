# PagePulse — Failure Modes and Mitigation

## Task B: Design It for Scale

PagePulse is designed to support more than 10,000 audits per day and bursts of
up to 500 concurrent requests.

At this scale, failures should be expected and designed for rather than treated
as exceptional events.

The three most likely production failure modes are:

1. Queue backlog and worker saturation
2. External target website failures and slow responses
3. Redis or persistent dependency failure

This document explains how each failure can occur, its customer impact, how it
can be detected, and how PagePulse should mitigate and recover from it.

---

## 1. Failure Mode — Queue Backlog and Worker Saturation

### Scenario

A sudden traffic burst causes audit jobs to enter the queue faster than the
available workers can process them.

For example:

500 Concurrent Requests
→ Validation
→ Cache Misses
→ Audit Queue
→ Limited Worker Capacity

The queue itself is expected to absorb temporary bursts.

The failure condition occurs when incoming work continues to exceed processing
capacity for long enough that queue waiting time becomes unacceptable.

### Why This Can Happen

Queue backlog can occur because of:

- A sudden burst of audit requests
- A large percentage of cache misses
- Too few worker instances
- Slow external websites
- Increased average audit duration
- Worker crashes
- Excessive retries
- Redis or database latency
- Incorrect worker-concurrency configuration

The system may still technically be running while customer experience is
degrading.

For this reason, queue depth alone should not be treated as the only failure
signal.

### Customer Impact

If the queue continues growing:

- New audits take longer to begin processing
- Total audit completion time increases
- Customer-facing SLA objectives may be missed
- Job-status requests remain in `queued` state longer
- Eventually the queue may reach its configured safety limit

If PagePulse continues accepting unlimited work, the backlog can grow faster
than the system can recover.

### Detection

PagePulse should monitor:

- Queue depth
- Oldest queued-job age
- Job enqueue rate
- Job completion rate
- Number of active workers
- Worker concurrency utilization
- Average audit duration
- p95 audit duration
- Retry rate
- Worker CPU utilization
- Worker memory utilization

The most important signal is the age of the oldest queued job.

For example, a queue containing 100 jobs is not necessarily unhealthy if those
jobs are processed within a few seconds.

However, if the oldest queued job has been waiting for several minutes, the
system is no longer keeping up with demand.

### Alert Conditions

Operational alerts should be triggered when conditions such as the following
remain above configured thresholds:

- Oldest queued-job age exceeds the acceptable processing objective
- Queue depth continues increasing
- Job enqueue rate remains higher than completion rate
- Worker utilization remains near maximum capacity
- Worker failure rate increases significantly

Thresholds should be tuned using load-test and production data.

### Mitigation — Autoscale Workers

The primary mitigation is to increase worker capacity.

Worker autoscaling should respond to queue pressure using signals such as:

Queue Depth
+
Oldest Job Age
+
Worker Utilization
→ Worker Scaling Decision

When queue pressure increases, additional worker instances can be started.

Workers should still maintain bounded concurrency.

Scaling worker count should not mean allowing unlimited outbound requests.

### Mitigation — Cache Reuse

Valid cached results should bypass the queue entirely.

The flow becomes:

Audit Request
→ Redis Cache Hit
→ Return Result

instead of:

Audit Request
→ Queue
→ Worker
→ External Website

A high cache-hit ratio can significantly reduce queue pressure during repeated
audit traffic.

### Mitigation — Duplicate Job Prevention

Many simultaneous requests may target the same URL.

PagePulse should avoid creating separate jobs for identical normalized URLs
when an audit is already queued or processing.

Redis can maintain a short-lived deduplication key.

For example:

`pagepulse:audit-lock:<normalized-url-hash>`

Instead of:

100 Requests for Same URL
→ 100 Jobs

PagePulse can achieve:

100 Requests for Same URL
→ 1 Audit Job
→ Shared Result

This reduces unnecessary queue and worker load.

### Mitigation — Rate Limiting

Distributed per-client rate limiting prevents one customer from consuming an
unreasonable percentage of PagePulse processing capacity.

Requests exceeding the configured limit should receive:

`HTTP 429 Too Many Requests`

This protects capacity for other customers.

### Mitigation — Load Shedding

The queue must have a defined maximum safe capacity.

If PagePulse determines that it cannot accept additional work while meeting
reasonable service objectives, it should reject new audit jobs temporarily.

The API can return:

`HTTP 503 Service Unavailable`

with a structured error response and appropriate retry guidance.

Controlled rejection is safer than accepting unlimited work and allowing the
entire service to become unstable.

### Mitigation — Control Retries

Retries can make queue overload worse.

If a target website is failing, repeatedly retrying thousands of jobs can
generate additional queue pressure.

Retries should therefore use:

- Small maximum attempt counts
- Exponential backoff
- Jitter where appropriate
- Dead-letter handling after repeated failure

Permanent failures should not be retried.

### Recovery

Once incoming demand decreases or additional worker capacity becomes
available:

1. Workers continue draining queued jobs.
2. Autoscaling maintains additional capacity while queue age remains high.
3. Queue depth begins decreasing.
4. Oldest queued-job age returns to the normal range.
5. Load shedding can be disabled.
6. Worker capacity can gradually scale down after sustained recovery.

Workers should not be removed immediately when traffic decreases because the
existing backlog may still need to be processed.

### Prevention

Before production rollout, PagePulse should load-test the exact burst scenario:

`500 concurrent audit requests`

The test should determine:

- Safe worker concurrency
- Required baseline worker count
- Worker startup time
- Queue capacity
- Autoscaling thresholds
- Maximum acceptable queue age
- Load-shedding threshold

These values should be based on measurements rather than assumptions.

### Failure Mode Summary

| Area | Strategy |
|---|---|
| Failure | Queue grows faster than workers can process jobs |
| Primary Signal | Oldest queued-job age |
| Secondary Signals | Queue depth, worker utilization, completion rate |
| Customer Impact | Increased audit completion time |
| Primary Mitigation | Worker autoscaling |
| Additional Protection | Cache, deduplication and rate limiting |
| Extreme Overload | Controlled `503` load shedding |
| Recovery | Drain queue before gradually scaling workers down |

The key principle is that a queue is not infinite capacity.

The queue provides temporary backpressure, while autoscaling, caching,
deduplication, rate limiting and load shedding prevent a temporary traffic
burst from becoming a system-wide failure.

---

## 2. Failure Mode — External Website Failures and Slow Responses

### Scenario

PagePulse depends on external websites to perform audits.

Unlike PagePulse infrastructure, these target websites are outside our control.

A target website may:

- Respond very slowly
- Return HTTP 4xx or 5xx errors
- Fail DNS resolution
- Refuse the connection
- Reset the connection
- Redirect repeatedly
- Return an unexpectedly large response
- Become temporarily unavailable
- Block automated requests

If many target websites behave poorly at the same time, audit workers can
remain occupied for longer periods and overall processing capacity can fall.

### Why This Can Happen

External website failures may occur because of:

- Target-server outages
- Network connectivity problems
- DNS failures
- Server overload
- Rate limiting by the target website
- Misconfigured websites
- Redirect loops
- Slow application servers
- Large HTML responses
- Temporary upstream failures

These failures do not necessarily indicate that PagePulse itself is unhealthy.

The architecture must therefore distinguish external-site failures from
internal PagePulse failures.

### Customer Impact

Slow or failing target websites can cause:

- Increased audit completion time
- Audit timeouts
- Failed audits
- Increased worker utilization
- Increased queue waiting time
- Additional retry traffic
- Reduced overall audit throughput

Without appropriate limits, a small number of very slow websites could consume
a large percentage of available worker capacity.

### Detection

PagePulse should monitor external-request metrics separately from internal API
metrics.

Important signals include:

- DNS failure rate
- Connection failure rate
- Target HTTP 4xx rate
- Target HTTP 5xx rate
- External request duration
- Audit timeout rate
- Redirect-limit failures
- Response-size-limit failures
- Retry rate
- Average audit duration
- p95 audit duration

Structured logs should include enough information to identify whether a
failure occurred inside PagePulse or while communicating with the target
website.

### Mitigation — Strict Request Timeouts

Every outbound website request must have a configurable timeout.

A target website should never be allowed to keep a worker occupied
indefinitely.

For example:

Worker
→ Start External Request
→ Timeout Reached
→ Cancel Request
→ Release Resources
→ Classify Failure

The exact timeout should be selected using realistic production measurements.

### Mitigation — Bounded Worker Concurrency

Workers should process only a limited number of audits simultaneously.

Even if hundreds of jobs are waiting, a worker should not create an unlimited
number of outbound network connections.

Bounded concurrency protects:

- CPU
- Memory
- Network connections
- File descriptors
- Redis connections
- Database connections

If additional capacity is required, PagePulse can scale the number of workers
while maintaining a safe concurrency limit per worker.

### Mitigation — Response-Size Limits

A target website may return an extremely large response.

PagePulse should enforce a maximum response-size limit.

If the response exceeds the configured limit:

1. Stop reading the response.
2. Release the network connection.
3. Mark the audit with a structured failure.
4. Do not retry unless there is a specific reason to believe retrying would
   produce a different result.

This prevents a single target from consuming excessive worker memory and
network bandwidth.

### Mitigation — Redirect Limits

PagePulse should define a maximum number of redirects.

Every redirect destination must also pass the same URL and SSRF security
validation as the original URL.

If the redirect limit is exceeded, the audit should fail with a structured
error.

This protects workers from:

- Redirect loops
- Excessive request chains
- Redirect-based SSRF attempts

### Mitigation — Failure Classification

Not every external failure should be retried.

PagePulse should classify failures into transient and permanent categories.

Transient failures may include:

- Connection reset
- Temporary DNS failure
- HTTP 502
- HTTP 503
- Selected timeouts

Permanent failures may include:

- Invalid URL
- Unsupported protocol
- SSRF rejection
- Response exceeding the configured size limit
- Redirect-limit violation

Only failures that have a reasonable chance of recovering should be retried.

### Mitigation — Bounded Retries

Eligible transient failures can be retried, but retries must remain limited.

A retry strategy should use:

- Small maximum attempt count
- Exponential backoff
- Jitter where appropriate

For example:

Attempt 1
→ Failure

Short Delay
→ Attempt 2

Longer Delay
→ Attempt 3

If the job continues failing, it should stop retrying and enter the
failed-job or dead-letter workflow.

This prevents one unavailable website from consuming worker capacity
indefinitely.

### Mitigation — Cache Successful Results

If PagePulse has a valid cached result for a URL, it should return that result
without contacting the target website again.

This is particularly valuable when the target website is temporarily slow or
unavailable.

Cache reuse reduces both customer latency and unnecessary external requests.

### Mitigation — Per-Host Protection

A single external domain should not be able to consume all PagePulse worker
capacity.

As the system grows, PagePulse can introduce per-host concurrency limits.

For example, if many customers simultaneously request audits for the same
domain, PagePulse can limit the number of active requests to that domain.

This provides fairness across target websites and reduces the chance of
overloading an external service.

It also reduces the risk that one slow domain consumes the majority of
available outbound connections.

### Mitigation — Circuit Breaker

For repeatedly failing external hosts, PagePulse can introduce a circuit
breaker.

Conceptually:

Normal Requests
→ Target Host

Repeated Failures
→ Circuit Opens

Circuit Open
→ Temporarily Stop New Requests to That Host

After a cooldown period:

Circuit Half-Open
→ Allow Limited Test Request

If Successful
→ Circuit Closes

If Still Failing
→ Circuit Opens Again

A circuit breaker prevents PagePulse from repeatedly spending resources on a
target that is clearly unavailable.

This can be introduced if production measurements show repeated host-specific
failures becoming a significant source of worker load.

### SSRF Protection During External Requests

External request handling must continue to enforce PagePulse security rules.

Workers should:

- Accept only HTTP and HTTPS
- Block localhost
- Block private network ranges
- Block link-local addresses
- Block cloud metadata endpoints
- Validate DNS-resolved addresses
- Revalidate redirect destinations

A failed security check should be treated as a permanent failure and should
not be retried.

### Recovery

External target failures usually recover independently from PagePulse.

When a target website becomes healthy again:

1. New audit jobs can access the target normally.
2. Circuit breakers, if used, move through their recovery state.
3. Successful audits repopulate the Redis cache.
4. Retry rates decrease.
5. Worker processing duration returns toward normal.
6. Queue pressure decreases.

PagePulse should not require a deployment or restart simply because an
external website was temporarily unavailable.

### Observability

External failures should be clearly distinguishable from PagePulse
infrastructure failures.

For example:

`TARGET_TIMEOUT`

should not be reported internally as:

`PAGEPULSE_API_FAILURE`

This distinction prevents engineers from treating third-party website
problems as PagePulse outages.

Dashboards should separately display:

- PagePulse internal error rate
- Target website error rate
- Target timeout rate
- Audit success rate

### Failure Mode Summary

| Area | Strategy |
|---|---|
| Failure | External websites become slow, unavailable or return errors |
| Primary Signal | External request latency and timeout rate |
| Secondary Signals | DNS failures, HTTP 5xx, retries, audit duration |
| Customer Impact | Slow or failed audits |
| Primary Mitigation | Strict outbound request timeout |
| Resource Protection | Bounded worker concurrency and response-size limits |
| Retry Strategy | Limited retries with exponential backoff |
| Repeated Host Failure | Optional circuit breaker |
| Security | SSRF and redirect validation on every request |
| Recovery | Resume normal processing when the external target recovers |

The key principle is that PagePulse must treat every external website as an
unreliable dependency.

A slow or broken target website should cause an individual audit to fail
cleanly rather than reducing the availability of the entire PagePulse
platform.

---

## 3. Failure Mode — Redis or Critical Dependency Failure

### Scenario

The scaled PagePulse architecture depends on shared infrastructure such as
Redis, the job queue and PostgreSQL.

Redis is particularly important because it supports:

- Distributed caching
- Rate-limit counters
- Audit deduplication
- Distributed coordination
- BullMQ queue infrastructure

If Redis becomes unavailable or experiences severe latency, multiple PagePulse
features can be affected simultaneously.

Similarly, PostgreSQL failure can prevent PagePulse from safely storing durable
audit results.

### Why This Can Happen

A critical dependency may fail because of:

- Infrastructure outage
- Network connectivity problems
- Resource exhaustion
- Redis memory pressure
- Too many connections
- Database connection exhaustion
- Misconfiguration
- Deployment or configuration errors
- Cloud-provider incidents
- Storage failures
- Maintenance events

PagePulse must assume that shared dependencies can occasionally become
unavailable.

### Customer Impact

A Redis failure may affect:

- Cache lookups
- Cache writes
- Distributed rate limiting
- Duplicate-job detection
- BullMQ job creation
- Worker job consumption

If BullMQ depends on the unavailable Redis instance, PagePulse may be unable to
accept new audit jobs safely.

A PostgreSQL failure may prevent:

- Audit-status updates
- Durable result storage
- Audit-history retrieval
- Customer-data operations

The exact customer impact depends on which dependency is unavailable.

### Detection

PagePulse should continuously monitor dependency health.

Important Redis signals include:

- Connection failures
- Command latency
- Memory utilization
- Connection count
- Evictions
- Error rate
- Queue-operation failures

Important PostgreSQL signals include:

- Connection failures
- Query latency
- Connection-pool utilization
- Database error rate
- CPU utilization
- Storage utilization

Application logs should clearly identify dependency-related failures.

### Mitigation — Managed High-Availability Services

For production, Redis and PostgreSQL should preferably use managed services
with appropriate high-availability capabilities.

Depending on the provider and service tier, this can provide:

- Automated failover
- Replication
- Infrastructure monitoring
- Backups
- Security updates
- Recovery tooling

This reduces the amount of database and cache infrastructure that the
PagePulse application team must operate directly.

### Mitigation — Connection Pooling

PagePulse must control the number of connections opened to shared
dependencies.

Without connection pooling, horizontal scaling could create:

Many API Instances
+
Many Workers
→ Excessive Database Connections

The application should configure connection pools according to the capacity of
the underlying service.

Pool utilization should be monitored so PagePulse can detect saturation before
all connections are exhausted.

### Mitigation — Timeouts

Calls to Redis and PostgreSQL should have appropriate timeouts.

An API request or worker should not wait indefinitely for an unavailable
dependency.

Timeouts allow PagePulse to:

1. Detect dependency problems quickly.
2. Release application resources.
3. Return or record a controlled failure.
4. Trigger monitoring and alerts.

### Mitigation — Bounded Retries

Temporary dependency failures may be retried, but retries must remain bounded.

Immediate unlimited retries can make an infrastructure outage worse by
creating a retry storm.

Retries should use:

- Maximum attempt limits
- Exponential backoff
- Jitter where appropriate

If the dependency remains unavailable, PagePulse should degrade or fail the
operation safely rather than retrying forever.

### Redis Failure Strategy

Not every Redis operation has the same failure policy.

#### Cache Failure

If Redis cache lookup fails, PagePulse may be able to continue without the
cached result if the queue and required coordination infrastructure remain
healthy.

This means the request becomes a cache miss rather than causing the entire API
to fail.

However, the incident should still be recorded and monitored because cache
failure increases worker load.

#### Rate-Limit Failure

Distributed rate limiting is a protection mechanism.

Silently disabling rate limiting during a Redis outage could expose PagePulse
to uncontrolled traffic.

The production policy should therefore explicitly decide whether affected
audit requests fail closed or use a carefully controlled fallback.

For expensive audit creation, protecting service capacity is more important
than silently allowing unlimited requests.

#### Deduplication Failure

If deduplication becomes unavailable, PagePulse may create duplicate audit
jobs.

This is not necessarily a data-loss failure, but it can significantly increase
worker and external-request load.

Deduplication failures should therefore be visible through metrics and alerts.

#### Queue Failure

Queue availability is more critical.

If the API cannot reliably place a new audit into the BullMQ queue, it should
not tell the customer that the audit was accepted.

Instead, PagePulse should return a structured response such as:

`HTTP 503 Service Unavailable`

This avoids acknowledging work that may never execute.

### PostgreSQL Failure Strategy

PostgreSQL stores durable PagePulse state.

If a worker completes an audit but cannot persist the result, it should not
mark the operation as durably completed.

Depending on the implementation, PagePulse can:

- Retry the database operation using bounded backoff
- Leave the queue job unacknowledged
- Requeue the operation
- Record the failure for recovery

The important principle is:

`Audit executed` does not automatically mean `Audit durably completed`.

Durable completion should require successful persistence of the required
result.

### Mitigation — Graceful Degradation

PagePulse should degrade only where doing so remains safe.

For example:

Redis Cache Unavailable
→ Potentially continue with reduced caching

Queue Unavailable
→ Stop accepting new asynchronous audits

PostgreSQL Unavailable
→ Avoid claiming durable completion

Observability Platform Unavailable
→ Application may continue while buffering or reducing telemetry where safe

This prevents one optional capability from unnecessarily taking down the whole
service while still treating critical consistency failures seriously.

### Mitigation — Circuit Breaking

If a dependency repeatedly fails, PagePulse should avoid continuously sending
requests that are expected to fail.

A circuit breaker can temporarily stop dependency calls after repeated
failures.

Conceptually:

Healthy Dependency
→ Requests Allowed

Repeated Failures
→ Circuit Opens

Circuit Open
→ Fail Quickly

Cooldown
→ Limited Test Request

Dependency Recovered
→ Circuit Closes

This reduces resource consumption during prolonged outages.

### Mitigation — Resource Isolation

Redis supports several PagePulse responsibilities.

At the initial target scale, using Redis for both shared state and BullMQ can
reduce operational complexity.

However, this also creates a larger failure domain.

If production measurements show that queue traffic and cache traffic interfere
with each other, PagePulse can separate them into dedicated Redis deployments:

Redis A
→ Cache / Rate Limiting / Deduplication

Redis B
→ BullMQ Queue

This increases infrastructure cost but improves workload and failure
isolation.

The separation should be introduced when measurements justify it rather than
prematurely.

### Backup and Recovery

Durable PostgreSQL data should have an appropriate backup and recovery
strategy.

Depending on business requirements, this can include:

- Automated backups
- Point-in-time recovery
- Backup retention policies
- Periodic restore testing

A backup is only useful if the team has verified that it can actually be
restored.

Redis cache data generally does not require the same durability guarantees
because cached audit results can be regenerated.

Queue durability requirements should be configured according to the guarantees
PagePulse provides for accepted audit jobs.

### Alerting

Critical dependency alerts should include:

- Redis unavailable
- Redis latency significantly increased
- Redis memory nearing capacity
- Queue operations failing
- PostgreSQL unavailable
- Database connection pool exhausted
- Database query latency significantly increased
- Database storage nearing capacity

Dependency failures that prevent new audit processing should generate
high-priority operational alerts.

### Recovery

When a failed dependency becomes healthy:

1. Verify connectivity.
2. Confirm latency has returned to normal.
3. Confirm API instances can access the dependency.
4. Confirm workers can access the dependency.
5. Resume queue processing if it was paused.
6. Monitor failed and delayed jobs.
7. Drain any accumulated backlog.
8. Verify database writes and cache operations.
9. Confirm customer-facing error rates return to normal.

The system should recover gradually rather than immediately generating a large
burst of retry traffic.

### Failure Mode Summary

| Area | Strategy |
|---|---|
| Failure | Redis, queue or PostgreSQL becomes unavailable |
| Primary Signal | Dependency connection/error rate |
| Secondary Signals | Latency, pool usage, Redis memory, queue failures |
| Customer Impact | Reduced functionality or inability to process audits |
| Cache Failure | Degrade safely where possible |
| Queue Failure | Stop accepting work that cannot be persisted |
| Database Failure | Do not claim durable completion |
| Retry Strategy | Bounded exponential backoff |
| Availability | Managed HA services where appropriate |
| Recovery | Restore gradually and drain backlog |
| Long-Term Protection | Monitoring, backups and resource isolation |

The key principle is that PagePulse should never acknowledge work that it
cannot reliably process or persist.

Optional functionality may degrade temporarily, but failures in critical
dependencies must produce controlled and observable behavior rather than
silent data loss.