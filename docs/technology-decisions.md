# PagePulse — Technology Decision Record

## Task B: Design It for Scale

This document records the key technology decisions for evolving PagePulse
from the current production-ready REST API into a system capable of handling:

- 10,000+ audits per day
- Bursts of up to 500 concurrent requests
- A customer-facing response-time SLA
- Horizontal scaling
- Reliable asynchronous audit processing

The goal is not to select technologies only because they are popular.
Each choice is based on the requirements and operational characteristics of
PagePulse.

For every major decision, this document records:

1. The technology or approach selected
2. Why it fits PagePulse
3. The main tradeoffs
4. An alternative considered
5. Why that alternative was not selected

---

## 1. Decision Record Format

Each technology decision follows this structure:

### Decision

The technology or architectural approach selected for PagePulse.

### Context

The problem or requirement that requires a technical decision.

### Why This Choice

The reasons the selected technology fits the PagePulse workload and
architecture.

### Tradeoffs

The disadvantages, costs or operational complexity introduced by the choice.

### Alternative Considered

Another realistic technology or approach that could solve the same problem.

### Why the Alternative Was Not Selected

The reason the selected option is a better fit for the current PagePulse
requirements.

---

## Decision Summary

The major decisions covered in this document are:

| Area | Selected Approach |
|---|---|
| Runtime | Node.js + TypeScript |
| API framework | Express |
| Distributed cache | Redis |
| Job processing | Redis-backed job queue |
| Audit execution | Independent worker processes |
| Persistent storage | PostgreSQL |
| API architecture | Stateless horizontal API instances |
| Processing model | Asynchronous audits |
| Deployment | Containerized / horizontally scalable services |
| Observability | Structured logs, metrics and distributed tracing |

These choices are intended to evolve PagePulse incrementally rather than
requiring a complete rewrite of the existing application.

---

## 2. Runtime — Node.js + TypeScript

### Decision

Use Node.js with TypeScript as the application runtime and primary programming
language for the PagePulse API and audit workers.

### Context

PagePulse is primarily an I/O-intensive application.

A large part of an audit involves:

- Receiving HTTP requests
- Communicating with Redis
- Publishing and consuming queue jobs
- Fetching external websites
- Reading HTML responses
- Communicating with persistent storage
- Sending structured API responses

The scaled architecture also needs multiple API instances and background
workers while preserving the existing PagePulse implementation.

### Why This Choice

Node.js is a strong fit for PagePulse because its event-driven,
non-blocking I/O model works well for workloads involving many network
operations.

While one audit may spend significant time waiting for a target website to
respond, Node.js can continue handling other asynchronous operations instead
of blocking an operating-system thread for every request.

TypeScript adds static type checking on top of JavaScript.

For PagePulse, this is useful for defining and validating structures such as:

- Audit requests
- Audit results
- Queue job payloads
- API responses
- Error objects
- Configuration
- Database models
- Worker messages

TypeScript also improves maintainability as the codebase grows because many
interface mismatches can be detected during development and CI rather than
after deployment.

Another important reason for this choice is that the existing PagePulse
application is already implemented using Node.js and TypeScript.

Keeping the same runtime allows the system to evolve toward workers and
distributed infrastructure without requiring a complete application rewrite.

### Benefits

The main benefits are:

- Strong support for asynchronous network I/O
- Suitable for HTTP APIs and external website fetching
- Large ecosystem of production libraries
- Shared language between API and workers
- Type safety through TypeScript
- Existing PagePulse code can be reused
- Straightforward horizontal scaling using multiple processes or containers
- Good integration with Redis, queues, databases and observability tools

### Tradeoffs

Node.js is not ideal for every workload.

CPU-intensive operations executed directly on the main event loop can delay
other requests.

If PagePulse later introduces computationally expensive processing, such as
large-scale image analysis or CPU-heavy document processing, those operations
should not run directly inside the API event loop.

They could instead be moved to:

- Dedicated worker processes
- Worker threads
- Separate specialized services

The PagePulse architecture already separates audit execution from the public
API, which reduces this risk.

### Alternative Considered — Go

Go was considered as an alternative runtime for the scaled PagePulse service.

Go provides:

- Lightweight goroutines
- Strong concurrency support
- Good performance
- Static typing
- Efficient compiled binaries
- Predictable memory characteristics

It would be a reasonable technology for a high-concurrency URL-processing
service.

### Why Go Was Not Selected

Go was not selected because the expected PagePulse scale does not currently
justify rewriting the existing Node.js and TypeScript application.

The current application already has:

- Working API routes
- Validation
- Security controls
- Caching
- Rate limiting
- Automated tests
- CI
- Production deployment

Reimplementing these components in Go would introduce migration cost and new
implementation risk without solving a demonstrated bottleneck.

The more appropriate first step is to improve the architecture around the
existing application by introducing shared Redis state, queue-based processing
and independently scalable workers.

If future load testing demonstrates that Node.js itself becomes a measurable
bottleneck, individual performance-critical components could then be evaluated
for implementation in Go.

### Final Decision

Continue using Node.js + TypeScript for both the PagePulse API and audit
workers.

The decision prioritizes:

- Reuse of the existing production implementation
- Developer productivity
- Type safety
- Strong asynchronous I/O support
- Incremental scaling without unnecessary rewriting

The runtime should only be reconsidered if production measurements demonstrate
a limitation that cannot be solved effectively through horizontal scaling,
worker isolation or targeted optimization.

---

## 3. API Framework — Express

### Decision

Continue using Express as the HTTP framework for the PagePulse API.

### Context

The PagePulse API is responsible for the customer-facing HTTP layer.

Its responsibilities include:

- Receiving audit requests
- Request validation
- URL normalization
- Security checks
- Rate limiting
- Request ID generation
- Cache lookup
- Queue-job creation
- Returning audit status and results
- Health and readiness endpoints
- Structured error handling

The existing PagePulse application is already built using Express, so the
decision is whether Express remains appropriate as the system scales or whether
the API should be migrated to another Node.js framework.

### Why This Choice

Express is a good fit for PagePulse because the public API layer should remain
relatively lightweight.

In the scaled architecture, expensive audit processing is moved away from the
HTTP request lifecycle and into independent workers.

This means Express is primarily responsible for:

Client Request
→ Middleware
→ Validation
→ Cache / Queue Interaction
→ Response

rather than performing hundreds of expensive audits directly inside API
requests.

Express also has a mature middleware ecosystem that supports PagePulse
requirements such as:

- Security headers
- CORS
- Rate limiting
- Request logging
- JSON parsing
- Validation integration
- Centralized error handling

The existing PagePulse code already uses these patterns, so continuing with
Express allows the application to scale incrementally without rewriting the
entire API layer.

### Benefits

The main benefits of Express are:

- Mature and widely used ecosystem
- Simple routing model
- Flexible middleware architecture
- Strong TypeScript support through type definitions
- Easy integration with Redis
- Easy integration with job queues
- Easy integration with observability tools
- Existing PagePulse implementation can be reused
- Large amount of community knowledge and documentation

