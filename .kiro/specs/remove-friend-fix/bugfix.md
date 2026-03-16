# Bugfix Requirements Document

## Introduction

The "Remove Friend" functionality in the `/roll-request/:requestId/respond` endpoint (`src/routes/roll.routes.js`) has two related bugs. First, the authorization check for cancellation doesn't distinguish between cancelling a pending request and removing an accepted friendship, causing the receiver of the original request to get a 403 error when trying to unfriend. Second, when an accepted friendship is cancelled (unfriended), the `friends_count` is never decremented for either user, leading to inflated friend counts.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user who is the receiver of the original friend request attempts to cancel an accepted friendship by sending `status: 'cancelled'` THEN the system returns a 403 error with "Only the sender can cancel a request"

1.2 WHEN a user (sender or receiver) cancels an accepted friendship by sending `status: 'cancelled'` THEN the system does not decrement `friends_count` for either user, leaving both users' friend counts inflated by 1

### Expected Behavior (Correct)

2.1 WHEN either party (sender or receiver) of an accepted friendship sends `status: 'cancelled'` to remove the friendship THEN the system SHALL allow the cancellation and update the request status to 'cancelled'

2.2 WHEN an accepted friendship is cancelled THEN the system SHALL decrement `friends_count` for both the sender and receiver of the original friend request

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the sender of a pending friend request sends `status: 'cancelled'` THEN the system SHALL CONTINUE TO allow the cancellation

3.2 WHEN a user who is NOT the sender of a pending friend request sends `status: 'cancelled'` THEN the system SHALL CONTINUE TO return a 403 error, since only the sender can cancel a pending request

3.3 WHEN the receiver of a pending friend request sends `status: 'accepted'` or `status: 'declined'` THEN the system SHALL CONTINUE TO allow the response and only the receiver can accept or decline

3.4 WHEN a friend request is accepted THEN the system SHALL CONTINUE TO increment `friends_count` for both users
