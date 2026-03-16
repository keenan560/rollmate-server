# Remove Friend Fix — Bugfix Design

## Overview

The `/roll-request/:requestId/respond` endpoint in `src/routes/roll.routes.js` has two bugs related to cancelling accepted friendships. The authorization check treats all cancellations the same, blocking the receiver from unfriending. Additionally, cancelling an accepted friendship never decrements `friends_count`, leaving inflated counts. The fix differentiates cancellation authorization based on request status and adds a `decrement_friends_count` RPC call when an accepted friendship is cancelled.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — when a user attempts to cancel an accepted friendship (unfriend), specifically when the receiver tries to cancel, or when either party cancels and `friends_count` is not decremented
- **Property (P)**: The desired behavior — either party can cancel an accepted friendship, and `friends_count` is decremented for both users
- **Preservation**: Existing pending-request authorization logic, accept/decline flows, and `friends_count` increment on acceptance must remain unchanged
- **rollRequest**: A row in the `roll_requests` table representing a friend request with `sender_id`, `receiver_id`, and `status` (`pending`, `accepted`, `declined`, `cancelled`)
- **friends_count**: An integer column on the `users` table tracking how many accepted friendships a user has
- **increment_friends_count**: Existing Supabase RPC function that increments a user's `friends_count` by 1
- **decrement_friends_count**: New Supabase RPC function that decrements a user's `friends_count` by 1, floored at 0

## Bug Details

### Bug Condition

The bug manifests when a user sends `status: 'cancelled'` to the respond endpoint for a roll request that has `status: 'accepted'`. The authorization check only allows `sender_id === req.user.uid` for any cancellation, regardless of the request's current status. This means the receiver of the original request cannot unfriend. Additionally, no `friends_count` decrement occurs when an accepted friendship is cancelled.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { requestId, userId, newStatus, rollRequest }
  OUTPUT: boolean

  // Bug 1: Receiver blocked from cancelling accepted friendship
  condition1 := input.newStatus == 'cancelled'
                AND input.rollRequest.status == 'accepted'
                AND input.userId == input.rollRequest.receiver_id

  // Bug 2: friends_count not decremented on accepted friendship cancellation
  condition2 := input.newStatus == 'cancelled'
                AND input.rollRequest.status == 'accepted'

  RETURN condition1 OR condition2