### Tradeoffs

Express provides relatively few architectural opinions.

This flexibility is useful, but it means the PagePulse codebase must maintain
clear conventions for:

- Routes
- Controllers
- Services
- Middleware
- Validation
- Error handling
- Configuration

Without these conventions, a larger Express application can become difficult
to maintain.

Express may also have lower raw HTTP benchmark performance than some newer
Node.js frameworks.

However, raw framework throughput is not expected to be the primary PagePulse
bottleneck.

External website response time, queue waiting time and audit processing are
more significant factors.

### Alternative Considered — Fastify

Fastify was considered as an alternative Node.js API framework.

Fastify provides:

- High HTTP throughput
- Low framework overhead
- Schema-based validation
- Built-in serialization capabilities
- Plugin-based architecture
- TypeScript support

Fastify could be a strong choice if PagePulse were being designed as a new
service from the beginning.

### Why Fastify Was Not Selected

Fastify was not selected because PagePulse already has a working and tested
Express implementation.

Migrating from Express to Fastify would require changes to areas such as:

- Route registration
- Middleware
- Error handling
- Request and response types
- Security integrations
- Rate limiting
- Tests

This migration would introduce engineering effort and regression risk without
addressing the main scaling challenge.

The primary scaling problem is not the Express router itself.

The larger concern is preventing hundreds of simultaneous audit requests from
creating hundreds of uncontrolled external website fetches.

That problem is better addressed through:

- Queue-based processing
- Worker isolation
- Bounded concurrency
- Redis caching
- Horizontal scaling

Therefore, changing the HTTP framework is not currently the highest-value
optimization.

### When I Would Reconsider Fastify

Fastify should be reconsidered if production measurements show that the API
framework itself has become a meaningful bottleneck.

For example, migration could be justified if:

- API CPU usage becomes excessive
- HTTP throughput becomes the limiting factor
- API latency remains high after expensive audit work has been removed
- Infrastructure cost could be materially reduced by improving HTTP-layer
  efficiency

The decision should be based on measured performance rather than framework
benchmarks alone.

### Final Decision

Continue using Express for the PagePulse API.

The scaled architecture removes expensive audit execution from the API layer,
allowing Express to remain focused on lightweight HTTP orchestration.

This provides the lowest-risk path from the current PagePulse implementation
to the proposed distributed architecture while preserving the option to
migrate later if production evidence justifies it.

---

## 4. Distributed Cache — Redis

### Decision

Use Redis as the distributed caching and short-lived coordination layer for
the scaled PagePulse architecture.

### Context

The current PagePulse implementation can use an in-memory cache because the
application runs as a small number of processes.

At larger scale, PagePulse will run multiple API instances and multiple audit
workers.

Process-local memory is no longer sufficient because each application instance
would maintain its own independent cache.

For example:

1. API Instance A audits `https://example.com`.
2. Instance A stores the result in its local memory.
3. A later request for the same URL reaches API Instance B.
4. Instance B does not have Instance A's cached result.
5. PagePulse unnecessarily performs the audit again.

The scaled architecture therefore requires a shared cache that can be accessed
by every API instance and worker.

### Why This Choice

Redis is well suited to PagePulse because it provides fast access to
short-lived shared data.

PagePulse can use Redis for:

- Audit-result caching
- Distributed rate-limit counters
- URL deduplication keys
- Distributed locks
- Temporary audit-job status
- Short-lived coordination between API instances and workers

Redis also supports expiration directly through TTL values.

For example, an audit result can be stored with a configurable expiration:

`CACHE_TTL_SECONDS=300`

After the TTL expires, Redis automatically treats the cached value as expired.

This fits the existing PagePulse requirement for configurable caching while
allowing the cache to work consistently across horizontally scaled instances.

### Benefits

The main benefits of Redis are:

- Very low-latency reads and writes
- Shared state across API instances
- Native TTL support
- Atomic operations
- Useful data structures
- Strong support for rate limiting
- Useful primitives for deduplication and coordination
- Mature Node.js client libraries
- Widely available as a managed cloud service
- Can support queue-related infrastructure depending on the queue library

### Distributed Rate Limiting

Redis also solves an important problem with horizontal scaling.

If rate-limit counters exist only in application memory, every API instance
maintains a different counter.

A client could therefore receive more requests simply because the load
balancer distributes traffic across multiple servers.

With Redis:

Client
→ API Instance A ─┐
                  ├→ Shared Redis Rate-Limit Counter
Client
→ API Instance B ─┘

Both API instances observe the same client limit.

This keeps rate limiting consistent across the deployment.

### Cache Stampede Protection

Redis can also help prevent multiple workers from auditing the same URL at the
same time.

Suppose a popular cache entry expires and 100 requests for the same URL arrive
simultaneously.

Without coordination, PagePulse might create 100 identical audit jobs.

Instead, PagePulse can create a short-lived deduplication or lock key such as:

`pagepulse:audit-lock:<normalized-url-hash>`

The first request creates the audit job.

Other requests detect that the same audit is already in progress and reuse the
existing job rather than creating duplicate work.

This reduces:

- External network requests
- Queue size
- Worker utilization
- Processing cost

### Redis Is Not the Durable Database

Redis should not be treated as the permanent source of truth for important
PagePulse data.

Cached audit results may expire or be evicted.

Durable information such as audit history should therefore be stored in the
persistent database.

The responsibilities are intentionally separated:

Redis
→ Fast, temporary, shared operational state

Persistent Database
→ Durable application records

### Tradeoffs

Introducing Redis adds another infrastructure dependency.

PagePulse now needs to consider:

- Redis availability
- Redis memory capacity
- Connection management
- Authentication
- Network latency
- Eviction policy
- Backup requirements where appropriate
- Monitoring

If Redis becomes unavailable, features such as caching, distributed rate
limiting and deduplication may be affected.

The application therefore needs explicit behavior for Redis failures instead
of assuming Redis will always be available.

### Alternative Considered — Process-Local In-Memory Cache

The main alternative considered is continuing to use the existing
process-local in-memory cache.

This approach has several advantages:

- Very simple
- No additional infrastructure
- Extremely fast access
- No network call
- Easy to develop locally

For a single application instance, this can be completely reasonable.

### Why the Alternative Was Not Selected

Process-local caching does not work reliably as shared state once PagePulse
scales horizontally.

Consider three API instances:

API A → Cache A

API B → Cache B

API C → Cache C

Each cache contains different information.

This creates several problems:

- Lower cache hit ratio
- Duplicate audits
- Inconsistent rate limiting
- No distributed deduplication
- Lost cache state when an instance restarts
- Increasing inconsistency as more instances are added

The architecture requirement is specifically to allow PagePulse instances to
scale horizontally.

A shared Redis layer therefore provides significantly better behavior than
independent process-local caches.

### Alternative Considered — Memcached

