# PRD: Instance-Level Dual Claude Authentication

**Issue:** [AUD-31](/AUD/issues/AUD-31)
**Author:** Project Manager
**Date:** 2026-04-14
**Status:** Final — Ready for Engineering

***

## 1. Overview

### Problem Statement

Paperclip currently supports a single Claude authentication mode per deployment. Operators need the flexibility to use Anthropic subscription credits (via OAuth token) as the primary payment method and fall back to a provisioned API key when subscription credits are exhausted — without reconfiguring the instance or interrupting agent operations. This is an operational resilience concern for instance administrators.

### Goal

Allow a Paperclip instance administrator to configure two Claude credential sources — **Subscription (OAuth Token)** and **API Key** — at the instance level. When both are configured, the system uses subscription credits first and automatically falls back to the API key on credit exhaustion. Both credential modes expose a **Test Connection** action so administrators can verify each independently. When fallback occurs, an in-app toast alert notifies the admin.

### Non-Goals

* Per-company or per-organization Claude credential overrides (explicitly out of scope per the request).
* Support for non-Anthropic AI providers (out of scope for this iteration).
* End-user visibility into which credential mode is active.
* Usage-based billing split or reporting per credential mode.
* Per-model-variant credential differentiation (all model variants use the same credential config).

***

## 2. Background & Context

### Why Now

As Paperclip moves toward production deployments, instance operators need cost control and resilience. Subscription plans offer lower per-token cost at scale; API keys provide a backstop when subscription quota is exhausted. Operators have explicitly requested this as a high-priority operational capability.

### Related Work

* Paperclip already routes LLM calls through a centralized adapter layer — this feature extends that layer with credential selection logic.
* The existing subscription credential is stored as an OAuth token in the env var `CLAUDE_CODE_OAUTH_TOKEN`. No API key is currently configured in production.
* No prior implementation of dual-credential fallback exists at the instance level.

### Clarifications Received (2026-04-14)