END FUNCTION
```

### Examples

- User A sends friend request to User B. User B accepts. User B tries to unfriend by sending `cancelled` → gets 403 "Only the sender can cancel a request" (Bug 1). Expected: 200 with status updated to `cancelled`.
- User A sends friend request to User B. User B accepts. User A unfriends by sending `cancelled` → status updates to `cancelled` but both users' `friends_count` remains unchanged (Bug 2). Expected: both users' `friends_count` decremented by 1.
- User A sends friend request to User B. User B accepts. User B unfriends (after Bug 1 is fixed) → `friends_count` not decremented (Bug 2). Expected: both decremented by 1.
- Edge case: User with `friends_count = 0` somehow triggers cancellation of accepted friendship → `friends_count` should not go negative (use `GREATEST(friends_count - 1, 0)`).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Sender cancelling a pending request must continue to work (200 response)
- Non-sender cancelling a pending request must continue to return 403
- Only the receiver can accept or decline a pending request
- `friends_count` increment on acceptance must continue to work
- Notifications for accept, decline, and cancel must continue to be sent
- All other endpoint behavior (fetching requests, sending requests) is unaffected

**Scope:**
All inputs where `newStatus` is NOT `cancelled` or where `rollRequest.status` is NOT `accepted` should be completely unaffected by this fix. This includes:
- Accepting a pending request
- Declining a pending request
- Cancelling a pending request as the sender
- Sending a new friend request
- Fetching friend requests

## Hypothesized Root Cause

Based on the bug description, the issues are:

1. **Flat Authorization Check**: The cancellation authorization block (lines ~130-134 in `roll.routes.js`) checks `request.sender_id !== req.user.uid` without considering `request.status`. It treats cancelling a pending request and unfriending an accepted friendship identically, but the authorization rules differ between these two cases.

2. **Missing Decrement Logic**: The endpoint has an `if (status === "accepted")` block that increments `friends_count` for both users, but there is no corresponding `if (status === "cancelled" && request.status === "accepted")` block to decrement. The decrement was simply never implemented.

3. **Missing SQL Function**: There is no `decrement_friends_count` RPC function in the database, so even if the JS code tried to call it, it would fail. A new migration is needed.

## Correctness Properties

Property 1: Bug Condition — Either Party Can Cancel Accepted Friendship

_For any_ input where a roll request has `status = 'accepted'` and either the sender or receiver sends `status: 'cancelled'`, the fixed endpoint SHALL allow the cancellation (return 200) and update the request status to `cancelled`.

**Validates: Requirements 2.1**

Property 2: Bug Condition — Friends Count Decremented on Unfriend

_For any_ input where a roll request has `status = 'accepted'` and a user sends `status: 'cancelled'`, the fixed endpoint SHALL decrement `friends_count` for both the sender and receiver, with a floor of 0.

**Validates: Requirements 2.2**

Property 3: Preservation — Pending Request Authorization Unchanged

_For any_ input where a roll request has `status = 'pending'`, the fixed endpoint SHALL enforce the same authorization rules as the original: only the sender can cancel, only the receiver can accept/decline.

**Validates: Requirements 3.1, 3.2, 3.3**

Property 4: Preservation — Friends Count Increment on Accept Unchanged

_For any_ input where a pending roll request is accepted, the fixed endpoint SHALL continue to increment `friends_count` for both users, identical to the original behavior.

**Validates: Requirements 3.4**

## Fix Implementation

### Changes Required

**File**: `src/routes/roll.routes.js`

**Function**: `POST /roll-request/:requestId/respond` handler

**Specific Changes**:

1. **Modify cancellation authorization logic**: Replace the flat `sender_id` check with status-aware logic:
   - If `request.status === 'accepted'` and `status === 'cancelled'`: allow if user is sender OR receiver
   - If `request.status === 'pending'` and `status === 'cancelled'`: allow only if user is sender (existing behavior)

2. **Add friends_count decrement block**: After the status update succeeds, add a block:
   ```
   if (status === 'cancelled' && request.status === 'accepted') {
     // Decrement friends_count for both sender and receiver
     await supabase.rpc('decrement_friends_count', { user_id: request.sender_id })
     await supabase.rpc('decrement_friends_count', { user_id: request.receiver_id })
   }
   ```

3. **Update cancellation notification**: When an accepted friendship is cancelled, the notification message should reflect unfriending rather than "cancelled their roll request".

**File**: `migrations/decrement_friends_count.sql` (new)

**Specific Changes**:

4. **Create `decrement_friends_count` SQL function**:
   ```sql
   CREATE OR REPLACE FUNCTION decrement_friends_count(user_id UUID)
   RETURNS VOID AS $$
   BEGIN
     UPDATE users
     SET friends_count = GREATEST(friends_count - 1, 0)
     WHERE id = user_id;
   END;
   $$ LANGUAGE plpgsql;
   ```

5. **Use `GREATEST` to prevent negative counts**: The function uses `GREATEST(friends_count - 1, 0)` to ensure `friends_count` never goes below 0, handling edge cases where data may be inconsistent.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that call the respond endpoint with `status: 'cancelled'` on accepted friendships, as both sender and receiver. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:
1. **Receiver Unfriend Test**: Send `cancelled` as receiver on an accepted friendship (will fail with 403 on unfixed code)
2. **Sender Unfriend Test**: Send `cancelled` as sender on an accepted friendship — check that `friends_count` is NOT decremented (will demonstrate Bug 2 on unfixed code)
3. **Both Users Count Test**: Accept a friendship, then cancel it, and verify both users' `friends_count` values (will show counts remain inflated on unfixed code)
4. **Zero Count Edge Case**: Cancel an accepted friendship where a user has `friends_count = 0` (may reveal negative count issues)

**Expected Counterexamples**:
- Receiver gets 403 when trying to cancel an accepted friendship
- `friends_count` remains unchanged after cancelling an accepted friendship
- Possible causes: flat authorization check, missing decrement logic

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := respondEndpoint_fixed(input)
  ASSERT result.status == 200
  ASSERT rollRequest.status == 'cancelled'
  IF input.rollRequest.status == 'accepted' THEN
    ASSERT sender.friends_count == sender.previous_friends_count - 1
    ASSERT receiver.friends_count == receiver.previous_friends_count - 1
    ASSERT sender.friends_count >= 0
    ASSERT receiver.friends_count >= 0
  END IF
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT respondEndpoint_original(input) = respondEndpoint_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for pending request operations (cancel as sender, accept, decline), then write property-based tests capturing that behavior.

**Test Cases**:
1. **Pending Cancel Preservation**: Verify sender can still cancel pending requests after fix, and receiver still gets 403
2. **Accept/Decline Preservation**: Verify receiver can still accept/decline pending requests, and sender still gets 403 for accept/decline
3. **Friends Count Increment Preservation**: Verify accepting a pending request still increments `friends_count` for both users
4. **Notification Preservation**: Verify notifications continue to be sent for accept, decline, and cancel actions

### Unit Tests

- Test cancellation authorization for accepted friendships (sender and receiver both allowed)
- Test cancellation authorization for pending requests (only sender allowed)
- Test `friends_count` decrement on accepted friendship cancellation
- Test `friends_count` floor at 0 (no negative counts)
- Test that accept/decline authorization is unchanged

### Property-Based Tests

- Generate random (sender, receiver, status) tuples for accepted friendships and verify either party can cancel
- Generate random pending request scenarios and verify original authorization rules hold
- Generate random `friends_count` values and verify decrement is correct with floor at 0

### Integration Tests

- Full flow: send request → accept → unfriend as receiver → verify counts and status
- Full flow: send request → accept → unfriend as sender → verify counts and status
- Full flow: send request → cancel as sender (pending) → verify 200 and no count change
- Full flow: send request → receiver tries to cancel (pending) → verify 403