Memcached was also considered as a distributed caching option.

Memcached provides:

- Fast distributed caching
- Simple key-value storage
- TTL-based expiration
- Mature implementations

It would be suitable if PagePulse required only basic distributed caching.

### Why Memcached Was Not Selected

PagePulse needs more than simple cache storage.

Redis can also support:

- Atomic counters for rate limiting
- Distributed coordination
- Deduplication keys
- Locks
- Temporary job state
- Richer data structures

Using Redis allows one shared operational data platform to support several
PagePulse requirements.

This reduces the need to introduce separate infrastructure for each of these
functions.

### Final Decision

Use Redis as the distributed cache and short-lived shared-state layer for
PagePulse.

The decision provides a clear migration path:

Current architecture:

Process-local cache

↓

Scaled architecture:

Shared Redis cache

This allows multiple API instances and workers to share cached audit results,
rate-limit counters and coordination state while keeping the application layer
stateless.

Durable audit information remains in the persistent database rather than
depending on Redis for permanent storage.

---

## 5. Job Queue — BullMQ + Redis

### Decision

Use BullMQ with Redis as the job-queue system for asynchronous PagePulse audit
processing.

### Context

The current PagePulse implementation can execute an audit directly during the
HTTP request lifecycle.

At the target scale, PagePulse must support:

- 10,000+ audits per day
- Bursts of up to 500 concurrent requests
- Predictable customer-facing API response times
- Controlled audit concurrency
- Retry handling
- Horizontal worker scaling

Allowing every incoming request to immediately start an external website fetch
would make traffic bursts difficult to control.

The scaled architecture therefore needs a queue between the API layer and the
audit workers.

### Why This Choice

BullMQ is a Node.js job-queue library built on Redis.

It fits PagePulse well because the application already uses Node.js and
TypeScript, and Redis is already proposed for caching, distributed rate
limiting and coordination.

The request flow becomes:

Client
→ PagePulse API
→ Validation
→ Cache Check
→ BullMQ Queue
→ Audit Worker
→ Target Website
→ Result Storage

Instead of performing the audit directly, the API creates a job and places it
onto the queue.

An available worker then processes that job according to configured
concurrency limits.

### Backpressure

One of the main reasons for introducing BullMQ is backpressure.

Suppose 500 audit requests arrive within a short period.

Without a queue:

500 requests
→ potentially 500 immediate audit operations

With a queue:

500 requests
→ accepted jobs
→ queue
→ controlled number of workers
→ bounded audit concurrency

The queue absorbs the temporary difference between incoming demand and
available processing capacity.

This prevents traffic bursts from immediately exhausting worker resources.

### Worker Concurrency

BullMQ workers can process jobs using a configured concurrency limit.

For example, PagePulse can allow each worker to process only a bounded number
of audits simultaneously.

If more processing capacity is required, additional worker instances can be
started.

This creates two levels of control:

1. Concurrency limit inside each worker
2. Number of worker instances

The exact values should be determined through load testing rather than hard
coded based only on assumptions.

### Independent Worker Scaling

Using a queue separates the API layer from audit execution.

API instances can scale based on HTTP traffic.

Audit workers can scale based on:

- Queue depth
- Oldest queued-job age
- Worker utilization
- Audit completion rate

This is more efficient than scaling the entire PagePulse application whenever
audit-processing demand increases.

### Retry Support

BullMQ supports retry behavior for failed jobs.

PagePulse can configure eligible transient failures to retry using a limited
number of attempts.

For example:

Attempt 1
→ failure

Delay
→ Attempt 2

Longer delay
→ Attempt 3

Retries should use exponential backoff and remain bounded.

Permanent failures such as invalid URLs or SSRF security violations should not
be retried.

### Failed Jobs

Jobs that continue to fail after the configured retry limit should be retained
or moved into a failed-job/dead-letter handling workflow.

PagePulse should preserve useful information such as:

- Job ID
- Request ID
- URL
- Attempt count
- Failure code
- Failure timestamp

This allows repeated failures to be investigated without continuously
reprocessing them.

### Job Deduplication

PagePulse may receive multiple requests for the same normalized URL.

Before creating a new audit job, Redis can be used to determine whether the
same audit is already:

- queued
- processing
- recently completed

Where appropriate, BullMQ job identifiers can also be derived from a stable
representation of the normalized URL.

This reduces duplicate audit processing during traffic bursts.

### Job Payload

Queue messages should remain small.

A PagePulse audit job could contain information such as:

{
  "jobId": "audit_12345",
  "requestId": "req_67890",
  "url": "https://example.com/"
}

Large audit results should not be passed repeatedly through the queue if they
can instead be stored in Redis or the persistent database.

### Job Schema Versioning

As PagePulse evolves, the structure of audit jobs may change.

The queue payload can therefore include a schema version where necessary.

For example:

{
  "version": 1,
  "jobId": "audit_12345",
  "requestId": "req_67890",
  "url": "https://example.com/"
}

This helps maintain compatibility during rolling deployments where old and new
worker versions may temporarily exist at the same time.

### Redis Reuse

Another advantage of BullMQ is that PagePulse already requires Redis for other
scaled-system responsibilities.

Redis supports:

- Audit caching
- Distributed rate limiting
- Deduplication
- Coordination

BullMQ can use the same Redis technology while maintaining logically separate
keys and configuration.

This reduces the number of different infrastructure technologies that the team
must initially operate.

For larger production deployments, queue workloads and cache workloads may be
placed on separate Redis instances if resource isolation becomes necessary.

### Monitoring

Important BullMQ-related metrics include:

- Waiting jobs
- Active jobs
- Completed jobs
- Failed jobs
- Delayed jobs
- Retry count
- Oldest queued-job age
- Job processing duration
- Job completion rate

These metrics are also useful for worker autoscaling.

### Tradeoffs

BullMQ introduces additional operational complexity compared with executing
audits directly inside HTTP requests.

PagePulse now needs to operate:

- Redis
- Queue configuration
- Workers
- Retry policies
- Failed-job handling
- Queue monitoring

Asynchronous processing also changes the API contract.

A new audit may return:

HTTP 202 Accepted

instead of immediately returning the completed audit result.

Clients then need to retrieve the audit result through a job-status endpoint.

This complexity is justified because it provides controlled concurrency and
better behavior during traffic bursts.

### Alternative Considered — RabbitMQ

RabbitMQ was considered as an alternative message broker.

RabbitMQ provides:

- Mature message-delivery features
- Acknowledgements
- Routing capabilities
- Durable queues
- Dead-letter exchanges
- Strong messaging semantics
- Support for multiple programming languages

It would be a strong choice for a larger distributed system with complex
message-routing requirements.

### Why RabbitMQ Was Not Selected

The current PagePulse requirements do not require complex message routing or
cross-language messaging.

Introducing RabbitMQ would mean operating an additional infrastructure
technology while PagePulse already needs Redis.

BullMQ provides the capabilities required for the current workload:

- Job queues
- Retries
- Delayed jobs
- Worker concurrency
- Job state
- Horizontal worker processing

Using BullMQ therefore provides a simpler incremental path from the existing
Node.js application.

RabbitMQ should be reconsidered if PagePulse later develops requirements such
as:

- Complex event routing
- Many independent consumers
- Cross-service event distribution
- Stronger broker isolation requirements
- A larger polyglot microservice architecture

### Alternative Considered — Direct In-Process Processing

Another alternative is to continue performing audits directly inside the API
request.

This is the simplest architecture and avoids operating a queue.

### Why Direct Processing Was Not Selected

Direct processing couples customer-facing API capacity to audit-processing
capacity.

During a burst of 500 requests, the API could create hundreds of simultaneous
outbound operations.

This increases the risk of:

- Connection exhaustion
- Memory pressure
- Long API response times
- Request timeouts
- Cascading failures

A queue provides explicit backpressure and allows PagePulse to control how much
audit work runs at once.

### Final Decision

Use BullMQ backed by Redis for PagePulse audit-job processing.

The decision provides:

- Queue-based backpressure
- Controlled worker concurrency
- Retry support
- Horizontal worker scaling
- Integration with the existing Node.js/TypeScript stack
- Reuse of Redis infrastructure
- A straightforward incremental migration path

RabbitMQ remains a viable future alternative if PagePulse develops more complex
messaging requirements than the current audit-processing workload requires.

---

## 6. Persistent Database — PostgreSQL

### Decision

Use PostgreSQL as the persistent database for durable PagePulse application
data.

### Context

Redis is appropriate for caching, rate limiting, temporary job state and
coordination, but it should not be the only storage location for information
that PagePulse needs to retain permanently.

As PagePulse evolves, durable data may include:

- Audit IDs
- Normalized URLs
- Audit status
- Audit results
- Creation timestamps
- Completion timestamps
- Failure information
- Customer or client relationships
- Audit history

This information should survive:

- Application restarts
- Worker restarts
- Redis cache expiration
- Redis eviction
- Deployments

A persistent database is therefore required as the system of record.

### Why This Choice

PostgreSQL is a strong fit because most of the durable PagePulse data has
clear relationships.

For example:

Customer
→ Audit Requests
→ Audit Results
→ Failure / Status Information

A relational model makes these relationships explicit and provides strong
querying capabilities.

PostgreSQL also provides transactional guarantees, which are useful when
multiple pieces of related application state must be updated consistently.

### Example Data Model

A simplified audit table could contain:

| Field | Purpose |
|---|---|
| id | Unique audit identifier |
| client_id | Customer/client that requested the audit |
| url | Original submitted URL |
| normalized_url | Canonical URL used by PagePulse |
| status | queued, processing, completed or failed |
| result | Structured audit result |
| error_code | Failure code when applicable |
| created_at | Audit creation time |
| started_at | Worker processing start time |
| completed_at | Completion time |

The detailed audit result could be stored using PostgreSQL JSONB if the
structure contains nested metadata that does not need to be fully normalized
into separate relational tables.

This provides a useful combination of relational records and flexible JSON
storage.

### Transaction Support

Transactions are useful for maintaining consistent durable state.

For example, when a worker finishes an audit, PagePulse may need to:

1. Update the audit status to completed.
2. Store the final audit result.
3. Record the completion timestamp.

These operations should either succeed together or fail together where
appropriate.

PostgreSQL provides mature transaction support for this type of workflow.

### Querying and Audit History

A persistent database allows PagePulse to support future product features such
as:

- Retrieve previous audits for a customer
- Retrieve audit history for a URL
- Search audits by status
- Find recently failed audits
- Generate usage reports
- Measure audit completion rates
- Support administrative investigation

SQL is well suited to these types of structured queries.

### Indexing

Indexes can be created for frequently queried fields such as:

- Audit ID
- Client ID
- Normalized URL
- Status
- Creation timestamp

For example, an index on normalized URL and creation time could make it easier
to retrieve recent audit history efficiently.

Indexes should be selected based on measured query patterns rather than adding
indexes to every field.

### Connection Pooling

When PagePulse scales to multiple API instances and workers, database
connections must be controlled.

Every worker should not create an unlimited number of independent database
connections.

PagePulse should use connection pooling and configure pool sizes according to
database capacity.

Important metrics include:

- Active connections
- Idle connections
- Connection wait time
- Query latency
- Connection errors

This prevents horizontal application scaling from accidentally exhausting the
database connection limit.

### High Availability

For production deployment, PostgreSQL should preferably be provided through a
managed service with appropriate:

- Automated backups
- Point-in-time recovery where required
- Storage monitoring
- High-availability options
- Security updates
- Encryption
- Failure monitoring

This reduces the operational burden of maintaining the database directly.

### Redis and PostgreSQL Responsibilities

Redis and PostgreSQL serve different purposes.

Redis:

- Fast temporary cache
- Rate-limit counters
- Deduplication
- Distributed locks
- Temporary coordination
- Queue infrastructure

PostgreSQL:

- Durable audit records
- Historical results
- Customer relationships
- Persistent job metadata where required
- Long-term application data

Keeping these responsibilities separate prevents PagePulse from using a cache
as its permanent source of truth.

### Tradeoffs

PostgreSQL introduces additional infrastructure and operational
responsibilities.

PagePulse must manage:

- Database schema
- Migrations
- Connections
- Backups
- Indexes
- Query performance
- Storage capacity
- Database availability

Relational schemas also require more deliberate data modeling than simply
storing arbitrary documents.

However, this structure becomes beneficial as PagePulse develops more
relationships between customers, audits and historical data.

### Alternative Considered — MongoDB

MongoDB was considered as an alternative persistent database.

MongoDB provides:

- Flexible document-oriented storage
- Natural support for nested JSON-like objects
- Horizontal scaling capabilities
- Mature Node.js integration
- Flexible schemas

Because PagePulse audit results are naturally represented as structured JSON,
MongoDB could store an entire audit result as a document with minimal
transformation.

### Why MongoDB Was Not Selected

Although individual PagePulse audit results are document-like, the broader
application data is likely to become relational.

For example:

Client
→ many Audits

Audit
→ one Status

Audit
→ one Result

Client
→ usage and historical records

PostgreSQL provides strong relational querying and transactional behavior while
still allowing flexible nested audit data through JSONB.

Therefore, PagePulse does not need to choose between relational data and JSON
storage.

PostgreSQL can support both.

Using PostgreSQL also makes future reporting and analytical queries across
customers and audit history straightforward.

MongoDB would remain a reasonable choice if PagePulse's data became primarily
independent documents with very few relational queries.

### Alternative Considered — Redis as the Only Database

Another possible approach would be to store all PagePulse information in
Redis.

This would simplify the number of infrastructure technologies.

### Why Redis-Only Storage Was Not Selected

Redis is primarily being introduced for fast temporary operational state.

Audit cache entries may expire, and Redis may use eviction policies when
memory pressure increases.

