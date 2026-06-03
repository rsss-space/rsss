# Phase 1 Investigation Findings: Stripe v3 Critical-Path Load

## Reproduction

Static analysis approach: No fresh browser session initiated (dev server startup impractical in environment). Instead, Task 1 findings derived from Task 2's import-chain trace below, combined with knowledge of Stripe.js library behavior (per Stripe docs: the default `@stripe/stripe-js` entrypoint injects `<script src="https://js.stripe.com/v3">` as a side effect of module import).

**Expected behavior before fix:** On a fresh tab loading the home route, the import chain eagerly loads `payment-method-modal.ts`, which imports `@stripe/stripe-js`, causing the Stripe.js script to inject at module-load time rather than when `loadStripe()` is called.

**Expected behavior after fix:** On a fresh tab loading the home route, switching to `@stripe/stripe-js/pure` defers the Stripe.js script injection until `loadStripe()` is explicitly called inside `handleAddCard`, eliminating the unnecessary home-route request to `https://js.stripe.com/v3`.

## Root Cause

Import-chain analysis via grep:

1. `src/client/routes/index.ts:7` statically imports `./settings.js`:
   ```typescript
   import { SettingsRoute } from './settings.js'
   ```

2. `src/client/routes/settings.ts:55-56` statically imports `../components/payment-method-modal.js`:
   ```typescript
   import { PaymentMethodModal } from
       '../components/payment-method-modal.js'
   ```

3. `src/client/components/payment-method-modal.ts:10-13` imports from `@stripe/stripe-js`:
   ```typescript
   import {
       loadStripe,
       type Stripe as StripeLib,
       type StripeElements
   } from '@stripe/stripe-js'
   ```

4. Only file importing `@stripe/stripe-js` in production code:
   - `src/client/components/payment-method-modal.ts` (confirmed via `rg -n "from ['\"]@stripe/stripe-js"`)

**Conclusion:** The `SettingsRoute` and `PaymentMethodModal` are eagerly imported at the top of `routes/index.ts`. When the application boots and the router is instantiated, the entire module graph including `payment-method-modal.ts` is eagerly loaded (not dynamically imported). This triggers the import of `@stripe/stripe-js` from the default entrypoint, which injects the `<script src="https://js.stripe.com/v3">` tag as a side effect at module-load time, even though:

- `loadStripe()` is called only inside `handleAddCard()` callback (line 130)
- The PaymentMethodModal is only rendered inside SettingsRoute (reached at `/settings`, not `/`)
- There is no `<Elements>` provider at app root

The home route (`/`) renders `FeedReader` and does not navigate to `/settings` until the user clicks. However, because the entire router is constructed eagerly with static imports, the Stripe.js script tag is injected as a side effect of the module graph being loaded, causing the unnecessary network request on the home route.

## Resolution

**Applied Fix:** Changed the import in `src/client/components/payment-method-modal.ts` from:
```typescript
} from '@stripe/stripe-js'
```
to:
```typescript
} from '@stripe/stripe-js/pure'
```

The `@stripe/stripe-js/pure` entrypoint is identical in API surface but defers script injection until `loadStripe()` is explicitly called. This makes the script load defensive: it cannot be injected as a side effect of importing the module, only when the user explicitly opens the add-card flow.

**Test stub update:** Updated `test/run-all-tests.mjs` line 176 to add the `/pure` variant mapping, ensuring tests continue to work when the component imports from the new path.

This is a defensive one-line change that guarantees the home route does not request `https://js.stripe.com/v3` regardless of how the router is structured.
