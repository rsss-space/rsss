# Feature Specification: Sentry should not log things in dev mode

**Feature Branch**: `033-no-sentry-in-dev`  
**Created**: 2026-06-04  
**Status**: Draft  
**Input**: User description: "Sentry should not log things in dev mode"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Local errors never reach the error dashboard (Priority: P1)

A developer runs the application locally and triggers an error (for
example, a failing request to a local API endpoint). The error is handled
locally but is never transmitted to the team's shared error-monitoring
service. The production error dashboard stays free of local development
noise.

**Why this priority**: This is the core of the request. Right now, errors
that happen on a developer's machine show up in the shared error-monitoring
dashboard tagged as the development environment. That noise pollutes the
dashboard, consumes the team's monitoring quota, and can trigger false
alerts that compete for attention with real production incidents.

**Independent Test**: Run the app locally, deliberately cause an error, and
confirm that no corresponding event appears in the error-monitoring
dashboard. Delivers the primary value on its own.

**Acceptance Scenarios**:

1. **Given** the application is running in local development mode, **When**
   an unhandled error occurs during a request, **Then** no event is sent to
   the error-monitoring service.
2. **Given** the application is running in local development mode, **When**
   code explicitly reports a handled error, **Then** no event is sent to
   the error-monitoring service.
3. **Given** local development mode, **When** an error occurs in a
   background or stateful component (not just a normal request), **Then** no
   event is sent to the error-monitoring service.

---

### User Story 2 - Deployed environments keep reporting errors (Priority: P1)

The team continues to rely on the error-monitoring service to surface real
incidents in deployed environments. Silencing local development must not
silence production or staging.

**Why this priority**: A change that disabled reporting everywhere would
remove the team's visibility into real incidents. The dev-mode suppression
is only valuable if deployed reporting is provably unaffected, so this is an
equal-priority guardrail rather than an afterthought.

**Independent Test**: Trigger an error in a deployed (production or staging)
environment and confirm the event still appears in the dashboard, tagged
with the correct environment.

**Acceptance Scenarios**:

1. **Given** the application is running in a deployed production
   environment, **When** an error occurs, **Then** the event is sent to the
   error-monitoring service tagged as production.
2. **Given** the application is running in a deployed staging environment,
   **When** an error occurs, **Then** the event is sent to the
   error-monitoring service tagged as staging.

---

### User Story 3 - Developers still see local errors (Priority: P2)

When an error happens locally, the developer can still see it in their local
console output, so dev-mode suppression does not make local debugging
harder.

**Why this priority**: Suppressing remote reporting should not reduce the
information a developer has while working. Local visibility is what makes
the suppression safe to adopt, but it is a refinement on top of the core
behavior in User Story 1.

**Independent Test**: Trigger an error locally and confirm it is still
written to the local console/logs even though it was not sent to the
error-monitoring service.

**Acceptance Scenarios**:

1. **Given** local development mode, **When** an error occurs, **Then** the
   error is still written to the local console output.

---

### Edge Cases

- A developer has valid monitoring credentials configured in their local
  environment (for example, copied from deployed secrets). Local
  development must still not transmit events.
- An error is captured automatically by the monitoring tool's built-in
  instrumentation rather than through an explicit report call. Both capture
  paths must be silent in local development.
- An environment is labeled "development" but is actually deployed and
  remotely accessible. This is out of scope: suppression targets local
  development, and deployed-environment behavior is governed by User
  Story 2.
- Non-error telemetry (performance traces, spans, session replays) is
  produced during local development. None of it should be transmitted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When running in local development mode, the system MUST NOT
  transmit any error or exception events to the external error-monitoring
  service.
- **FR-002**: Local-development suppression MUST apply to every path that
  could transmit an event, including both errors reported explicitly by
  application code and errors captured automatically by the monitoring
  tool's request/handler instrumentation.
- **FR-003**: Local-development suppression MUST apply across all runtime
  surfaces that integrate the monitoring service, including the server
  request handler, background/stateful components, and the browser client.
- **FR-004**: When running in local development mode, the system MUST NOT
  transmit performance traces, spans, or session replays to the monitoring
  service.
- **FR-005**: The system MUST continue to transmit errors, traces, and
  replays to the monitoring service in deployed environments (production and
  staging); local-development suppression MUST NOT regress deployed
  reporting.
- **FR-006**: Errors occurring in local development MUST remain visible to
  the developer through local console output.
- **FR-007**: Local-development suppression MUST hold even when valid
  monitoring credentials are present in the local environment.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Over a normal development cycle (at least one week of active
  local development), zero events tagged with the local/development
  environment appear in the team's error-monitoring dashboard.
- **SC-002**: 100% of errors deliberately triggered while running locally
  are absent from the error-monitoring dashboard.
- **SC-003**: Errors deliberately triggered in deployed production and
  staging continue to appear in the dashboard, with no measurable drop in
  reporting rate compared to before the change.
- **SC-004**: 100% of errors triggered while running locally remain visible
  to the developer in local console output.

## Assumptions

- "Dev mode" means the application running in a local development context on
  a developer's machine (local server runtime and local browser runtime),
  not any remotely deployed environment.
- "Things" means all categories of data the monitoring service can receive:
  errors/exceptions, performance traces and spans, and session replays.
- Deployed environments (production and staging) are out of scope for
  suppression and must retain their current reporting behavior.
- The browser client is believed to already withhold events outside of
  production; the observed leak is on the server side. The requirements
  intentionally cover all surfaces so the behavior is uniform and protected
  against future regressions.
- Local console logging of errors is a desired behavior and is retained.