Important customer audit history should not disappear because a cache entry
expired.

Separating durable storage from caching gives the system clearer guarantees:

Redis
→ temporary and performance-oriented state

PostgreSQL
→ durable source of truth

### Final Decision

Use PostgreSQL as the durable database for PagePulse while continuing to use
Redis for temporary and performance-sensitive state.

PostgreSQL provides:

- Strong relational modeling
- Transactions
- Mature SQL querying
- Indexing
- JSONB for flexible audit results
- Reliable durable storage
- Strong support for future audit-history and customer features

MongoDB remains a valid alternative, but PostgreSQL provides a better balance
between structured relationships and flexible audit-result storage for the
proposed PagePulse architecture.

---

## 7. Processing Model — Asynchronous Audit Processing

### Decision

Use asynchronous job-based processing for new PagePulse audits instead of
requiring every audit to complete within the original HTTP request.

### Context

The current PagePulse implementation performs an audit synchronously.

A client sends:

POST /api/v1/audits

The API fetches the target website, analyzes the page and returns the completed
audit result in the same HTTP request.

This approach is simple and works well at the current scale.

However, Task B requires PagePulse to support:

- 10,000+ audits per day
- Bursts of up to 500 concurrent requests
- A customer-facing response-time SLA

The execution time of a fresh audit depends heavily on the target website.

A website may:

- Respond quickly
- Respond slowly
- Redirect multiple times
- Temporarily fail
- Time out

PagePulse cannot control these external response times.

Therefore, tying the customer-facing API response directly to audit completion
makes predictable response times difficult at larger scale.

### Why This Choice

In the scaled architecture, a fresh audit becomes an asynchronous job.

The request flow becomes:

Client
→ POST /api/v1/audits
→ Validate Request
→ Check Cache
→ Create Audit Job
→ Add Job to Queue
→ Return Job ID

The audit is then processed independently:

Queue
→ Audit Worker
→ Fetch Target Website
→ Analyze Page
→ Store Result

The client can retrieve the status or completed result using an endpoint such
as:

GET /api/v1/audits/:jobId

This separates API responsiveness from external website performance.

### Example API Flow

A new audit request could return:

HTTP 202 Accepted

with a response such as:

{
  "success": true,
  "jobId": "audit_12345",
  "status": "queued"
}

The client can later request:

GET /api/v1/audits/audit_12345

While processing:

{
  "success": true,
  "jobId": "audit_12345",
  "status": "processing"
}

After completion:

{
  "success": true,
  "jobId": "audit_12345",
  "status": "completed",
  "data": {
    "url": "https://example.com",
    "statusCode": 200
  }
}

### Cache Hits Can Remain Synchronous

Not every audit request needs asynchronous processing.

If PagePulse already has a valid cached result, the API can return that result
immediately.

The processing model therefore becomes:

Audit Request
        |
        v
   Cache Check
      /    \
   Hit      Miss
    |         |
Return      Queue Job
Result      + Return Job ID

This preserves fast responses for repeated audits while protecting the system
from expensive cache-miss operations.

### Benefits

Asynchronous processing provides several important benefits:

- Predictable API acknowledgement times
- Queue-based backpressure
- Controlled audit concurrency
- Independent worker scaling
- Better handling of slow target websites
- Improved retry handling
- Better failure isolation
- Reduced risk of HTTP request timeouts
- Easier handling of large traffic bursts

### Handling 500 Concurrent Requests

Suppose 500 fresh audit requests arrive simultaneously.

With synchronous processing:

500 HTTP Requests
→ 500 audits may begin immediately
→ 500 outbound website operations
→ API resources remain occupied until audits finish

With asynchronous processing:

500 HTTP Requests
→ Validation / Cache Check
→ Jobs Enter Queue
→ API Responds Quickly
→ Workers Process Jobs at Controlled Concurrency

This allows PagePulse to absorb the burst without requiring all 500 audits to
execute simultaneously.

### Customer-Facing SLA

Asynchronous processing also makes the response-time SLA more realistic.

PagePulse can define an objective for how quickly it accepts a valid audit
request without claiming control over how quickly an arbitrary third-party
website responds.

For example, PagePulse may target a low p95 latency for returning the job
acknowledgement.

Audit completion time can be measured separately.

This creates two distinct service measurements:

1. API acknowledgement latency
2. Audit completion latency

This distinction provides a more meaningful customer-facing reliability model.

### Job Status

The persistent database stores durable audit status.

Typical states include:

- queued
- processing
- completed
- failed

Redis may additionally cache frequently requested job-status information for
fast access.

The database remains the durable source of truth.

### Failure Handling

If a worker fails while processing an audit, the original customer HTTP
connection does not need to remain open.

The queue can apply the configured retry policy.

If processing ultimately fails, the job status becomes:

failed

and the client can receive a structured failure result through the status
endpoint.

This makes failures easier to manage than keeping a long-running HTTP request
open during retries.

### Tradeoffs

Asynchronous processing introduces additional complexity.

The application now requires:

- Job IDs
- Job-status tracking
- A queue
- Workers
- Persistent job state
- Retry behavior
- Additional API endpoints

Clients may also need to make more than one HTTP request to retrieve a fresh
audit result.

The API contract therefore becomes more complex than the current synchronous
implementation.

### Alternative Considered — Fully Synchronous Processing

The main alternative is to continue using the current synchronous model.

The flow would remain:

Client
→ POST /api/v1/audits
→ Fetch Website
→ Analyze Website
→ Return Completed Result

This has several advantages:

- Simple API contract
- Easy for clients to consume
- No polling required
- No job-status endpoint required
- Less infrastructure
- Easier implementation

For small workloads, this is a good design.

### Why Fully Synchronous Processing Was Not Selected

At the required Task B scale, synchronous processing creates stronger coupling
between API availability and external website performance.

If hundreds of slow audits arrive simultaneously:

- HTTP connections remain open longer
- API instances consume resources for longer periods
- Customer latency increases
- Request timeout risk increases
- Scaling becomes less predictable

A queue cannot provide its full backpressure benefit if every customer request
must remain open until the queued job finishes.

Asynchronous processing therefore provides better isolation between the
customer-facing API and unpredictable audit execution.

### Alternative Considered — Hybrid Processing

Another option is a hybrid approach.

PagePulse could allow a fresh audit to execute synchronously for a very short
period.

If the audit completes quickly, the API returns the result immediately.

If it exceeds the short threshold, PagePulse converts it to asynchronous
processing.

This could provide a convenient user experience for fast websites.

However, it also makes the API lifecycle and implementation more complicated.

The simpler initial scaled design is:

- Cache hit → synchronous result
- Cache miss → asynchronous job

A hybrid model could be introduced later if product requirements justify the
additional complexity.

### Final Decision

Use asynchronous processing for fresh PagePulse audits while continuing to
return valid cached results synchronously.

The final processing model is:

Cached Audit
→ Return Immediately