| #  | Question                          | Answer                                                                                                                                                                                |
| -- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 | Admin access scope                | Board / instance admin users                                                                                                                                                          |
| Q2 | Subscription credential mechanism | OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`). Can keep token-based approach or use full OAuth flow. Coexistence preferred.                                                                 |
| Q3 | Credit exhaustion error signal    | Adapter result with `is_error: true` and `result` string containing `"You've hit your limit"` (e.g., `"You've hit your limit · resets 10pm (UTC)"`)                                   |
| Q4 | Admin notification on fallback    | In-app toast alert                                                                                                                                                                    |
| Q5 | Multi-model credential scope      | All Claude model variants use the same credential config — no per-model separation                                                                                                    |
| Q6 | Migration from existing config    | Current system uses `CLAUDE_CODE_OAUTH_TOKEN` only (no API key). UI must attempt coexistence with this env var. If coexistence is not feasible, admin will re-authenticate via OAuth. |

***

## 3. User Stories

**US-1 (Primary — Admin Setup)**
As an **instance administrator**, I want to configure both a Claude OAuth token (subscription) and an API key in the instance settings, so that I have a fallback when subscription credits run out and never lose agent execution capacity unexpectedly.

**US-2 (Primary — Auto-Fallback)**
As an **instance administrator**, I want the system to automatically use my API key when subscription credits are depleted, so that agent runs continue uninterrupted without manual intervention.

**US-3 (Primary — Fallback Notification)**
As an **instance administrator**, I want to be notified with an in-app alert when the system falls back from subscription to API key, so that I am aware of the credential state and can top up my subscription.

**US-4 (Primary — Test Connection)**
As an **instance administrator**, I want to test each credential independently with a single click, so that I can confirm both the subscription OAuth token and the API key are valid before relying on them.

**US-5 (Edge — Partial Config)**
As an **instance administrator**, I want to run the instance with only one credential type configured, so that I am not forced to provide both to use the system.

**US-6 (Edge — Both Failing)**
As an **instance administrator**, I want to receive a clear, actionable error when both credential sources fail, so that I can diagnose and fix the problem quickly.

**US-7 (Edge — API Key Only)**
As an **instance administrator**, I want to disable the subscription mode and use only an API key, so that I can fully control costs without any subscription dependency.

**US-8 (Migration — Existing CLAUDE\_CODE\_OAUTH\_TOKEN)**
As an **instance administrator** upgrading an existing deployment, I want my existing `CLAUDE_CODE_OAUTH_TOKEN` env var to be recognized automatically as the subscription credential, so that I do not need to reconfigure anything on upgrade.

***

## 4. Functional Requirements

**FR-1** — The instance settings must expose a **Claude Credentials** configuration section accessible only to board-level / instance administrator users.

**FR-2** — The Claude Credentials section must support two credential sources:

* **Subscription (OAuth Token)**: An OAuth token that authenticates against Anthropic's API on behalf of a subscription account. The token value may be pre-populated from the `CLAUDE_CODE_OAUTH_TOKEN` environment variable if present. The UI must allow the admin to enter or update this token manually. This token format is preserved as-is (no full OAuth redirect flow required unless the token approach proves infeasible).
* **API Key**: A user-supplied Anthropic API key string (format: `sk-ant-...`).

**FR-3** — When both credential sources are configured and enabled, the system must attempt to route LLM calls using **Subscription (OAuth Token) first**. If the adapter response has `is_error: true` AND the `result` field contains the substring `"You've hit your limit"`, the system must automatically retry the **same request** using the **API Key** credential, without manual intervention.

**FR-4** — When a fallback from Subscription to API Key occurs (per FR-3), the system must display an **in-app toast alert** to any instance administrator who is currently active in the application, with a message such as: *"Subscription credits exhausted — requests are now using your API key."* The toast must persist until dismissed (not auto-hide).

**FR-5** — The API Key value must be stored encrypted at rest. It must never be returned in plaintext via any API response after initial submission; only a masked representation (e.g., `sk-ant-...XXXX`) must be shown. The same masking rule applies to the OAuth token.

**FR-6** — Each credential source must have an independent **Test Connection** button. When triggered, the test must make a minimal real API call (e.g., a low-token completion) to the Anthropic API using that credential and return a pass/fail result with a human-readable status message within 10 seconds.

**FR-7** — Each credential source must be independently **enable/disable**able. Disabling a source removes it from the fallback chain without deleting its configuration.

**FR-8** — If only one credential source is configured and enabled, the system must use that source exclusively with no fallback.

**FR-9** — If all configured and enabled credential sources fail for a given LLM call, the system must surface a structured error to the calling agent run indicating both sources were attempted and failed. The error message must be actionable (e.g., *"Both subscription and API key authentication failed — check instance Claude settings"*).

**FR-10** — The instance settings UI must display the current status of each configured credential source: `configured`, `unconfigured`, `active` (currently in use this session), or `error` (last test or call failed).

**FR-11** — Changes to instance-level Claude credentials must be logged in an instance audit trail with actor identity and timestamp.

**FR-12** — On application startup (or when the Claude Credentials settings are first opened), if `CLAUDE_CODE_OAUTH_TOKEN` is set as an environment variable and no Subscription credential is yet persisted in the database, the system must automatically import the env var value as the Subscription OAuth token (pre-populating the field). The admin must confirm/save explicitly — the import must not be silent.

**FR-13** — The credential configuration must apply uniformly to all Claude model variants (Opus, Sonnet, Haiku). There is no per-model credential differentiation.

***

## 5. Non-Functional Requirements

**NFR-1 (Performance)** — The fallback evaluation (detecting subscription credit exhaustion and switching to API key) must add no more than **200 ms** of overhead (excluding the API round-trip of the retry itself) to the affected request.

**NFR-2 (Security)** — Both OAuth tokens and API keys must be encrypted at rest using the instance encryption key. They must not appear in logs, error messages, or API responses.

**NFR-3 (Availability)** — Credential selection logic must not introduce a single point of failure. If the credential store is temporarily unavailable, the system must fail with a clear error rather than silently proceeding with an unconfigured state.

**NFR-4 (Auditability)** — Every credential-source switch (subscription → API key) during normal operation must be recorded in instance-level logs (not user-visible) with the reason (e.g., `quota_exceeded`) and timestamp.

**NFR-5 (Scalability)** — Credential configuration is read on each LLM call; it must be cached in memory with a TTL (≤ 60 s) to avoid database round-trips per request.

***

## 6. Acceptance Criteria

**AC-1 (FR-1, FR-2)**
Given I am logged in as a board / instance administrator,
When I navigate to instance settings,
Then I see a "Claude Credentials" section with two subsections: Subscription (OAuth Token) and API Key.

**AC-2 (FR-3)**
Given both Subscription and API Key are configured and enabled,
And the next Anthropic API call returns `is_error: true` with result containing `"You've hit your limit"`,
When an agent run triggers that LLM call,
Then the system retries the call using the API key without any manual intervention, and the run succeeds.

**AC-3 (FR-4)**
Given both Subscription and API Key are configured and enabled,
And a fallback from Subscription to API Key occurs,
When an instance administrator is active in the app,
Then a persistent in-app toast appears with a message indicating subscription credits are exhausted and the API key is now in use.

**AC-4 (FR-5)**
Given an API key or OAuth token has been saved,
When I view the Claude Credentials settings page,
Then each credential field shows only a masked value and never the full secret.

**AC-5 (FR-6)**
Given a valid API key is configured,
When I click "Test Connection" for the API Key source,
Then within 10 seconds I see a green success indicator and a message confirming connectivity to the Anthropic API.

**AC-6 (FR-6)**
Given an invalid or expired API key is configured,
When I click "Test Connection" for the API Key source,
Then within 10 seconds I see a red failure indicator and a message describing the error (e.g., "Invalid API key — authentication rejected by Anthropic").

**AC-7 (FR-7, FR-8)**
Given Subscription is disabled and API Key is enabled,
When an agent run triggers an LLM call,
Then the system uses only the API Key and does not attempt the subscription path.

**AC-8 (FR-9)**
Given both Subscription and API Key are configured but both are invalid,
When an agent run triggers an LLM call,
Then the run fails with an error message stating both credential sources were attempted and failed, and the message includes guidance to check instance Claude settings.

**AC-9 (FR-10)**
Given the Subscription Test Connection was last run and failed,
When I view the Claude Credentials settings,
Then the Subscription credential source shows status `error` with the last-failed timestamp.

**AC-10 (FR-11)**
Given I update the API Key value,
When the change is saved,
Then the instance audit log contains an entry with: actor identity, action (`claude_api_key_updated`), and UTC timestamp.

**AC-11 (FR-12)**
Given `CLAUDE_CODE_OAUTH_TOKEN` is set as an env var,
And no Subscription credential is yet saved in the database,
When I open the Claude Credentials settings,
Then the Subscription OAuth token field is pre-populated with the env var value and a notice reads: "Imported from environment variable — save to persist."

**AC-12 (FR-13)**
Given a single API key credential is configured,
When agent runs invoke Opus, Sonnet, and Haiku models in sequence,
Then all three calls authenticate successfully using the same API key.

***

## 7. Dependencies & Risks

| #   | Item                                           | Type         | Notes                                                                                                                                                                                                                |
| --- | ---------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Anthropic credit-exhaustion error response     | External API | **Resolved:** `is_error: true` + result containing `"You've hit your limit"` (see Q3 answer)                                                                                                                         |
| D-2 | Instance-level encryption key infrastructure   | Internal     | FR-5 requires at-rest encryption; confirm this infrastructure exists before sprint start                                                                                                                             |
| D-3 | Instance settings admin UI                     | Internal     | FR-1 assumes an admin settings surface exists; confirm with engineering                                                                                                                                              |
| D-4 | LLM call routing layer                         | Internal     | FR-3 fallback must be implemented in whichever layer dispatches Anthropic calls                                                                                                                                      |
| D-5 | CLAUDE\_CODE\_OAUTH\_TOKEN env var (migration) | Internal     | FR-12 requires reading this env var on first setup. Existing deployments already use it.                                                                                                                             |
| R-1 | Silent billing surprise                        | Risk         | Auto-fallback to API key may cause unexpected charges if unnoticed. **Mitigation (resolved):** FR-4 mandates in-app toast alert on first fallback.                                                                   |
| R-2 | OAuth token expiry                             | Risk         | OAuth tokens expire. If `CLAUDE_CODE_OAUTH_TOKEN` expires and no API key is set, all LLM calls fail. **Mitigation:** FR-10 status indicators and FR-6 Test Connection give admins early warning.                     |
| R-3 | "You've hit your limit" message stability      | Risk         | The exact error substring may change in future Anthropic adapter versions. **Mitigation:** Engineering should own a thin error-parsing abstraction so the match string can be updated without a full feature change. |

***

## 8. Open Questions

All questions resolved as of 2026-04-14. No blockers remain.

| #  | Question                          | Resolution                                                                        |
| -- | --------------------------------- | --------------------------------------------------------------------------------- |
| Q1 | Admin access scope                | Board / instance admin users                                                      |
| Q2 | Subscription credential mechanism | OAuth token via `CLAUDE_CODE_OAUTH_TOKEN`; coexistence with new UI preferred      |
| Q3 | Credit exhaustion signal          | `is_error: true` + result contains `"You've hit your limit"`                      |
| Q4 | Admin notification on fallback    | In-app persistent toast alert                                                     |
| Q5 | Multi-model scope                 | Uniform — all Claude model variants use the same credential config                |
| Q6 | Migration path                    | Pre-populate UI from `CLAUDE_CODE_OAUTH_TOKEN` env var; admin confirms to persist |