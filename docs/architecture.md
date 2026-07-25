# PagePulse — Scalable Architecture

## Task B: Design It for Scale

PagePulse currently provides synchronous URL audits through a REST API.
This document describes how I would evolve the service to support:

- 10,000+ audits per day
- Bursts of up to 500 concurrent audit requests
- A customer-facing response-time SLA
- Reliable processing during traffic spikes
- Horizontal scaling without losing application state

The main design principle is to keep the API layer lightweight and move
expensive URL-audit work into independently scalable workers.

---

## 1. High-Level Architecture

```mermaid
flowchart LR
    C[Client] --> LB[Load Balancer / API Gateway]

    LB --> API1[PagePulse API Instance]
    LB --> API2[PagePulse API Instance]
    LB --> APIN[PagePulse API Instance N]

    API1 --> REDIS[(Redis)]
    API2 --> REDIS
    APIN --> REDIS

    API1 --> Q[Audit Job Queue]
    API2 --> Q
    APIN --> Q

    Q --> W1[Audit Worker 1]
    Q --> W2[Audit Worker 2]
    Q --> WN[Audit Worker N]

    W1 --> WEB[Target Websites]
    W2 --> WEB
    WN --> WEB

    W1 --> DB[(Persistent Database)]
    W2 --> DB
    WN --> DB

    W1 --> REDIS
    W2 --> REDIS
    WN --> REDIS

    API1 --> OBS[Logs / Metrics / Traces]
    API2 --> OBS
    APIN --> OBS

    W1 --> OBS
    W2 --> OBS
    WN --> OBS

    ---

## 2. Request Flow

PagePulse uses two main request paths depending on whether the requested
URL already has a valid cached audit result.

### 2.1 Cache-Hit Path

When an audit result is already available in the cache:

1. A client sends an audit request to the PagePulse API.
2. The load balancer routes the request to an available API instance.
3. The API validates the incoming URL and performs security checks.
4. The API checks Redis for a recent audit result for the normalized URL.
5. If a valid cached result exists, the API returns it immediately.
6. No new external website request or audit job is required.

This provides a fast response for frequently requested URLs and reduces
unnecessary network requests and processing.

### 2.2 Cache-Miss Path

When an audit result is not available in the cache:

1. The client sends an audit request.
2. The API validates the request and applies rate limiting.
3. Redis is checked for an existing cached audit.
4. If no valid result exists, the API creates an audit job.
5. The audit job is added to the job queue.
6. An available audit worker takes the job from the queue.
7. The worker safely fetches the target website using strict timeout and
   network-security restrictions.
8. The worker analyzes the page and generates the audit result.
9. The completed result is stored in persistent storage and Redis.
10. The audit result becomes available to the client.

### 2.3 Why Two Request Paths Are Useful

Separating cache hits from new audits improves both performance and
scalability.

Cached requests can be served quickly without contacting the target
website, while expensive new audits are handled through controlled
background processing.

This prevents repeated audits of the same URL from unnecessarily consuming
worker capacity.

---

## 3. Why Introduce a Queue?

The current PagePulse implementation processes audits directly during the
HTTP request lifecycle. This approach works well for smaller workloads,
but it becomes difficult to control when hundreds of audit requests arrive
at the same time.

At the target scale, PagePulse must be capable of handling bursts of up to
500 concurrent requests. Allowing all 500 requests to immediately fetch
external websites could exhaust CPU, memory, network connections, and
other server resources.

A job queue solves this problem by introducing controlled asynchronous
processing between the API layer and the audit workers.

### 3.1 Backpressure

Instead of starting every audit immediately, incoming audit jobs are added
to a queue.

Workers consume jobs only when processing capacity is available.

This creates backpressure and prevents sudden traffic spikes from
overloading the PagePulse infrastructure.

### 3.2 Controlled Concurrency

Each worker processes only a limited number of audits simultaneously.

For example, if the system receives 500 requests at once, those requests
do not need to create 500 simultaneous outbound website connections.

The requests can be queued and processed according to the available worker
capacity.

### 3.3 Independent Scaling

The API layer and audit-processing layer can scale independently.

If API traffic increases, additional API instances can be added.

If the audit queue grows, additional worker instances can be started to
increase processing capacity.

This provides more efficient resource utilization than scaling the entire
application as a single unit.

### 3.4 Retry and Failure Handling

A queue also provides a controlled mechanism for handling temporary
failures.

If an audit fails because of a temporary network problem or target-site
failure, the job can be retried using a limited retry policy with
exponential backoff.

Jobs that repeatedly fail can be moved to a dead-letter queue for
inspection instead of being retried indefinitely.

### 3.5 Benefits of the Queue

The queue provides PagePulse with:

- Backpressure during sudden traffic bursts
- Bounded audit concurrency
- Better resource protection
- Independent worker scaling
- Controlled retries
- Failed-job isolation
- Improved resilience during temporary downstream failures

Therefore, the queue acts as a buffer between incoming customer requests
and expensive URL-audit operations, allowing PagePulse to remain
responsive even during large traffic bursts.

---

## 4. Component Responsibilities

The scaled PagePulse architecture separates responsibilities across
multiple components. This prevents the API layer from becoming overloaded
with expensive audit-processing work and allows each part of the system
to scale independently.

### 4.1 Load Balancer / API Gateway

The load balancer is the public entry point for PagePulse.

Its responsibilities include:

- Distributing incoming requests across available API instances
- Performing basic traffic routing
- Supporting HTTPS termination
- Preventing a single API instance from receiving all traffic
- Allowing API instances to scale horizontally

This ensures incoming traffic can be distributed across multiple
application instances.

### 4.2 API Layer

The API layer handles lightweight request-processing responsibilities.

Its responsibilities include:

- Validating incoming requests
- Normalizing submitted URLs
- Performing URL security and SSRF checks
- Identifying clients
- Applying per-client rate limits
- Generating request IDs
- Checking the cache
- Submitting audit jobs to the queue
- Returning cached results or job information

The API layer should remain stateless. This allows any request to be
handled by any available API instance.

### 4.3 Redis

Redis stores short-lived and shared operational state.

Its responsibilities include:

- Caching completed audit results
- Storing distributed rate-limit counters
- Supporting duplicate-job detection
- Maintaining temporary job-status information
- Coordinating state across multiple API instances

Using shared Redis instead of process-local memory is important because
PagePulse may run multiple API and worker instances.

If cache state existed only inside one API process, different instances
could return inconsistent results.

### 4.4 Audit Job Queue

The job queue sits between the API layer and audit workers.

Its responsibilities include:

- Buffering audit requests
- Providing backpressure
- Controlling how work reaches workers
- Supporting retry policies
- Tracking pending and failed jobs
- Allowing workers to consume jobs independently

The queue prevents traffic spikes from immediately becoming equivalent
spikes in expensive outbound website requests.

### 4.5 Audit Workers

Audit workers perform the resource-intensive part of PagePulse.

Their responsibilities include:

- Consuming jobs from the queue
- Resolving and validating target hosts
- Enforcing SSRF protections
- Fetching external websites
- Applying request timeouts
- Enforcing response-size limits
- Parsing returned HTML
- Analyzing metadata, headings, links and images
- Generating structured audit results
- Updating Redis with cacheable results
- Persisting durable audit information
- Recording processing metrics and logs

Worker concurrency is deliberately bounded.

This protects PagePulse and target websites from an uncontrolled number of
simultaneous outbound requests.

### 4.6 Persistent Database

A persistent database stores information that must survive process
restarts and cache expiration.

This can include:

- Audit records
- Audit status
- Creation and completion timestamps
- Customer/job relationships
- Historical audit information
- Failure metadata where appropriate

Redis should not be treated as the only durable source of important
business data.

The database becomes the system of record for information that PagePulse
must retain.

### 4.7 Observability Platform

Logs, metrics and traces from API instances and workers are sent to a
centralized observability system.

It is responsible for providing visibility into:

- API request latency
- Error rates
- Request volume
- Queue depth
- Oldest queued-job age
- Worker utilization
- Audit duration
- Cache hit ratio
- Rate-limit activity
- External website failures

This allows operational problems to be detected before they become
customer-facing incidents.

### 4.8 Target Websites

Target websites are external dependencies and are outside PagePulse's
control.

They may:

- Respond slowly
- Return errors
- Redirect requests
- Reject automated traffic
- Return unexpectedly large responses
- Become temporarily unavailable

For this reason, PagePulse must treat every external request as
unreliable and enforce strict security, timeout and resource limits.

---

## 5. Handling Bursts of 500 Concurrent Requests

The target architecture must handle sudden bursts of up to 500 concurrent
audit requests without allowing the system to become overloaded.

The key principle is that 500 incoming requests should not automatically
become 500 simultaneous outbound requests to external websites.

### 5.1 Request Admission

When a burst reaches PagePulse, requests first pass through the API layer.

Each request goes through:

1. Input validation
2. URL normalization
3. Security and SSRF validation
4. Client identification
5. Per-client rate limiting
6. Cache lookup

Invalid or rate-limited requests are rejected before consuming expensive
audit-processing resources.

Requests that already have a valid cached result can be served immediately.

Only genuine cache misses need to enter the audit-processing pipeline.

### 5.2 Queue the Remaining Work

For cache misses, the API creates audit jobs and places them into the job
queue.

For example, if 500 requests arrive and 150 can be served from cache,
only the remaining 350 requests need audit processing.

Those jobs can wait safely in the queue instead of starting hundreds of
outbound network requests simultaneously.

The API can quickly acknowledge accepted work with a job identifier.

### 5.3 Bounded Worker Concurrency

Workers consume jobs using a configured concurrency limit.

For example, a worker may process only a fixed number of audits
simultaneously.

If additional processing capacity is required, PagePulse can start more
worker instances while still maintaining a controlled concurrency limit
per worker.

This protects:

- CPU
- Memory
- Network connections
- File descriptors
- Redis and database connections
- External target websites

The exact concurrency value should be determined through load testing
rather than assuming that maximum parallelism provides maximum
performance.

### 5.4 Autoscaling Based on Queue Pressure

Worker scaling should respond primarily to queue pressure rather than
only HTTP request volume.

Useful scaling signals include:

- Number of waiting jobs
- Age of the oldest waiting job
- Worker utilization
- Average audit duration
- Audit completion rate

If queue depth and queue age increase beyond acceptable thresholds,
additional workers can be started.

When demand falls and the queue remains consistently low, worker capacity
can be reduced.

### 5.5 Duplicate Request Protection

Traffic bursts may contain multiple requests for the same URL.

PagePulse should normalize URLs and use a short-lived distributed lock or
deduplication key in Redis.

If an audit for the same normalized URL is already running, PagePulse can
avoid creating another identical job and allow multiple clients to use
the result of the existing audit.

This reduces unnecessary external requests and worker usage.

### 5.6 Overload Protection

The queue should not be allowed to grow without limit.

If PagePulse reaches a defined maximum queue depth or the estimated wait
time exceeds the service's acceptable threshold, the API should apply
load shedding.

Depending on the API contract, it can return an appropriate response such
as:

`503 Service Unavailable`

with a structured error body and retry guidance.

Rejecting a controlled percentage of work during extreme overload is
safer than allowing the entire service to become unavailable.

### 5.7 Result

With this design, a burst of 500 requests is converted into controlled
work:

Client Requests
→ Validation
→ Rate Limiting
→ Cache Lookup
→ Deduplication
→ Queue
→ Bounded Workers
→ Result Storage

This allows PagePulse to absorb short traffic spikes while keeping API
instances responsive and protecting expensive downstream resources.

---

## 6. State Management — Where State Lives

A horizontally scaled PagePulse deployment may have multiple API instances
and multiple audit workers running at the same time.

For this reason, important application state must not exist only inside the
memory of a single Node.js process.

State is separated based on its purpose, lifetime and durability
requirements.

### 6.1 Stateless API Instances

PagePulse API instances should remain stateless.

An API instance should not depend on local memory for information required
by future requests.

This means any incoming request can be routed to any healthy API instance
by the load balancer.

Keeping the API stateless makes horizontal scaling and instance replacement
much simpler.

### 6.2 Redis — Short-Lived Shared State

Redis stores temporary state that must be shared across multiple PagePulse
instances.

This includes:

- Cached audit results
- Rate-limit counters
- URL deduplication keys
- Distributed locks
- Temporary job-status information
- Short-lived coordination data

For example, the current PagePulse implementation uses an in-memory cache
and rate limiter.

At larger scale, process-local state would become inconsistent because each
API instance would have its own independent copy.

Moving this state to Redis gives all API instances a shared view.

### 6.3 Job Queue — Work State

The job queue stores audit work that has been accepted but has not yet
completed.

Typical job states include:

- Waiting
- Active
- Completed
- Failed
- Delayed for retry

The queue ensures that accepted audit work is not tied to the lifetime of
the API instance that received the original request.

If an API instance restarts after creating a job, workers can still process
that job.

### 6.4 Persistent Database — Durable State

Information that must survive cache expiration, worker restarts and service
deployments is stored in a persistent database.

Examples include:

- Audit ID
- Normalized URL
- Audit status
- Audit result
- Creation timestamp
- Completion timestamp
- Failure information
- Customer or client association
- Historical audit records

The persistent database acts as the system of record for durable PagePulse
data.

### 6.5 Observability Storage

Operational information is stored separately from application data.

This includes:

- Structured application logs
- Request IDs
- Error events
- Performance metrics
- Queue metrics
- Worker metrics
- Distributed traces

Centralizing this information makes it possible to investigate requests
across API instances, workers and infrastructure components.

### 6.6 State Ownership Summary

| Type of State | Location | Reason |
|---|---|---|
| API session/process state | None | API instances remain stateless |
| Audit result cache | Redis | Fast shared access with configurable TTL |
| Rate-limit counters | Redis | Consistent limits across API instances |
| URL deduplication | Redis | Prevent duplicate audits across workers |
| Distributed locks | Redis | Coordinate concurrent processing |
| Pending audit jobs | Job queue | Durable buffering and backpressure |
| Temporary job status | Queue / Redis | Fast status lookup |
| Completed audit records | Persistent database | Durable source of truth |
| Audit history | Persistent database | Survives cache expiration and restarts |
| Logs | Centralized logging platform | Cross-instance troubleshooting |
| Metrics | Monitoring platform | Performance and reliability monitoring |
| Traces | Tracing platform | End-to-end request investigation |

### 6.7 Why This Separation Matters

Separating state by responsibility prevents PagePulse from depending on a
specific server instance.

For example, consider the following sequence:

1. API Instance A receives an audit request.
2. Instance A creates a job in the shared queue.
3. Worker B processes the audit.
4. Worker B stores the result in Redis and the persistent database.
5. API Instance C receives the client's later status request.
6. Instance C can retrieve the result because the state is shared.

No request depends on returning to the original server.

This allows API instances and workers to be restarted, replaced or scaled
without losing important application state.

---

## 7. Customer-Facing SLA Strategy

PagePulse must provide a predictable customer-facing response-time SLA even
though each audit depends on an external website whose performance is outside
PagePulse's control.

A target website may respond immediately, take several seconds, redirect
multiple times, or fail completely. Therefore, PagePulse should separate the
API response-time SLA from the time required to complete a fresh audit.

### 7.1 Two Response Paths

PagePulse has two primary response paths:

1. Cached audit
2. New audit

These paths have different performance characteristics and should be handled
differently.

### 7.2 Cached Audit SLA

If a valid audit result already exists in Redis, PagePulse can return it
without contacting the target website or creating a new audit job.

A reasonable internal service objective would be:

- Target: 95% of cached requests complete within 300 ms
- Measurement: API latency from request receipt to response
- Excludes: Client-side network latency outside PagePulse infrastructure

Cached requests should provide the fastest PagePulse experience.

### 7.3 New Audit SLA

A new audit requires PagePulse to fetch and analyze an external website.

PagePulse cannot guarantee that every external website will respond within a
fixed short period.

Instead of keeping the original HTTP connection open until the entire audit
finishes, the scalable architecture accepts the audit request and returns a
job identifier quickly.

For example:

POST /api/v1/audits

The API could return:

HTTP 202 Accepted

with a response similar to:

{
  "success": true,
  "jobId": "audit_12345",
  "status": "queued"
}

A reasonable internal objective would be for 95% of valid new audit requests
to receive this acknowledgement within 500 ms under normal operating
conditions.

The exact production SLA should ultimately be selected from measured load-test
and production data rather than assumed in advance.

### 7.4 Audit Status Endpoint

The client can retrieve the state of an asynchronous audit through an endpoint
such as:

GET /api/v1/audits/:jobId

Possible states include:

- queued
- processing
- completed
- failed

When the audit completes, the endpoint returns the structured PagePulse audit
result.

This keeps the public API responsive even when an external website is slow.

### 7.5 Audit Execution Deadline

Workers still require strict execution limits.

Each outbound request should have a configurable timeout.

If the target website does not respond within the allowed period, the worker
should stop processing and return a structured failure rather than consuming
resources indefinitely.

An audit may therefore end as:

- completed
- timed out
- rejected for security reasons
- failed because of an external-site error

This prevents slow target websites from exhausting worker capacity.

### 7.6 Queue-Wait Monitoring

Asynchronous processing only protects the SLA if queue delay is monitored.

PagePulse should measure:

- Queue depth
- Oldest queued-job age
- Time from job creation to processing start
- Time from processing start to completion
- Total audit completion time

If queue-wait time rises, PagePulse can automatically increase worker
capacity.

If capacity is exhausted and acceptable wait times cannot be maintained,
PagePulse should apply controlled load shedding rather than allowing latency
to increase without limit.

### 7.7 SLA Measurement

PagePulse should monitor latency using percentiles rather than only averages.

Important measurements include:

- p50 latency
- p95 latency
- p99 latency

For example, an average response time can appear healthy even when a small
percentage of customers experience extremely slow requests.

The p95 and p99 measurements expose these tail-latency problems.

### 7.8 SLA Summary

The proposed SLA strategy separates fast API responsiveness from unpredictable
external website processing.

| Operation | Proposed Objective |
|---|---|
| Health check | Fast synchronous response |
| Cached audit | 95% within 300 ms |
| New audit acknowledgement | 95% within 500 ms |
| Audit execution | Asynchronous with configurable timeout |
| Job status lookup | Fast synchronous response |

These values are initial engineering objectives rather than measured production
guarantees. They should be validated and adjusted using load testing and real
production telemetry.

This design allows PagePulse to provide a predictable customer-facing API
while safely handling websites with unpredictable response times.

---

## 8. Scaling Strategy

PagePulse should scale different parts of the system independently based on
the type of workload each component handles.

The API layer primarily handles lightweight HTTP operations, while audit
workers perform expensive network requests and HTML analysis. Scaling these
components separately provides better resource efficiency and allows the
system to respond appropriately to different types of load.

### 8.1 API Horizontal Scaling

The PagePulse API should remain stateless and run across multiple instances
behind a load balancer.

When incoming API traffic increases, additional API instances can be started
without changing the application architecture.

Useful API autoscaling signals include:

- Requests per second
- CPU utilization
- Memory utilization
- p95 response latency
- Active connections
- HTTP 5xx error rate

For example, if API latency and CPU usage remain above configured thresholds
for a sustained period, the platform can start additional API instances.

Because shared state is stored outside the API processes, new instances can
begin serving traffic immediately.

### 8.2 Worker Horizontal Scaling

Audit workers should scale independently from API instances.

Worker scaling should primarily depend on:

- Queue depth
- Oldest queued-job age
- Number of active jobs
- Worker CPU utilization
- Worker memory utilization
- Average audit duration
- Audit completion rate

If the queue grows faster than workers can process jobs, additional workers
can be started.

This directly increases audit-processing capacity without unnecessarily
adding more public API instances.

### 8.3 Bounded Concurrency Per Worker

Each worker should have a configurable concurrency limit.

A worker should never start an unlimited number of outbound website requests
simply because many jobs are waiting.

For example, the deployment may run multiple workers where each worker
processes a limited number of audits concurrently.

The exact concurrency limit should be determined through load testing based
on:

- Available CPU
- Available memory
- Network capacity
- Average response size
- Average audit duration
- Database connection limits
- Redis connection limits

This prevents aggressive scaling from creating a new bottleneck elsewhere in
the system.

### 8.4 Minimum Warm Capacity

PagePulse should maintain enough baseline worker capacity to handle normal
traffic without waiting for new infrastructure to start.

This is important because autoscaling is not instantaneous.

If a burst of requests arrives while no worker capacity is available, users
may experience unnecessary queue delays while new workers start.

A small amount of warm capacity reduces this cold-start impact.

### 8.5 Scale-Out Strategy During a Burst

When a large traffic burst occurs, PagePulse should respond in stages:

1. Rate limiting removes abusive or excessive client traffic.
2. Cache hits are returned immediately.
3. Duplicate audits are consolidated.
4. Remaining cache misses enter the queue.
5. Existing workers process jobs using bounded concurrency.
6. Queue-depth and queue-age metrics trigger additional worker capacity.
7. New workers begin consuming queued jobs.
8. Capacity is reduced gradually after demand returns to normal.

This allows PagePulse to absorb bursts without immediately over-provisioning
every component.

### 8.6 Scale-In Strategy

Scaling down must also be controlled.

Workers should not be terminated while actively processing audit jobs.

Before an instance is removed, it should stop accepting new jobs and be given
time to finish its current work.

This graceful shutdown process reduces:

- Lost jobs
- Duplicate processing
- Partial audit results
- Unnecessary retries

Scale-in should occur only after queue pressure and worker utilization remain
low for a sustained period.

### 8.7 Redis and Database Scaling

Scaling API servers and workers is not sufficient if shared infrastructure
becomes the bottleneck.

Redis should be monitored for:

- Memory usage
- Connection count
- Command latency
- Evictions
- Cache hit ratio

The persistent database should be monitored for:

- Connection utilization
- Query latency
- CPU usage
- Storage utilization
- Slow queries

Connection pooling should be used so hundreds of application processes do not
create uncontrolled numbers of database connections.

### 8.8 Capacity Planning

The requirement of 10,000 audits per day represents an average of only a
small number of audits per minute, but averages can hide short periods of
extreme traffic.

Therefore, PagePulse capacity planning should focus on both:

- Sustained daily throughput
- Burst concurrency

The system should be load-tested with realistic combinations of:

- Cache hits
- Cache misses
- Fast websites
- Slow websites
- Failed websites
- Large HTML responses
- Duplicate URLs
- 500-request bursts

The results of these tests should determine worker concurrency, autoscaling
thresholds and infrastructure capacity.

### 8.9 Scaling Summary

The PagePulse scaling model is:

API traffic
→ Horizontally scaled stateless API instances

Audit workload
→ Queue
→ Horizontally scaled workers with bounded concurrency

Shared temporary state
→ Redis

Durable application state
→ Persistent database

This architecture allows PagePulse to scale the component experiencing
pressure instead of scaling the entire system as one monolithic unit.

---

## 9. Caching Strategy

Caching is an important part of the PagePulse architecture because auditing a
URL requires an external network request followed by HTML parsing and analysis.

Repeatedly auditing the same unchanged URL wastes network bandwidth, worker
capacity and processing time.

The scaled PagePulse architecture therefore uses Redis as a shared distributed
cache.

### 9.1 Cache Key

Before checking the cache, PagePulse normalizes the submitted URL.

A cache key can then be generated from the normalized URL.

For example:

pagepulse:audit:https://example.com/

Using normalized URLs prevents logically identical URLs from creating
unnecessary duplicate cache entries.

### 9.2 Configurable TTL

Every cached audit result should have a configurable Time To Live (TTL).

For example:

CACHE_TTL_SECONDS=300

A value of 300 seconds means that a successful audit can be reused for five
minutes before PagePulse considers it stale.

The TTL should remain configurable because different deployment environments
may require different freshness requirements.

### 9.3 Cache-Hit Flow

When PagePulse receives an audit request:

1. Validate and normalize the URL.
2. Generate the cache key.
3. Check Redis for an existing audit result.
4. If a non-expired result exists, return it immediately.
5. Mark the API response as cached.
6. Do not create a new audit job.

This provides the fastest response path through PagePulse.

### 9.4 Cache-Miss Flow

If Redis does not contain a valid result:

1. PagePulse checks whether the same URL is already being audited.
2. If not, a new audit job is created.
3. The job is placed into the queue.
4. A worker processes the audit.
5. The completed result is stored in the persistent database.
6. The result is also stored in Redis with the configured TTL.
7. Future requests can reuse the cached result.

### 9.5 Cache Stampede Protection

A popular URL may receive many requests immediately after its cache entry
expires.

Without protection, all of those requests could create separate audit jobs for
the same URL.

PagePulse should use a short-lived distributed lock or deduplication key in
Redis.

For example:

pagepulse:lock:https://example.com/

The first request obtains the lock and creates the audit job.

Other requests for the same URL detect that an audit is already in progress
and reuse or wait for the result rather than creating duplicate work.

This prevents a cache stampede.

### 9.6 What Should Be Cached

Successful audit results are the primary cache candidates.

The cache can contain:

- HTTP status information
- Final URL after redirects
- Page title
- Meta description
- Heading analysis
- Link analysis
- Image analysis
- Page metadata
- Completed PagePulse audit result

The cached object should contain enough information to return the same API
contract without running the audit again.

### 9.7 Handling Failed Audits

Failures should be cached carefully.

Long-term caching of temporary failures could incorrectly make a recovered
website appear unavailable.

PagePulse can either avoid caching transient failures entirely or use a much
shorter TTL for selected failures.

For example, a temporary upstream timeout should not be cached for the same
duration as a successful audit.

Security-related rejections can be handled separately because retrying the same
blocked target should not consume expensive worker capacity.

### 9.8 Cache Invalidation

The primary invalidation mechanism is TTL expiration.

PagePulse may also support explicit invalidation in the future if customers
need to force a fresh audit.

For example, an authenticated request could include a controlled refresh
option that bypasses the existing cached result.

Such functionality should still be rate-limited to prevent abuse.

### 9.9 Cache Capacity and Eviction

Redis memory is finite, so PagePulse should define an appropriate eviction
policy.

The system should monitor:

- Redis memory utilization
- Number of cached audit results
- Cache hit ratio
- Cache miss ratio
- Eviction count
- Redis command latency

If cache hit ratio decreases unexpectedly or eviction rates increase,
additional Redis capacity or a different TTL strategy may be required.

### 9.10 Distributed Cache Requirement

The current small-scale PagePulse implementation can use process-local caching,
but that approach is insufficient once multiple API and worker instances are
running.

For example:

API Instance A may cache an audit result.

A later request may reach API Instance B.

If each instance maintains an independent memory cache, Instance B will not
know that Instance A already has the result.

Using Redis provides one shared cache that every PagePulse API instance and
worker can access.

### 9.11 Caching Benefits

The caching strategy provides:

- Faster responses for repeated audits
- Reduced outbound website requests
- Lower worker utilization
- Reduced queue pressure
- Better handling of traffic bursts
- Lower infrastructure cost
- More predictable response latency

Caching therefore improves both PagePulse performance and system resilience.

---

## 10. Rate Limiting and Abuse Protection

PagePulse performs outbound requests to third-party websites, which makes each
audit more expensive than a typical API request.

Without rate limiting, a single client could generate enough audit requests to
consume worker capacity, increase queue latency, and negatively affect other
customers.

The scaled architecture therefore applies distributed per-client rate limiting
before expensive audit work begins.

### 10.1 Per-Client Rate Limiting

Each client should have a defined request limit within a configurable time
window.

Depending on the authentication model, a client can be identified using:

- API key
- Authenticated customer ID
- Account ID
- IP address as a fallback for unauthenticated traffic

Authenticated identifiers are preferred because many legitimate users may
share the same public IP address.

### 10.2 Distributed Rate Limiting

At small scale, PagePulse can maintain rate-limit counters in application
memory.

This is not sufficient when multiple API instances are running.

For example:

1. Client sends requests to API Instance A.
2. The load balancer sends later requests to API Instance B.
3. If each instance has its own counter, the client can effectively receive a
   separate limit from every API instance.

The scaled architecture therefore stores rate-limit counters in Redis.

All API instances use the same distributed counters, producing consistent
limits regardless of which instance handles the request.

### 10.3 Request Processing Order

Rate limiting should occur before expensive audit processing.

A simplified request flow is:

Client Request
→ Request ID
→ Basic Validation
→ Client Identification
→ Rate Limit Check
→ URL Security Validation
→ Cache / Deduplication Check
→ Queue

This prevents clients that have exceeded their limit from consuming audit
worker capacity.

### 10.4 Rate-Limit Response

When a client exceeds its configured limit, PagePulse should return:

HTTP 429 Too Many Requests

The response should follow the same structured error format used throughout
the API.

For example:

{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many audit requests. Please retry later."
  },
  "requestId": "req_12345"
}

Where appropriate, the response should also provide retry information through
standard HTTP headers.

### 10.5 Different Limits for Different Operations

Not every PagePulse endpoint has the same resource cost.

For example:

- Health checks are inexpensive.
- Job-status lookups are relatively inexpensive.
- Cached audit requests are inexpensive compared with fresh audits.
- New audit requests can trigger network and worker processing.

Therefore, PagePulse can apply different rate-limit policies based on endpoint
cost instead of treating every request identically.

### 10.6 Queue-Level Protection

Per-client rate limiting protects PagePulse from individual abusive clients,
but it does not fully protect the service from aggregate overload.

The system should also monitor overall queue capacity.

If the queue reaches a defined safety threshold, PagePulse can temporarily
reject additional audit jobs with:

HTTP 503 Service Unavailable

This is controlled load shedding.

It is preferable to reject some new work explicitly rather than accept
unlimited jobs and allow the entire system to become unstable.

### 10.7 Duplicate Audit Protection

A client may repeatedly request the same URL.

After rate limiting and cache lookup, PagePulse should check whether an audit
for the normalized URL is already queued or processing.

If one exists, the service should reuse that work rather than creating another
identical audit job.

This protects both PagePulse infrastructure and external target websites from
unnecessary requests.

### 10.8 Outbound Request Protection

Abuse protection must also apply to the websites PagePulse fetches.

Audit workers should enforce:

- HTTP and HTTPS protocols only
- SSRF protection
- Blocking of private and internal network targets
- DNS/IP validation
- Redirect validation
- Request timeouts
- Maximum redirect limits
- Maximum response-size limits
- Bounded worker concurrency

These controls prevent PagePulse from being used as an unrestricted network
proxy or from consuming unlimited resources on malicious targets.

### 10.9 Retry Protection

Failed jobs should not be retried indefinitely.

Only failures that are likely to be temporary should be eligible for retry.

Retries should use:

- A small maximum retry count
- Exponential backoff
- Jitter where appropriate
- A dead-letter queue after repeated failure

Permanent failures such as invalid URLs or security-policy violations should
not be retried.

### 10.10 Monitoring Abuse

PagePulse should monitor:

- Requests per client
- Rate-limit rejection count
- HTTP 429 rate
- HTTP 503 rate
- Queue depth
- Duplicate audit frequency
- Requests to blocked network ranges
- Audit timeout rate
- Failed-job rate

Unexpected increases in these metrics can indicate abuse, misconfigured
clients, or capacity problems.

### 10.11 Protection Layers

The final protection model uses multiple layers:

1. Input validation
2. Client identification
3. Per-client distributed rate limiting
4. URL and SSRF security validation
5. Cache reuse
6. Duplicate-job prevention
7. Queue capacity limits
8. Bounded worker concurrency
9. External request timeouts and size limits
10. Controlled retries and dead-letter handling

No single control is responsible for protecting the entire service.

Using multiple layers allows PagePulse to remain available even when individual
clients or external websites behave unexpectedly.

---

## 11. Failure and Retry Strategy

At production scale, failures are expected rather than exceptional.

PagePulse depends on external websites, DNS resolution, network connectivity,
Redis, the job queue, workers, and persistent storage. Any of these components
can temporarily fail.

The architecture therefore needs to distinguish between transient failures,
permanent failures, and internal infrastructure failures so that each type is
handled appropriately.

### 11.1 Failure Classification

PagePulse should classify failures before deciding whether to retry them.

#### Transient Failures

Transient failures may succeed if attempted again.

Examples include:

- Temporary DNS resolution failures
- Connection resets
- HTTP 502 responses from target websites
- HTTP 503 responses from target websites
- Temporary network interruptions
- Short-lived infrastructure failures

These failures may be eligible for retry.

#### Permanent Failures

Permanent failures are unlikely to succeed when immediately retried.

Examples include:

- Invalid URLs
- Unsupported protocols
- SSRF/security-policy violations
- Requests targeting blocked private networks
- Malformed requests
- Consistent HTTP 404 responses
- Responses exceeding configured safety limits

These failures should normally fail immediately without retry.

### 11.2 Limited Retry Policy

PagePulse should never retry failed audits indefinitely.

A job should have a small configurable retry limit.

For example, the system could allow a maximum of three processing attempts for
eligible transient failures.

The exact retry count should be configurable and validated using production
data.

Limiting retries prevents one failing target website from continuously
consuming worker capacity.

### 11.3 Exponential Backoff

Retries should not happen immediately one after another.

PagePulse should use exponential backoff so the delay increases after each
failure.

A conceptual retry schedule could be:

Attempt 1 → Initial processing

Attempt 2 → Retry after a short delay

Attempt 3 → Retry after a longer delay

Adding a small amount of random jitter can prevent many failed jobs from
retrying at exactly the same time.

This is particularly important when a shared external dependency temporarily
fails.

### 11.4 Dead-Letter Queue

If a job continues to fail after reaching the configured retry limit, it should
be moved to a dead-letter queue (DLQ).

The DLQ contains jobs that require investigation rather than automatic repeated
processing.

A dead-letter record should retain useful context such as:

- Job ID
- Normalized URL
- Request ID
- Number of attempts
- Last failure reason
- Failure timestamp
- Relevant error code

This makes repeated failures observable without allowing them to block normal
audit processing.

### 11.5 Worker Crash Recovery

A worker may crash while processing an audit.

The queue should use job acknowledgement semantics so that a job is considered
successfully processed only after the worker completes the required work.

If a worker disappears before acknowledging completion, the job can become
available for another worker after an appropriate timeout.

Audit processing should therefore be designed to be idempotent wherever
possible.

Processing the same job again should not create corrupted or conflicting
results.

### 11.6 External Website Timeouts

A slow website must not occupy a worker indefinitely.

Every outbound request should use a configurable timeout.

When the timeout is reached:

1. The request is cancelled.
2. Resources are released.
3. The failure is classified.
4. A retry occurs only if the policy considers the failure transient.
5. The client eventually receives a structured timeout result if the audit
   cannot complete.

This protects worker capacity during slow or unresponsive target-site
conditions.

### 11.7 Redis Failure

Redis is important for caching, rate limiting and coordination.

If Redis becomes unavailable, PagePulse should avoid silently operating with
incorrect distributed state.

The exact degradation policy depends on the operation.

For example:

- Cache lookup failure may allow processing without the cache if safe.
- Distributed rate-limit failure may require a stricter fail-safe policy.
- Deduplication failure may increase duplicate work and should be monitored.
- Queue infrastructure failure should prevent accepting jobs that cannot be
  safely persisted.

Redis failures should generate high-priority operational alerts.

### 11.8 Database Failure

If the persistent database becomes unavailable, workers should not report an
audit as durably completed when the result could not be stored.

Depending on the failure, the worker can retry persistence separately or allow
the job to be retried.

Database failures should use bounded retries to avoid creating retry storms.

Persistent database errors should also trigger operational alerts.

### 11.9 Queue Failure

If PagePulse cannot safely enqueue a new audit job, the API should not pretend
that the audit was accepted.

Instead, it should return a structured service-unavailable response such as:

HTTP 503 Service Unavailable

The response should contain a request ID so the failure can be traced.

This is safer than acknowledging work that may never execute.

### 11.10 Graceful Shutdown

During deployments or autoscaling, workers should shut down gracefully.

A worker receiving a shutdown signal should:

1. Stop accepting new jobs.
2. Continue processing currently active jobs where possible.
3. Complete and acknowledge finished jobs.
4. Release connections and resources.
5. Exit only after active work has completed or a shutdown deadline is reached.

This reduces duplicate work and lost jobs during deployments.

### 11.11 Structured Error Responses

Failures exposed through the PagePulse API should follow a consistent structure.

For example:

{
  "success": false,
  "error": {
    "code": "AUDIT_TIMEOUT",
    "message": "The target website did not respond within the allowed time."
  },
  "requestId": "req_12345"
}

Internal implementation details, stack traces and sensitive infrastructure
information should not be exposed to clients.

Detailed diagnostic information should instead be recorded in structured
internal logs.

### 11.12 Retry Decision Summary

| Failure | Retry? | Reason |
|---|---|---|
| Temporary network failure | Yes, limited | May recover |
| Connection reset | Yes, limited | Often transient |
| Target HTTP 503 | Yes, limited | Service may recover |
| Request timeout | Limited / policy based | Could be temporary |
| Invalid URL | No | Retrying cannot fix input |
| SSRF/security rejection | No | Deliberately blocked |
| Unsupported protocol | No | Invalid request |
| Response too large | No | Violates safety limit |
| Worker crash | Requeue | Work may be incomplete |
| Queue unavailable | Do not accept job | Cannot guarantee processing |

### 11.13 Retry Principles

The PagePulse retry strategy follows five principles:

1. Retry only failures that may realistically recover.
2. Keep retry counts bounded.
3. Use exponential backoff instead of immediate retries.
4. Move repeatedly failing jobs to a dead-letter queue.
5. Make failures observable through structured logs, metrics and alerts.

The goal is to recover automatically from temporary problems without allowing
retries themselves to become a source of overload.

---

## 12. Security at Scale

PagePulse accepts URLs from users and then makes outbound requests to those
URLs. This creates a larger security surface than a typical REST API because
untrusted user input can influence network requests made by the server.

At scale, security controls must remain consistent across every API instance
and audit worker.

### 12.1 SSRF Protection

Server-Side Request Forgery (SSRF) is one of the most important risks for a
URL-audit service.

An attacker could attempt to make PagePulse access internal services instead
of a legitimate public website.

PagePulse should therefore reject requests targeting:

- localhost
- loopback addresses
- private IPv4 ranges
- private IPv6 ranges
- link-local addresses
- cloud metadata endpoints
- internal hostnames
- other non-public network destinations

Only HTTP and HTTPS URLs should be accepted.

### 12.2 DNS Resolution Validation

Checking only the hostname string is not sufficient.

A hostname may resolve to a private or internal IP address.

Before connecting to a target, PagePulse should resolve the hostname and
validate the resulting IP address against the blocked network ranges.

This validation should occur as close as possible to the actual network
connection.

### 12.3 Redirect Validation

A safe public URL can redirect to an unsafe destination.

For example:

Public URL
→ HTTP redirect
→ Internal/private IP address

Therefore, PagePulse must validate every redirect destination rather than
checking only the original URL.

The number of redirects should also be limited to prevent redirect loops and
unnecessary resource consumption.

### 12.4 DNS Rebinding Consideration

An attacker may attempt to exploit differences between the IP address checked
during validation and the address used when the connection is created.

The production implementation should minimize this time-of-check versus
time-of-use gap and ensure that the actual destination used for the outbound
connection remains permitted.

This is particularly important for services that automatically fetch
user-controlled URLs.

### 12.5 Request Timeouts

Every outbound request must have a strict configurable timeout.

A malicious or broken server should not be able to keep a PagePulse worker
occupied indefinitely.

Timeouts protect:

- Worker availability
- Network connections
- Memory
- Queue processing capacity
- Customer response times

When the timeout is reached, the request should be cancelled and resources
released.

### 12.6 Response-Size Limits

A target website may return an unexpectedly large response.

PagePulse should enforce a maximum response size and stop reading the response
when the configured limit is exceeded.

This protects workers from excessive:

- Memory consumption
- Parsing cost
- Network bandwidth usage

A response exceeding the allowed size should produce a structured error rather
than crashing the worker.

### 12.7 Content-Type Validation

PagePulse is designed primarily to analyze web pages.

Workers should inspect the response Content-Type before performing expensive
HTML parsing.

Unsupported content such as very large binary downloads should not be treated
as normal HTML audit input.

This reduces unnecessary processing and limits exposure to unexpected data.

### 12.8 Bounded Concurrency

Security and availability are closely related.

Even valid URLs can become a denial-of-service problem if PagePulse opens too
many outbound connections simultaneously.

Worker concurrency must therefore remain bounded.

The queue controls when work becomes available, while worker concurrency limits
control how much work executes simultaneously.

### 12.9 Rate Limiting

Distributed per-client rate limiting provides another protection layer.

It prevents one customer or abusive client from consuming an unreasonable
percentage of PagePulse capacity.

Rate-limit state should be shared through Redis so limits remain consistent
across all API instances.

### 12.10 Input Validation

All API input should be validated before it reaches expensive processing.

For an audit request, validation should include:

- Required URL field
- Correct data type
- Valid URL syntax
- Allowed protocol
- Request-body size limit

Malformed requests should return structured 4xx responses.

### 12.11 API Security Headers

The public PagePulse API should continue using appropriate HTTP security
headers.

These can include protections such as:

- Strict-Transport-Security
- X-Content-Type-Options
- Content-Security-Policy where appropriate
- Referrer-Policy
- Cross-Origin policies

HTTPS should be enforced for production traffic.

### 12.12 CORS Policy

CORS should be configured according to the clients that are expected to call
PagePulse.

A permissive wildcard configuration may be acceptable for a deliberately
public API, but an authenticated production product should generally restrict
browser origins to known applications where appropriate.

CORS should not be treated as an authentication or authorization mechanism.

### 12.13 Secrets Management

Production secrets must never be committed to the Git repository.

Examples include:

- Database credentials
- Redis credentials
- Queue credentials
- API keys
- Monitoring tokens

Secrets should be stored using the deployment platform's environment-variable
or secret-management system.

The repository should contain only safe examples such as `.env.example`.

### 12.14 Least Privilege

Each PagePulse component should receive only the permissions it requires.

For example:

- API instances should not receive unnecessary infrastructure permissions.
- Workers should receive only the credentials needed to process audit jobs.
- Database users should have appropriately restricted privileges.
- Monitoring integrations should use scoped credentials.

This reduces the impact if one component is compromised.

### 12.15 Dependency Security

PagePulse depends on third-party Node.js packages.

Dependencies should be monitored for known vulnerabilities and updated
regularly.

The CI pipeline can include dependency-security checks so serious known
vulnerabilities are detected before deployment.

Updates should still pass the normal automated test suite before reaching
production.

### 12.16 Logging Sensitive Information

Structured logging is necessary for observability, but logs must not become a
source of sensitive-data exposure.

PagePulse should avoid logging:

- Authentication tokens
- API keys
- Database credentials
- Redis credentials
- Authorization headers
- Sensitive request headers

URLs may also contain sensitive query parameters, so logging policies should
consider URL sanitization or redaction where appropriate.

### 12.17 Security Monitoring

PagePulse should monitor security-relevant events including:

- SSRF-blocked requests
- Requests targeting private IP ranges
- Repeated validation failures
- Rate-limit violations
- Unusual request volume per client
- Excessive redirect attempts
- Oversized response attempts
- Authentication failures if authentication is introduced

Large or sudden changes in these metrics can indicate abuse or an attempted
attack.

### 12.18 Defense in Depth

PagePulse should not depend on one security mechanism.

The security model uses multiple layers:

1. Request-body validation
2. URL syntax and protocol validation
3. DNS/IP validation
4. SSRF protection
5. Redirect revalidation
6. Distributed rate limiting
7. Queue backpressure
8. Bounded worker concurrency
9. Outbound request timeouts
10. Response-size limits
11. Secrets management
12. Least-privilege access
13. Dependency scanning
14. Security monitoring and structured logging

If one protection fails, additional controls still reduce the likelihood that
a malicious request can compromise the service or exhaust its resources.

This defense-in-depth approach is especially important for PagePulse because
the core product intentionally performs network requests to URLs supplied by
users.

---

## 13. Observability Architecture

At the target scale, PagePulse needs more than application logs to determine
whether the service is healthy.

A production observability strategy should combine metrics, structured logs
and distributed traces so that failures can be detected quickly and traced
across the API, queue and worker layers.

### 13.1 Observability Goals

The observability system should help answer four important questions:

1. Is PagePulse available?
2. Are customers receiving responses within the expected SLA?
3. Is the audit-processing pipeline keeping up with demand?
4. If something fails, where did the failure occur?

Observability data should be collected centrally so that engineers do not need
to inspect individual API or worker instances.

### 13.2 Structured Logging

PagePulse should produce machine-readable structured logs rather than relying
only on plain-text messages.

A typical log event can include:

- Timestamp
- Log level
- Request ID
- Job ID
- Client identifier where appropriate
- HTTP method
- Route
- Response status
- Response duration
- Audit duration
- Cache status
- Worker identifier
- Error code

Sensitive credentials and authentication information must never be included in
logs.

### 13.3 Request IDs

Every incoming API request should receive a unique request ID.

The request ID should be included in:

- API logs
- Structured error responses
- Queue-job metadata
- Worker logs
- Relevant database records

For example:

Client Request
→ Request ID: req_123
→ API Log
→ Audit Job
→ Worker Log
→ Audit Result

This makes it possible to follow one customer request across multiple
components.

### 13.4 Job IDs

Asynchronous audits should also receive a unique job ID.

The request ID identifies the original HTTP request, while the job ID identifies
the background audit operation.

Both identifiers should be retained when useful.

This is important because one audit job may continue processing after the
original HTTP request has already returned `202 Accepted`.

### 13.5 API Metrics

The API layer should expose or publish metrics such as:

- Requests per second
- Request count by endpoint
- HTTP 2xx rate
- HTTP 4xx rate
- HTTP 429 rate
- HTTP 5xx rate
- p50 response latency
- p95 response latency
- p99 response latency
- Active connections

These metrics show whether the customer-facing API is healthy.

### 13.6 Queue Metrics

The queue is one of the most important components in the scaled architecture.

PagePulse should monitor:

- Queue depth
- Number of active jobs
- Number of delayed jobs
- Number of failed jobs
- Oldest queued-job age
- Job enqueue rate
- Job completion rate
- Retry count
- Dead-letter queue size

Queue depth alone is not enough.

For example, a queue containing 100 jobs may be acceptable if workers process
them quickly.

The age of the oldest queued job gives a better indication of whether customers
are experiencing increasing delays.

### 13.7 Worker Metrics

Audit workers should publish metrics including:

- Active audits
- Worker concurrency utilization
- Audits completed per minute
- Average audit duration
- p95 audit duration
- Audit timeout rate
- Audit failure rate
- Retry rate
- CPU utilization
- Memory utilization

These measurements help determine whether additional workers are required.

### 13.8 Cache Metrics

Redis caching should be monitored using:

- Cache hit count
- Cache miss count
- Cache hit ratio
- Cache lookup latency
- Redis memory utilization
- Redis connection count
- Redis command latency
- Eviction count

A sudden reduction in cache hit ratio can significantly increase worker and
queue load.

### 13.9 Database Metrics

The persistent database should be monitored for:

- Query latency
- Connection utilization
- CPU utilization
- Storage utilization
- Error rate
- Slow queries

Database connection saturation can become a bottleneck when worker count
increases.

### 13.10 External Website Metrics

Because PagePulse depends heavily on external websites, the system should
distinguish target-site failures from internal PagePulse failures.

Useful metrics include:

- DNS failure rate
- Connection failure rate
- External HTTP 4xx rate
- External HTTP 5xx rate
- Target response-time distribution
- Audit timeout rate
- Redirect-limit failures
- Response-size-limit failures

This prevents a large number of broken target websites from being incorrectly
diagnosed as a PagePulse infrastructure outage.

### 13.11 Distributed Tracing

Distributed tracing becomes useful when one logical audit moves through
multiple components.

A trace can follow:

API Request
→ Redis Cache Lookup
→ Queue Submission
→ Worker Processing
→ External Website Fetch
→ Database Write
→ Redis Cache Update

Tracing makes it easier to identify which component contributed most to a slow
or failed audit.

### 13.12 Dashboards

PagePulse should maintain dashboards for both customer-facing health and
internal processing health.

A primary service dashboard should include:

- API request volume
- API p95 and p99 latency
- HTTP error rate
- Queue depth
- Oldest queued-job age
- Worker utilization
- Audit completion latency
- Cache hit ratio
- Redis health
- Database health

This provides a single operational view of the service.

### 13.13 Alerting Principles

Alerts should represent conditions that require action rather than every small
metric fluctuation.

Useful alert conditions include:

- Sustained API 5xx increase
- p95 API latency exceeding the SLA threshold
- Oldest queued-job age exceeding the allowed threshold
- Rapid queue growth
- Worker failure spike
- Audit timeout spike
- Redis unavailable
- Database unavailable
- Dead-letter queue growth
- Unusually high rate-limit activity

Alerts should require sustained threshold violations where appropriate to avoid
unnecessary noise from short-lived spikes.

### 13.14 Health and Readiness Checks

PagePulse should distinguish between liveness and readiness.

A liveness check answers:

"Is this process running?"

A readiness check answers:

"Is this instance currently able to serve traffic correctly?"

For example, an API process may still be alive while an essential dependency is
unavailable.

A load balancer should route traffic only to instances that are considered
ready.

### 13.15 Service-Level Indicators

Important Service-Level Indicators (SLIs) include:

- API availability
- API response latency
- Successful audit acknowledgement rate
- Audit completion rate
- Queue waiting time
- Audit processing time

These measurements provide the data needed to evaluate whether PagePulse is
meeting its customer-facing objectives.

### 13.16 Observability Flow

The overall observability flow is:

API Instances
→ Structured Logs
→ Metrics
→ Distributed Traces

Audit Workers
→ Structured Logs
→ Metrics
→ Distributed Traces

Queue / Redis / Database
→ Infrastructure Metrics

All Signals
→ Central Monitoring Platform
→ Dashboards
→ Alerts
→ Engineering Response

This gives PagePulse visibility across the complete audit lifecycle instead of
monitoring each component in isolation.

---

## 14. Deployment and Rollback Architecture

PagePulse should support frequent deployments without making the public API
unavailable or risking large numbers of audit jobs.

A production deployment process should combine automated CI checks, gradual
release, health verification, graceful worker shutdown and a fast rollback
mechanism.

### 14.1 Continuous Integration

Every change pushed to the repository should pass the CI pipeline before it is
eligible for production deployment.

The pipeline should verify:

- Dependency installation
- TypeScript compilation
- Automated tests
- Linting where configured
- Security checks where configured
- Build success

A failed CI pipeline should prevent the change from progressing to production.

This extends the same CI principle already used by the current PagePulse
GitHub Actions workflow.

### 14.2 Immutable Deployment Artifact

A production release should be built once and deployed as a versioned,
immutable artifact.

For example, a release can be identified using:

- Git commit SHA
- Release version
- Container image tag

The exact same tested artifact should move through the deployment process.

Production servers should not independently build different versions of the
application from changing source code.

### 14.3 Rolling Deployment

PagePulse API instances can be updated gradually.

Instead of stopping every running API instance at once:

1. Start instances containing the new version.
2. Run health and readiness checks.
3. Send a small amount of traffic to the new instances.
4. Confirm that the instances remain healthy.
5. Gradually move additional traffic to the new version.
6. Remove old instances only after the new release is stable.

This reduces downtime and limits the impact of a defective deployment.

### 14.4 Worker Deployment

Audit workers require additional care because they may be processing jobs
during deployment.

When a worker receives a shutdown signal, it should:

1. Stop accepting new jobs.
2. Continue processing active jobs.
3. Complete and acknowledge successfully finished jobs.
4. Release Redis, queue and database connections.
5. Exit after active work finishes or a defined shutdown deadline is reached.

If a worker cannot finish a job safely, the queue should make that job
available for another worker.

This prevents deployments from silently losing accepted audit work.

### 14.5 Readiness Checks

A newly deployed instance should not receive production traffic immediately.

It should first pass a readiness check.

The readiness check should verify that the application is capable of serving
its expected workload.

Depending on the component, this can include checking:

- Application startup
- Required configuration
- Redis connectivity
- Queue connectivity
- Database connectivity

Only ready API instances should receive traffic from the load balancer.

### 14.6 Canary Deployment

For higher-risk releases, PagePulse can use a canary deployment.

A small percentage of production traffic is initially routed to the new
version.

For example:

Existing Version → majority of traffic

New Version → small percentage of traffic

During the canary period, PagePulse compares important metrics such as:

- HTTP 5xx rate
- API p95 latency
- Audit failure rate
- Queue growth
- Worker error rate
- CPU and memory usage

If the new version remains healthy, traffic can gradually increase.

If the metrics regress, the rollout can stop before the majority of customers
are affected.

### 14.7 Rollback Triggers

Rollback should be based on predefined signals rather than waiting for an
engineer to notice that something feels wrong.

Possible rollback triggers include:

- Significant increase in HTTP 5xx responses
- Sustained API latency above the accepted threshold
- New audit failure spike
- Worker crash loop
- Unexpected queue growth
- Readiness-check failures
- Database error spike
- Redis or queue integration failures caused by the release

Thresholds should be based on normal production behavior and validated through
monitoring data.

### 14.8 Rollback Procedure

If a deployment is determined to be unhealthy:

1. Stop increasing traffic to the new version.
2. Route new requests back to the last known-good version.
3. Stop unhealthy new workers from consuming additional jobs.
4. Restore worker processing using the previous stable version.
5. Confirm API and worker health.
6. Monitor queue recovery and error rates.
7. Preserve logs, traces and deployment information for investigation.
8. Fix the issue in a new change rather than modifying production manually.

Because the previous artifact remains available, rollback should not require
rebuilding the old version.

### 14.9 Database Migration Safety

Database changes require special handling because application rollback alone
may not reverse an incompatible schema migration.

PagePulse should prefer backward-compatible database migrations.

A safe pattern is:

1. Add the new schema without removing the old schema.
2. Deploy application code capable of working safely during the transition.
3. Migrate or backfill data if required.
4. Verify the new version in production.
5. Remove obsolete schema only in a later release.

This is commonly described as an expand-and-contract migration strategy.

It reduces the risk that rolling back application code becomes impossible
because the database schema has already changed incompatibly.

### 14.10 Queue Compatibility

New worker versions must remain compatible with jobs that were created by the
previous API version.

Queue messages should therefore use a stable, versioned job schema where
appropriate.

Breaking changes to job payloads should be introduced gradually.

This prevents a deployment from leaving older queued jobs unreadable by newly
deployed workers.

### 14.11 Configuration Changes

Application code is not the only source of deployment failures.

Changes to:

- Environment variables
- Timeout values
- Worker concurrency
- Cache TTL
- Rate limits
- Queue configuration

can also affect production behavior.

Configuration changes should therefore be reviewed, versioned where possible
and included in deployment verification.

### 14.12 Post-Deployment Verification

After every deployment, PagePulse should verify:

- Health and readiness endpoints
- API error rate
- API response latency
- Queue depth
- Oldest queued-job age
- Worker processing rate
- Audit failure rate
- Cache behavior
- Redis health
- Database health

The deployment should not be considered successful simply because the
application process started.

### 14.13 Deployment Audit Trail

Every production deployment should record:

- Release version
- Git commit
- Deployment timestamp
- Person or automation that initiated the deployment
- Previous version
- Deployment result
- Rollback information if applicable

This makes production changes traceable during incident investigation.

### 14.14 Deployment Flow

The proposed PagePulse deployment flow is:

Developer Push
→ GitHub Repository
→ CI Tests and Build
→ Versioned Deployment Artifact
→ Deploy New Instances
→ Readiness Checks
→ Canary / Gradual Traffic
→ Monitor Metrics
→ Full Release

If unhealthy:

Monitoring Alert
→ Stop Rollout
→ Route Traffic to Previous Version
→ Restore Previous Workers
→ Verify Recovery
→ Investigate Using Logs and Traces

### 14.15 Deployment Principle

The goal is not to make production failures impossible.

The goal is to make changes small, observable and reversible.

PagePulse should always maintain a known-good release that can be restored
quickly if a new deployment causes customer-facing problems.

---

## 15. Capacity and Performance Validation

The proposed architecture should not be considered production-ready based only
on theoretical capacity.

Before committing to a customer-facing SLA, PagePulse should validate the
system through realistic load, stress and failure testing.

The goal is to prove that the architecture can sustain normal traffic while
also absorbing the required bursts of up to 500 concurrent requests.

### 15.1 Load-Testing Objectives

Performance testing should answer the following questions:

- Can the API accept the expected request volume while remaining responsive?
- Can the system absorb a burst of 500 concurrent audit requests?
- Does the queue provide effective backpressure?
- How quickly can workers drain the queue after a burst?
- At what point does worker capacity become saturated?
- Does Redis remain responsive under increased cache and rate-limit traffic?
- Does the database remain healthy as worker count increases?
- Are the proposed API latency objectives realistic?
- Does the system recover correctly after overload?

The results should be used to tune infrastructure and configuration rather
than relying on assumptions.

### 15.2 Test Scenarios

PagePulse should be tested using several traffic patterns.

#### Scenario A — Normal Sustained Traffic

Generate traffic representing the expected normal daily workload.

Measure:

- API latency
- Audit completion time
- Queue depth
- Worker utilization
- Cache hit ratio
- Error rate

This establishes the normal performance baseline.

#### Scenario B — 500 Concurrent Request Burst

Send approximately 500 audit requests within a short period.

The test should include both cache hits and cache misses.

Verify that:

- API instances remain responsive
- Requests are rate-limited correctly where applicable
- Cache hits return quickly
- Cache misses enter the queue
- Worker concurrency remains bounded
- Queue depth increases temporarily rather than crashing workers
- Additional worker capacity can be added
- The queue eventually returns to normal

This scenario directly validates the burst requirement for PagePulse.

#### Scenario C — Slow Target Websites

Use controlled test targets that respond slowly.

Verify that:

- Outbound request timeouts work
- Slow websites do not block all worker capacity
- Queue waiting time remains observable
- Failed or timed-out jobs release resources correctly

#### Scenario D — Failing Target Websites

Simulate DNS failures, connection failures and HTTP 5xx responses.

Verify that:

- Failures are classified correctly
- Only eligible failures are retried
- Retry counts remain bounded
- Exponential backoff works
- Repeated failures eventually reach the dead-letter queue

#### Scenario E — Duplicate URLs

Send many simultaneous requests for the same URL.

Verify that:

- Cache reuse works
- Distributed deduplication works
- Duplicate audit jobs are not unnecessarily created
- External websites are not fetched repeatedly for identical work

#### Scenario F — Large Responses

Use controlled pages that return large HTML responses.

Verify that:

- Response-size limits are enforced
- Worker memory remains within safe limits
- Oversized responses produce structured failures
- Workers remain healthy after rejecting the response

### 15.3 Key Performance Measurements

Each test should collect:

- Requests per second
- p50 API latency
- p95 API latency
- p99 API latency
- HTTP error rate
- HTTP 429 rate
- HTTP 503 rate
- Queue depth
- Oldest queued-job age
- Job enqueue rate
- Job completion rate
- Average audit duration
- p95 audit duration
- Worker CPU utilization
- Worker memory utilization
- Cache hit ratio
- Redis latency
- Database query latency
- Retry rate
- Dead-letter queue size

These measurements show both customer-facing performance and internal system
pressure.

### 15.4 Validate the Proposed SLA

Earlier in this architecture, initial engineering objectives were proposed for
cached responses and new-audit acknowledgements.

Those values should not become contractual guarantees until they have been
validated under realistic load.

For example, PagePulse should confirm that its target p95 acknowledgement
latency can still be achieved while:

- Hundreds of jobs are queued
- Workers are highly utilized
- Redis is under load
- Some target websites are slow
- Some audits are retrying

If the objective cannot be maintained reliably, PagePulse should either
increase capacity, optimize the system or revise the objective before making a
customer commitment.

### 15.5 Stress Testing

Load testing determines whether PagePulse handles expected traffic.

Stress testing determines what happens beyond expected traffic.

The system should gradually increase traffic beyond the 500-request burst until
a bottleneck is identified.

The objective is not to guarantee unlimited capacity.

The objective is to confirm that when capacity is exceeded:

- The API does not crash
- Queue growth is visible
- Load shedding activates
- Clients receive structured errors
- Existing jobs continue processing
- The system recovers after traffic decreases

Graceful degradation is preferable to uncontrolled failure.

### 15.6 Soak Testing

PagePulse should also run sustained tests over a longer period.

A short benchmark may not reveal:

- Memory leaks
- Connection leaks
- Gradual queue growth
- Redis memory pressure
- Database connection exhaustion
- Worker degradation

A soak test can run representative traffic for several hours while monitoring
resource usage and latency trends.

### 15.7 Failure Injection

Performance testing should include controlled dependency failures.

Examples include:

- Temporarily making Redis unavailable
- Temporarily making the database unavailable
- Restarting a worker during an active audit
- Restarting an API instance during traffic
- Simulating queue connectivity failure

The expected behavior should match the failure and retry strategy defined in
this architecture.

### 15.8 Capacity Model

The number of workers required depends primarily on audit duration and desired
queue-drain time.

A simple conceptual model is:

Required processing capacity
=
Incoming audit rate × Average audit duration

However, real capacity planning must also account for:

- Peak rather than average traffic
- Slow target websites
- Retry traffic
- Cache hit ratio
- Duplicate-request rate
- Worker concurrency
- CPU and memory limits

Therefore, worker counts should be derived from measured load-test results.

### 15.9 Performance Regression Testing

Important performance tests should be repeated after significant architectural
or audit-engine changes.

A release should be investigated if it causes meaningful regression in:

- API latency
- Audit processing time
- Memory consumption
- Queue-drain speed
- Cache effectiveness
- Error rate

This prevents gradual performance degradation across releases.

### 15.10 Success Criteria

The scaled PagePulse architecture can be considered validated when testing
demonstrates that:

1. The API remains responsive during a 500-request burst.
2. Expensive audit concurrency remains bounded.
3. Excess work is safely buffered by the queue.
4. Cache hits continue to provide a fast response path.
5. Queue waiting time remains within the defined service objective.
6. Workers can scale to drain burst traffic.
7. Failures and retries do not create uncontrolled load.
8. Redis and database dependencies remain within safe capacity.
9. Overload produces controlled degradation instead of system-wide failure.
10. The system returns to normal operation after the burst ends.

The final production capacity and SLA should be based on these measured results
rather than theoretical estimates alone.

---

## 16. Architecture Summary and Key Design Decisions

The scaled PagePulse architecture is designed around one central idea:
accepting an audit request and executing an audit should not have to happen
inside the same synchronous HTTP request.

The current PagePulse implementation is appropriate for the initial production
task, but supporting 10,000 audits per day and bursts of 500 concurrent
requests requires stronger isolation between customer-facing API traffic and
resource-intensive audit processing.

### 16.1 Final Architecture

The proposed production flow is:

Client
→ Load Balancer / API Gateway
→ Stateless PagePulse API
→ Validation and Rate Limiting
→ Redis Cache Check
→ Duplicate Audit Check
→ Audit Job Queue
→ Bounded Audit Workers
→ Target Website
→ Persistent Database
→ Redis Cache
→ Client Result Retrieval

Observability surrounds the entire flow through centralized logs, metrics,
traces and alerts.

### 16.2 Key Design Decisions

The most important architectural decisions are:

1. Keep API instances stateless.
2. Move expensive audits to asynchronous workers.
3. Use a queue to provide backpressure.
4. Use bounded worker concurrency.
5. Use Redis for shared caching and distributed coordination.
6. Store durable audit information in a persistent database.
7. Deduplicate concurrent audits of the same normalized URL.
8. Apply distributed per-client rate limiting.
9. Enforce strict outbound-request security controls.
10. Separate API response-time objectives from external website processing.
11. Scale API instances and workers independently.
12. Use structured logs, metrics and distributed tracing.
13. Use bounded retries with exponential backoff.
14. Isolate repeatedly failing jobs in a dead-letter queue.
15. Use gradual deployments with fast rollback capability.
16. Validate capacity and SLA assumptions through load testing.

### 16.3 How the Design Handles 10,000 Audits per Day

The daily audit volume itself is manageable, but average traffic is not the
main architectural challenge.

The difficult case is uneven traffic where a large number of requests arrive
within a short period.

PagePulse handles sustained volume through horizontally scalable API instances
and workers.

Caching further reduces the number of audits that actually require external
website fetching.

The persistent queue allows short-term demand to exceed immediate worker
capacity without losing accepted work.

### 16.4 How the Design Handles 500 Concurrent Requests

A burst of 500 incoming requests does not create 500 uncontrolled audit
operations.

Instead:

1. Invalid requests are rejected.
2. Per-client rate limits are applied.
3. Existing cached results are returned.
4. Duplicate audits are consolidated.
5. Remaining audit jobs enter the queue.
6. Workers process jobs using bounded concurrency.
7. Worker capacity can scale according to queue pressure.
8. Extreme overload can trigger controlled load shedding.

This transforms uncontrolled concurrency into measurable and manageable queue
pressure.

### 16.5 How the Design Supports a Customer-Facing SLA

PagePulse cannot control how quickly an arbitrary external website responds.

Therefore, the architecture does not make the public API response-time SLA
depend entirely on external website performance.

Cached audits can return immediately.

New audits can be accepted asynchronously and return a job identifier quickly.

Clients can then retrieve audit status and results through a dedicated status
endpoint.

This allows PagePulse to provide predictable API responsiveness while still
supporting websites with unpredictable response times.

### 16.6 How the Design Handles Failure

The architecture assumes that failures will occur.

External websites may time out.

Workers may restart.

Redis or the database may temporarily become unavailable.

Deployments may introduce regressions.

The system therefore uses:

- Strict timeouts
- Failure classification
- Bounded retries
- Exponential backoff
- Dead-letter queues
- Durable job processing
- Graceful shutdown
- Centralized observability
- Readiness checks
- Controlled load shedding
- Fast rollback procedures

The objective is graceful degradation and recovery rather than assuming every
dependency will always be available.

### 16.7 Main Tradeoff

The largest tradeoff in this architecture is increased operational complexity.

The initial PagePulse service can run as a relatively simple Node.js
application.

The scaled architecture introduces additional components such as:

- Redis
- A job queue
- Multiple API instances
- Multiple workers
- Persistent storage
- Centralized monitoring

These components increase infrastructure and operational complexity.

However, this complexity is introduced for specific reasons: controlled
concurrency, horizontal scaling, shared state, resilience and predictable
customer-facing performance.

For the required scale and burst behavior, these benefits justify separating
the system into independently scalable components.

### 16.8 What I Would Implement First

I would not introduce every component at once.

I would evolve PagePulse incrementally:

Phase 1:
Keep the existing API, tests, CI, validation, caching, rate limiting and
production deployment.

Phase 2:
Replace process-local cache and distributed coordination state with Redis.

Phase 3:
Introduce the audit job queue and move audit execution into workers.

Phase 4:
Introduce persistent audit history and asynchronous job-status endpoints.

Phase 5:
Add autoscaling, deeper observability and production load testing.

Phase 6:
Tune worker concurrency, scaling thresholds and SLA targets using measured
production data.

This reduces migration risk and avoids unnecessary complexity before it is
needed.

### 16.9 Final Architecture Principle

The goal of the PagePulse architecture is not simply to process more requests.

The goal is to ensure that increased traffic does not cause uncontrolled
resource consumption or unpredictable customer behavior.

The design therefore prioritizes:

- Controlled concurrency
- Backpressure
- Shared state
- Failure isolation
- Security
- Observability
- Horizontal scalability
- Predictable API responsiveness
- Safe deployments

With these principles, PagePulse can evolve from the current production-ready
service into a system capable of supporting the required workload while
remaining maintainable and operationally understandable.