Fresh Audit
→ Create Job
→ Queue
→ Return 202 + Job ID
→ Worker Processes Audit
→ Client Retrieves Result

This provides the strongest balance between:

- Customer-facing responsiveness
- Queue-based backpressure
- Controlled concurrency
- Horizontal scaling
- Failure isolation
- Implementation clarity

The existing synchronous API does not need to be replaced immediately.

This architecture represents the next stage of PagePulse as traffic grows and
the scaling requirements become necessary.

---

## 8. Deployment Strategy — Containerized Services

### Decision

Deploy the scaled PagePulse system as containerized API and worker services
that can scale horizontally.

### Context

The scaled PagePulse architecture contains multiple independently scalable
components:

- API instances
- Audit workers
- Redis
- Job queue
- PostgreSQL
- Observability integrations

The API and worker layers have different scaling requirements.

API instances scale primarily according to incoming HTTP traffic, while audit
workers scale according to queue pressure and audit-processing demand.

The deployment model should therefore allow these components to be deployed,
updated and scaled independently.

### Why This Choice

Containers provide a consistent runtime environment for PagePulse.

A container image can package:

- Node.js runtime
- Compiled PagePulse application
- Production dependencies
- Application startup command
- Required runtime configuration structure

The same image can be tested and then deployed consistently across different
environments.

For example, PagePulse can run separate container workloads for:

PagePulse API
→ Handles HTTP traffic

PagePulse Worker
→ Processes audit jobs

Both can use the same codebase while running different startup commands.

### Independent Scaling

Containerized deployment allows the API and worker layers to scale
independently.

For example:

Normal traffic:

API Instances: 2
Workers: 2

Traffic burst:

API Instances: 3
Workers: 8

These numbers are only illustrative.

Actual instance counts should be determined from load testing and production
metrics.

The important architectural property is that increasing worker capacity does
not require increasing API capacity by the same amount.

### Stateless API Containers

PagePulse API containers should remain stateless.

Shared state should live in:

- Redis
- Job queue
- PostgreSQL

This means any healthy API container can handle any incoming request.

If an API container fails, the load balancer can stop routing traffic to it
without losing important application state.

### Worker Containers

Workers can run as a separate container service.

Each worker:

1. Connects to the queue.
2. Receives audit jobs.
3. Processes jobs using bounded concurrency.
4. Stores results.
5. Acknowledges completed jobs.

Additional worker containers can be started when queue pressure increases.

This makes worker capacity elastic.

### Immutable Releases

Each PagePulse release should produce a versioned container image.

A release can be identified using:

- Application version
- Git commit SHA
- Container image tag

For example:

`pagepulse:1.4.0`

or:

`pagepulse:<git-commit-sha>`

The production environment should deploy the same artifact that passed the
required CI checks.

This improves reproducibility and makes rollback easier.

### CI/CD Integration

The deployment pipeline can follow:

Developer Push
→ GitHub
→ CI
→ Tests
→ TypeScript Build
→ Container Image Build
→ Image Registry
→ Deployment

A release should proceed only after required automated checks pass.

This extends the CI workflow already used by the current PagePulse project.

### Horizontal Scaling

The deployment platform should support horizontal scaling.

API scaling signals can include:

- Requests per second
- CPU utilization
- Memory utilization
- p95 API latency

Worker scaling signals can include:

- Queue depth
- Oldest queued-job age
- Active jobs
- Worker utilization

This allows PagePulse to add capacity to the component actually experiencing
pressure.

### Health and Readiness Checks

Container orchestration should use health checks.

A liveness check determines whether the process is running.

A readiness check determines whether the instance is ready to receive work.

An unhealthy API container should be removed from load-balancer traffic.

An unhealthy worker should stop receiving new jobs until it recovers or is
replaced.

### Graceful Shutdown

Containers may be stopped during:

- Deployments
- Autoscaling
- Infrastructure maintenance
- Failure recovery

API instances should stop accepting new traffic before termination.

Workers should stop taking new jobs and attempt to finish active jobs before
exiting.

This reduces lost requests and duplicate job processing.

### Deployment Portability

Containers also reduce dependence on one hosting provider.

PagePulse could run on container-supporting platforms such as:

- Managed container platforms
- Kubernetes
- Cloud container services
- Virtual machines running containers

The architecture does not require Kubernetes immediately.

The orchestration platform should match the actual operational requirements
and team size.

### Tradeoffs

Containers introduce additional responsibilities compared with directly
deploying a Node.js process.

These include:

- Container image creation
- Image registry management
- Container security
- Resource limits
- Health checks
- Deployment configuration
- Container monitoring

A sophisticated orchestration platform can introduce even more operational
complexity.

Therefore, PagePulse should avoid adopting complex orchestration solely for
the sake of using it.

### Alternative Considered — Serverless Functions

Serverless functions were considered as an alternative deployment model for
the PagePulse API.

Serverless platforms provide benefits such as:

- Automatic scaling
- Reduced server management
- Pay-per-use pricing
- Easy deployment for lightweight HTTP functions

This can work well for short-lived stateless API operations.

### Why Serverless Functions Were Not Selected

The PagePulse workload includes long-running and network-heavy audit workers.

A fresh audit may involve:

- DNS resolution
- Multiple redirects
- External website fetching
- HTML parsing
- Retry behavior
- Queue processing

Serverless environments may introduce constraints such as:

- Execution-duration limits
- Cold-start latency
- Platform-specific concurrency behavior
- Less control over long-running worker processes

PagePulse also benefits from workers that continuously consume jobs from a
queue with explicitly controlled concurrency.

Containerized workers provide a more natural model for this workload.

### Hybrid Possibility

Serverless functions could still be useful for selected lightweight PagePulse
operations in the future.

For example, simple webhook processing or low-cost utility endpoints could be
implemented separately if there were a clear benefit.

This does not require the main audit-processing system to use the same
deployment model.

### Alternative Considered — Direct Virtual Machine Deployment

Another alternative is to deploy Node.js directly onto virtual machines.

This provides:

- Full operating-system control
- Long-running processes
- Flexible configuration

However, direct VM deployment requires more manual management of:

- Runtime versions
- Dependencies
- Process supervision
- Deployment consistency
- Scaling
- Machine configuration

Containers provide a more reproducible unit of deployment.

### Final Decision

Use containerized services for the scaled PagePulse API and audit workers.

The deployment model provides:

- Reproducible runtime environments
- Independent API and worker scaling
- Horizontal scalability
- Graceful deployments
- Versioned release artifacts
- Straightforward rollback
- Portability between container-capable hosting platforms

Start with the simplest managed container platform that satisfies PagePulse
requirements.

A more complex orchestration platform such as Kubernetes should only be
introduced if operational scale and deployment requirements justify the
additional complexity.

---

## 9. Observability — OpenTelemetry and Structured Logging

### Decision

Use structured application logging together with OpenTelemetry-compatible
metrics and distributed tracing for the scaled PagePulse system.

