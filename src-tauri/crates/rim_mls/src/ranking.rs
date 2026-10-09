//! Which group device commits pending membership changes, and when.

use std::time::Duration;

use uuid::Uuid;

/// Wait per rank step before committing.
const STEP: Duration = Duration::from_secs(15);
/// Ranks beyond this wait as long as this one.
const MAX_RANK: usize = 8;
/// Upper bound of the random jitter added to the wait.
pub const MAX_JITTER: Duration = Duration::from_secs(3);

/// `me`'s rank among the group devices that may commit (those not pending removal), sorted by
/// lowercase UUID text; `None` when `me` may not commit. A device in `first` (the member's own
/// other device for a device link) ranks 0 and shifts the rest.
pub fn commit_rank(
    group_devices: &[Uuid],
    pending_removes: &[Uuid],
    first: Option<&Uuid>,
    me: &Uuid,
) -> Option<usize> {
    let mut eligible: Vec<String> = group_devices
        .iter()
        .filter(|device| !pending_removes.contains(device))
        .map(|device| device.hyphenated().to_string())
        .collect();
    eligible.sort();
    eligible.dedup();
    if let Some(first) = first.map(|d| d.hyphenated().to_string()) {
        if let Some(position) = eligible.iter().position(|d| *d == first) {
            let device = eligible.remove(position);
            eligible.insert(0, device);
        }
    }
    let me = me.hyphenated().to_string();
    eligible.iter().position(|device| *device == me)
}

/// How long a device of `rank` waits before refetching the group and committing: 15 s per rank
/// (at most 8 steps) plus `jitter` (0 to 3 s, chosen at random by the caller).
pub fn commit_delay(rank: usize, jitter: Duration) -> Duration {
    STEP * rank.min(MAX_RANK) as u32 + jitter.min(MAX_JITTER)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(n: u128) -> Uuid {
        Uuid::from_u128(n)
    }

    #[test]
    fn ranks_follow_uuid_order_and_skip_pending_removes() {
        let devices = [id(3), id(1), id(2)];
        assert_eq!(commit_rank(&devices, &[], None, &id(1)), Some(0));
        assert_eq!(commit_rank(&devices, &[], None, &id(3)), Some(2));
        assert_eq!(commit_rank(&devices, &[id(1)], None, &id(2)), Some(0));
        assert_eq!(commit_rank(&devices, &[id(1)], None, &id(1)), None);
        assert_eq!(commit_rank(&devices, &[], Some(&id(3)), &id(3)), Some(0));
        assert_eq!(commit_rank(&devices, &[], Some(&id(3)), &id(1)), Some(1));
    }

    #[test]
    fn delays_cap_at_eight_steps() {
        assert_eq!(commit_delay(0, Duration::ZERO), Duration::ZERO);
        assert_eq!(
            commit_delay(2, Duration::from_secs(1)),
            Duration::from_secs(31)
        );
        assert_eq!(
            commit_delay(20, Duration::from_secs(9)),
            Duration::from_secs(123)
        );
    }
}
