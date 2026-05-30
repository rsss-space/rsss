# Feature Specification: Fix Sentry Cross-Request Promise Warning on Blog Post Navigation

**Feature Branch**: `025-fix-sentry-cross-request-warning`  
**Created**: 2026-05-29  
**Status**: Draft  
**Input**: User description: "Error/warning in the terminal when I navigate to a specific blog item — `Warning: A promise was resolved or rejected from a different request context than the one it was created in ... Continuations for that request are unlikely to run safely and have been canceled.` originating from `@sentry/cloudflare` span completion (`_CloudflareClient._resolveSpanCompletion` / `SentrySpan.end`), reproduced at `http://127.0.0.1:5555/post/brittanyellich.com/web-dev-challenge`."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clean logs when opening a blog post (Priority: P1)

A developer or operator running the application opens a blog post item page
(e.g. `/post/brittanyellich.com/web-dev-challenge`). The request is served
successfully and **no** runtime warning about a promise being resolved or
rejected from a different request context appears in the terminal or logs.

**Why this priority**: The warning is the reported defect. It pollutes the
local development terminal on a routine, frequently-used navigation, making
real errors harder to spot and signalling that request-scoped async work is
escaping its request lifecycle. Eliminating it is the core of this feature.

**Independent Test**: Start the application locally, navigate to a blog post
item URL, and confirm the request returns a normal response while the terminal
remains free of any "different request context" / "continuations ... have been
canceled" warning. Repeat across several post URLs and reloads.

**Acceptance Scenarios**:

1. **Given** the application is running and the user is authenticated,
   **When** they navigate to a blog post item page,
   **Then** the page is served normally and no cross-request promise warning
   is emitted to the terminal or logs.
2. **Given** a blog post page that has not been visited before (no cached
   render),
   **When** the user navigates to it,
   **Then** the page renders and no cross-request promise warning is emitted.
3. **Given** the user opens several different blog post pages in succession,
   **When** each request completes,
   **Then** zero cross-request promise warnings are emitted across all of them.

---

### User Story 2 - Request-scoped async work completes safely (Priority: P2)

Any asynchronous work attached to a blog-post request (telemetry/observability
spans and any per-request background continuations) either completes within the
request's lifecycle or is otherwise tied to it, so that the runtime does not
cancel its continuations as "unlikely to run safely."

**Why this priority**: The warning is not only noise — it states that
continuations "have been canceled." If meaningful work (such as recording a
telemetry span or finishing an instrumentation callback) was being silently
dropped, the underlying defect would persist even if the message were merely
suppressed. Fixing the lifecycle, not just the symptom, is required for a
correct resolution.

**Independent Test**: Exercise the blog-post navigation path and confirm that
the async work previously implicated in the warning runs to completion (no
cancelled continuations are reported) without changing the rendered output.

**Acceptance Scenarios**:

1. **Given** the blog-post request triggers request-scoped asynchronous
   instrumentation,
   **When** the request finishes,
   **Then** that asynchronous work completes (or is properly awaited) rather
   than being cancelled as a cross-request continuation.
2. **Given** the fix is applied,
   **When** the same navigation is performed,
   **Then** the runtime reports no cancelled continuations for that request.

---

### User Story 3 - No regression in blog post rendering (Priority: P3)

After the warning is resolved, blog post item pages continue to load and render
with the same content and behavior as before, and observability/telemetry in
deployed environments keeps functioning.

**Why this priority**: The fix must not trade a log warning for a user-facing
regression or a loss of error/performance reporting. This guards the change
rather than adding new capability, so it is lowest priority but still required.

**Independent Test**: Compare a blog post page before and after the change
(content, navigation, and successful load) and confirm error/telemetry
reporting still occurs in a deployed-style environment.

**Acceptance Scenarios**:

1. **Given** the fix is applied,
   **When** a user opens a blog post item page,
   **Then** the page content, layout, and navigation are unchanged from before
   the fix.
2. **Given** a deployed-style environment where telemetry reporting is active,
   **When** requests are handled,
   **Then** errors and performance traces are still captured as before.

### Edge Cases

- What happens when the blog post page is served from a cached render versus
  freshly generated? The warning must be absent in both paths.
- What happens on rapid, repeated navigation between blog post pages? No
  cross-request warning should accumulate.
- What happens in environments where telemetry is disabled (no destination
  configured) versus enabled? The warning must be absent in both, and enabling
  telemetry must not reintroduce cancelled continuations.
- What happens when the underlying request fails or errors? Error reporting
  should still occur without producing a cross-request promise warning.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Navigating to a blog post item page MUST NOT cause the runtime
  to emit a warning that a promise was resolved or rejected from a different
  request context than the one it was created in.
- **FR-002**: Asynchronous work initiated while handling a blog-post request
  (including observability/telemetry span completion) MUST be tied to that
  request's lifecycle so the runtime does not cancel its continuations.
- **FR-003**: Blog post item pages MUST continue to render with the same
  content and behavior after the change as before it.
- **FR-004**: Error and performance telemetry MUST continue to be captured in
  deployed environments after the change.
- **FR-005**: The fix MUST eliminate the underlying cross-request behavior
  rather than only silencing the warning message, so that no per-request
  continuation is silently cancelled.
- **FR-006**: The resolution MUST hold across both cached and freshly-rendered
  blog post responses and across repeated navigations.

### Key Entities

- **Blog post item request**: A request to view a single article/post page
  (path of the form `/post/<source-host>/<article-path>`); the navigation that
  reproduces the warning.
- **Request-scoped asynchronous work**: Observability/telemetry spans and any
  per-request continuations whose completion is currently outliving the request
  context that created them.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across at least 10 consecutive blog post navigations (mix of
  cached and uncached, including reloads), zero cross-request promise warnings
  are emitted (0 occurrences).
- **SC-002**: 100% of blog post item pages that loaded successfully before the
  change continue to load successfully and display the same content after it.
- **SC-003**: In a deployed-style environment with telemetry enabled, error and
  performance reporting continues at the same coverage as before the change
  (no reduction in captured events attributable to this change).
- **SC-004**: No per-request continuation is reported as cancelled for the
  blog-post navigation path after the change.

## Assumptions

- The warning is reproducible by navigating to a blog post item URL (e.g.
  `/post/brittanyellich.com/web-dev-challenge`) while the application is
  running, as reported.
- The warning originates from request-scoped asynchronous instrumentation
  (observability span completion) whose promise settles after the originating
  request context has already completed; the desired outcome is to keep that
  work within the request lifecycle, not merely to hide the message.
- The fix should not change user-facing rendering of blog post pages and should
  preserve existing telemetry behavior in deployed environments.
- "No regression" is judged against current behavior of the blog post item
  page (successful load, content, and navigation).
- Suppressing the warning via a runtime compatibility flag is acceptable only
  if it provably keeps continuations running safely; the preferred outcome is
  that no continuation is cancelled in the first place.