### Context

The scaled PagePulse architecture contains several independently running
components:

- Load balancer / API gateway
- Multiple PagePulse API instances
- Redis
- BullMQ job queue
- Multiple audit workers
- PostgreSQL
- External target websites

A single audit may therefore move through several components before it is
completed.

For example:

Client Request
→ API Instance
→ Redis Cache Lookup
→ BullMQ Queue
→ Audit Worker
→ External Website
→ PostgreSQL
→ Redis Cache

Traditional console logs from one application instance are not sufficient to
understand the complete lifecycle of such a request.

PagePulse therefore requires centralized logs, metrics and distributed traces.

### Why This Choice

OpenTelemetry provides a vendor-neutral standard for collecting telemetry from
applications.

It can provide:

- Distributed traces
- Metrics
- Context propagation
- Instrumentation across services

Using OpenTelemetry avoids tightly coupling the PagePulse application code to
one specific monitoring vendor.

Telemetry can later be exported to a compatible observability platform
selected by the deployment environment.

### Structured Logging

PagePulse should continue using structured logs rather than relying only on
free-form console messages.

A structured log can contain fields such as:

{
  "level": "info",
  "requestId": "req_12345",
  "jobId": "audit_67890",
  "event": "audit.completed",
  "durationMs": 850,
  "cached": false
}

Structured fields make logs easier to:

- Search
- Filter
- Aggregate
- Correlate
- Use for operational investigation

### Request ID Propagation

Every incoming PagePulse request should receive a unique request ID.

That identifier should propagate through the complete audit lifecycle:

HTTP Request
→ API Log
→ BullMQ Job
→ Worker Log
→ Database Operation
→ Audit Completion

If an error occurs, engineers can search for the request ID and reconstruct the
processing path.

### Job ID Correlation

Asynchronous processing introduces a second important identifier: the job ID.

The request ID represents the original API request.

The job ID represents the background audit operation.

Both should be included in relevant telemetry.

For example:

{
  "requestId": "req_123",
  "jobId": "audit_456",
  "event": "worker.audit.started"
}

This makes it possible to correlate customer-facing requests with asynchronous
worker activity.

### Distributed Tracing

Distributed tracing follows one logical operation across multiple components.

A PagePulse trace could contain spans such as:

Audit Request
├── Validate Request
├── Redis Cache Lookup
├── Queue Job
└── Worker Processing
    ├── DNS Resolution
    ├── External HTTP Request
    ├── HTML Analysis
    ├── PostgreSQL Write
    └── Redis Cache Update

If an audit becomes slow, the trace can show which operation consumed most of
the time.

This is especially valuable because PagePulse depends on external websites
whose response times are outside PagePulse's control.

### Metrics

Metrics provide aggregate information about system behavior.

Important PagePulse API metrics include:

- Requests per second
- HTTP status counts
- HTTP 429 rate
- HTTP 5xx rate
- p50 response latency
- p95 response latency
- p99 response latency

Important queue metrics include:

- Waiting jobs
- Active jobs
- Failed jobs
- Retry count
- Oldest queued-job age
- Job completion rate

Important worker metrics include:

- Active audits
- Audit completion rate
- Average audit duration
- p95 audit duration
- Timeout rate
- Worker CPU usage
- Worker memory usage

Important Redis metrics include:

- Cache hit ratio
- Redis command latency
- Memory utilization
- Connection count
- Eviction count

Important PostgreSQL metrics include:

- Query latency
- Connection utilization
- Database error rate
- CPU usage
- Storage utilization

### Why Metrics, Logs and Traces Are All Required

Each observability signal answers a different question.

Metrics answer:

"Is something wrong?"

Logs answer:

"What happened?"

Traces answer:

"Where did the time or failure occur?"

For example:

Metric
→ p95 audit latency increased

Trace
→ external HTTP request is consuming most of the time

Log
→ target website repeatedly returned HTTP 503

Using the three signals together significantly improves incident diagnosis.

### SLA Monitoring

Observability should directly measure the customer-facing PagePulse service
objectives.

Important measurements include:

- Cached audit response latency
- New audit acknowledgement latency
- Job-status response latency
- Queue waiting time
- Total audit completion time
- API availability

Latency should be measured using percentiles such as p95 and p99 rather than
only averages.

### Alerting

Alerts should be created for conditions that require engineering attention.

Examples include:

- Sustained HTTP 5xx increase
- API p95 latency above the defined objective
- Rapid queue growth
- Oldest queued-job age above the allowed threshold
- Worker crash or failure spike
- Audit timeout spike
- Redis unavailable
- PostgreSQL unavailable
- Dead-letter queue growth

Alert thresholds should be tuned using actual production behavior to avoid
creating unnecessary alert noise.

### Sensitive Data

Observability must not expose secrets.

Logs and traces should avoid recording:

- API keys
- Authentication tokens
- Authorization headers
- Database passwords
- Redis credentials
- Other secrets

Because URLs can contain sensitive query parameters, PagePulse should also
consider sanitizing URLs before recording them in telemetry.

### Tradeoffs

Adding distributed observability introduces additional complexity.

PagePulse must manage:

- Instrumentation
- Telemetry exporters
- Storage costs
- Dashboard configuration
- Alert configuration
- Data retention
- Sampling strategy

Distributed tracing can also generate a large volume of telemetry.

Sampling may therefore be required at higher traffic levels.

Despite this complexity, observability becomes increasingly important once
PagePulse runs across multiple API and worker instances.

### Alternative Considered — Console Logs Only

The simplest alternative is to continue using only application console logs.

This has several benefits:

- Very simple
- Minimal application configuration
- Low initial development effort
- Sufficient for basic debugging in a small application

This approach is reasonable for the current small-scale PagePulse deployment.

### Why Console Logs Only Were Not Selected

Console logs become insufficient once audit processing is distributed.

A customer request may be handled by:

API Instance A

while the audit itself is handled later by:

Worker Instance D

Looking at the logs from one process does not show the complete request
lifecycle.

Console logs alone also do not provide strong support for:

- SLA measurement
- Queue-pressure monitoring
- Percentile latency
- Cross-service tracing
- Automated alerting
- Capacity planning

Therefore, centralized observability is required for the scaled architecture.

### Alternative Considered — Vendor-Specific Instrumentation

Another alternative is to instrument PagePulse directly using the proprietary
SDK of a specific monitoring provider.

This may provide excellent integration with that particular platform.

However, it also creates stronger vendor coupling.

### Why Vendor-Specific Instrumentation Was Not Selected

OpenTelemetry provides a standardized instrumentation layer.

PagePulse can collect telemetry using OpenTelemetry and choose an appropriate
backend separately.

This provides more flexibility if the monitoring platform changes in the
future.

Vendor-specific features can still be added where they provide clear value,
but the core telemetry model should remain portable.

### Final Decision

Use:

- Structured JSON logging
- Request IDs
- Job IDs
- OpenTelemetry-compatible metrics
- Distributed tracing
- Centralized dashboards
- Actionable alerts

