# PagePulse

PagePulse is a production-oriented REST API for auditing public web pages. Given a URL, the service fetches the target page and returns useful metadata and audit information related to SEO, accessibility, links, images, and page structure.

The project is built with Node.js, TypeScript, and Express, with an emphasis on security, reliability, testability, and maintainable backend architecture.

## Features

- URL-based webpage auditing
- HTML metadata extraction
- SEO checks
- Accessibility checks
- Internal and external link analysis
- Image and alt-text analysis
- URL validation
- SSRF protection
- DNS/IP validation for private and local network targets
- Request timeout handling
- Concurrency limiting
- In-memory caching
- API rate limiting
- Request ID generation
- Structured request logging
- Centralized error handling
- Graceful shutdown
- Automated tests with Vitest
- GitHub Actions CI pipeline

## Tech Stack

- Node.js
- TypeScript
- Express
- Zod
- Vitest
- Supertest
- GitHub Actions

## Project Structure

```text
pagepulse/
├── .github/
│   └── workflows/
│       └── ci.yml
├── src/
│   ├── config/
│   ├── controllers/
│   ├── middleware/
│   ├── routes/
│   ├── schemas/
│   ├── services/
│   ├── types/
│   ├── utils/
│   ├── app.ts
│   └── server.ts
├── tests/
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Getting Started

### Prerequisites

Install:

- Node.js 20+
- npm
- Git

### Installation

Clone the repository:

```bash
git clone https://github.com/Utkarsh4136/pagepulse.git
cd pagepulse
```

Install dependencies:

```bash
npm install
```

Create the local environment file:

**Windows PowerShell**

```powershell
Copy-Item .env.example .env
```

**macOS/Linux**

```bash
cp .env.example .env
```

Start the development server:

```bash
npm run dev
```

The API will be available at:

```text
http://localhost:3000
```

## API Endpoints

### Health Check

```http
GET /health
```

Used to verify that the API is running.

### Audit a URL

```http
POST /api/v1/audits
Content-Type: application/json
```

Example request:

```json
{
  "url": "https://www.wikipedia.org"
}
```

The response contains information discovered during the page audit, including page metadata, links, images, detected issues, and the audit timestamp.

## Validation

Only valid HTTP and HTTPS URLs are accepted.

For example, an invalid request such as:

```json
{
  "url": "hello"
}
```

is rejected with a validation error.

## Security

PagePulse treats submitted URLs as untrusted input.

The service includes protections designed to prevent requests to unsafe targets, including:

- URL protocol validation
- DNS resolution
- Private/local IP blocking
- Loopback address blocking
- SSRF protection
- Request timeouts
- Response-size controls

These controls reduce the risk of the audit endpoint being used to access internal or local network resources.

## Reliability

The service includes several mechanisms for improving reliability under load.

### Concurrency Control

A semaphore limits the number of audits that may execute concurrently.

### Caching

Audit results can be cached temporarily to reduce unnecessary repeated requests for the same URL.

### Rate Limiting

Clients are rate-limited to protect the API from excessive request volume.

### Graceful Shutdown

The HTTP server handles termination signals and shuts down cleanly.

## Observability

Each request receives a request ID that can be used to correlate logs with API responses.

Structured logging captures information such as:

- Request ID
- HTTP method
- Request path
- Response status
- Request duration

## Testing

Run the automated test suite:

```bash
npm test
```

Generate the coverage report:

```bash
npm run test:coverage
```

The tests cover important API and infrastructure behavior including:

- Health endpoint
- Request validation
- Security checks
- Request IDs
- Caching
- Concurrency/semaphore behavior
- Not-found handling

## Build

Compile the TypeScript project:

```bash
npm run build
```

## Continuous Integration

The repository contains a GitHub Actions workflow under:

```text
.github/workflows/ci.yml
```

The CI pipeline automatically validates the project when changes are pushed or submitted through pull requests.

## Environment Configuration

Environment variables are documented in `.env.example`.

The real `.env` file is intentionally excluded from Git to avoid committing local configuration or secrets.

## Design Decisions

The codebase separates responsibilities into controllers, services, middleware, schemas, utilities, and routes.

This structure keeps HTTP concerns separate from audit logic and infrastructure concerns, making the application easier to test, maintain, and extend.

Security checks are performed before fetching user-provided URLs because a server-side URL auditing service must not blindly trust external input.

Caching and concurrency control are implemented independently so that repeated requests can be served efficiently while expensive network operations remain bounded.

## Future Improvements

Given additional production requirements, possible improvements include:

- Redis-backed distributed caching
- Distributed rate limiting
- Persistent audit history
- Background job processing
- Authentication and API keys
- OpenAPI/Swagger documentation
- Metrics and distributed tracing
- Containerized deployment
- Configurable audit rules

## Author

**Utkarsh Zinjal**

GitHub: `Utkarsh4136`