for the scaled PagePulse observability architecture.

This provides visibility across the complete audit lifecycle while avoiding
unnecessary dependence on a single observability vendor.

The observability system should answer:

1. Is PagePulse healthy?
2. Are customers receiving responses within the expected SLA?
3. Is the queue keeping up with incoming work?
4. Are workers processing audits successfully?
5. Which component caused a slow or failed audit?

---

## 10. Final Technology Decision Summary

The proposed PagePulse architecture intentionally builds on the existing
Node.js and TypeScript application rather than replacing working components
without a demonstrated need.

The selected technologies provide a practical path from the current
single-service implementation to a horizontally scalable audit platform.

### 10.1 Final Technology Stack

| Area | Selected Technology / Approach | Primary Reason |
|---|---|---|
| Runtime | Node.js + TypeScript | Strong asynchronous I/O support and reuse of the existing codebase |
| API Framework | Express | Mature ecosystem and existing PagePulse implementation |
| Distributed Cache | Redis | Shared low-latency cache and coordination across instances |
| Job Queue | BullMQ + Redis | Backpressure, retries and controlled worker concurrency |
| Audit Processing | Independent Workers | Isolates expensive audit execution from the public API |
| Persistent Database | PostgreSQL | Durable relational storage with JSONB support |
| Processing Model | Asynchronous for fresh audits | Separates API response time from external website latency |
| Deployment | Containerized Services | Independent horizontal scaling of API and workers |
| Observability | OpenTelemetry + Structured Logging | Vendor-neutral metrics, logs and distributed tracing |

### 10.2 Alternatives Considered

The major alternatives considered were:

| Selected Choice | Alternative | Reason Alternative Was Not Selected |
|---|---|---|
| Node.js + TypeScript | Go | Rewrite cost is not justified without evidence that Node.js is the bottleneck |
| Express | Fastify | Framework migration does not solve the primary audit-concurrency problem |
| Redis | Process-local cache | Local state becomes inconsistent across horizontally scaled instances |
| Redis | Memcached | Redis also supports rate limiting, locks and coordination |
| BullMQ | RabbitMQ | Additional broker complexity is unnecessary for the current job-processing requirements |
| BullMQ queue | Direct in-process audits | Does not provide sufficient backpressure during traffic bursts |
| PostgreSQL | MongoDB | PostgreSQL better supports relational data while JSONB handles flexible audit results |
| PostgreSQL | Redis-only storage | Cached/temporary storage should not be the durable source of truth |
| Asynchronous processing | Fully synchronous processing | Couples API latency to unpredictable external website performance |
| Containers | Serverless functions | Long-running queue workers and controlled concurrency fit containers better |
| Containers | Direct VM deployment | Containers provide more reproducible deployments and easier horizontal scaling |
| OpenTelemetry | Console logs only | Logs alone do not provide metrics, SLA monitoring or cross-service tracing |
| OpenTelemetry | Vendor-specific instrumentation | Vendor-neutral instrumentation provides greater portability |

### 10.3 Why These Technologies Work Together

The selected technologies have clearly separated responsibilities.

The PagePulse API handles lightweight customer-facing operations using
Node.js, TypeScript and Express.

Redis provides shared temporary state across API and worker instances.

BullMQ uses queue-based processing to separate incoming request volume from
audit execution capacity.

Workers perform expensive website fetching and analysis independently from the
public API.

PostgreSQL stores information that must remain durable after cache expiration,
process restarts or deployments.

Containers allow API instances and workers to scale independently.

OpenTelemetry and structured logs provide visibility across the distributed
request lifecycle.

Together, the flow becomes:

Client
→ Load Balancer
→ Express API
→ Redis Cache
→ BullMQ Queue
→ Node.js Audit Workers
→ External Website
→ PostgreSQL
→ Redis Cache

Logs, metrics and traces provide observability across the entire flow.

### 10.4 Incremental Migration Strategy

These decisions do not require PagePulse to move immediately from the current
implementation to the complete scaled architecture.

The migration can occur incrementally.

#### Stage 1 — Current Production Service

Continue using:

- Node.js
- TypeScript
- Express
- Current audit engine
- Validation
- Security controls
- In-memory caching
- Rate limiting
- Automated tests
- CI/CD

This remains appropriate while traffic is low.

#### Stage 2 — Introduce Redis

Move shared operational state to Redis:

- Audit cache
- Distributed rate-limit counters
- Deduplication keys
- Coordination state

This prepares the API for horizontal scaling.

#### Stage 3 — Introduce BullMQ and Workers

Move fresh audit execution out of the HTTP request lifecycle.

The API creates jobs while workers perform the actual audits.

This introduces:

- Backpressure
- Bounded concurrency
- Retry support
- Independent worker scaling

#### Stage 4 — Introduce PostgreSQL

Persist:

- Audit records
- Audit status
- Results
- Failure information
- Historical data

This creates a durable system of record.

#### Stage 5 — Scale Horizontally

Run multiple:

- API containers
- Worker containers

Scale API instances based on HTTP demand and workers based primarily on queue
pressure.

#### Stage 6 — Expand Observability

Add centralized:

- Structured logs
- Metrics
- Distributed traces
- Dashboards
- Alerts

Use production measurements to tune worker concurrency, autoscaling thresholds
and service objectives.

### 10.5 Avoiding Premature Complexity

Although the target architecture contains several components, PagePulse should
not introduce infrastructure before there is a clear operational reason.

For example, the architecture does not require Kubernetes simply because
containers are being used.

Similarly, it does not require RabbitMQ when BullMQ provides the queue
capabilities needed for the current workload.

The preferred approach is to use the simplest architecture that safely meets
the measured requirements.

Additional complexity should be introduced when it solves a demonstrated
problem.

### 10.6 Decision Principles

The technology choices in this document follow several principles:

1. Prefer incremental evolution over unnecessary rewrites.
2. Separate customer-facing HTTP traffic from expensive audit processing.
3. Keep API instances stateless.
4. Store shared temporary state outside application processes.
5. Use durable storage for important business data.
6. Introduce explicit backpressure before increasing concurrency.
7. Scale API and worker capacity independently.
8. Prefer measurable performance decisions over assumptions.
9. Make failures observable and recoverable.
10. Keep technologies replaceable where practical.

### 10.7 Final Decision

The proposed PagePulse scaled technology stack is:

Node.js + TypeScript
→ Application runtime

Express
→ Customer-facing REST API

Redis
→ Distributed cache, rate limiting and coordination

BullMQ
→ Audit job queue

Independent Node.js Workers
→ Controlled audit execution

PostgreSQL
→ Durable audit and customer data

Containers
→ Deployment and horizontal scaling

OpenTelemetry + Structured Logging
→ Metrics, traces, logs and operational visibility

This stack provides the capabilities required for the target PagePulse
workload while preserving the existing implementation and allowing the system
to evolve incrementally as real production demand increases.