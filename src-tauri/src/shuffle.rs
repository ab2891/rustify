//! One uniform permutation of unique tracks, with no artist/history weighting.
use rand::{rngs::OsRng, Rng};
use std::collections::HashSet;

pub fn tracks(ids: Vec<String>, keep_first: Option<String>) -> Result<Vec<String>, String> {
    let mut rng = OsRng;
    permutation(ids, keep_first, |upper| rng.gen_range(0..upper))
}
fn permutation(
    ids: Vec<String>,
    keep_first: Option<String>,
    mut draw: impl FnMut(usize) -> usize,
) -> Result<Vec<String>, String> {
    if ids.len() > 100_000 || ids.iter().any(|id| id.is_empty() || id.len() > 512) {
        return Err("This collection is too large or contains invalid track IDs.".into());
    }
    let mut seen = HashSet::new();
    let mut order: Vec<_> = ids
        .into_iter()
        .filter(|id| seen.insert(id.clone()))
        .collect();
    if let Some(first) = &keep_first {
        let index = order
            .iter()
            .position(|id| id == first)
            .ok_or("The current track is outside this collection.")?;
        order.remove(index);
    }
    // Fisher–Yates. rand's bounded integer sampling uses rejection rather than modulo.
    for index in (1..order.len()).rev() {
        let chosen = draw(index + 1);
        order.swap(index, chosen);
    }
    if let Some(first) = keep_first {
        order.insert(0, first);
    }
    Ok(order)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn ids(n: usize) -> Vec<String> {
        (0..n).map(|i| i.to_string()).collect()
    }
    #[test]
    fn every_three_track_permutation_has_one_draw_sequence() {
        let mut counts = std::collections::HashMap::new();
        for first in 0..3 {
            for second in 0..2 {
                let mut draws = vec![first, second].into_iter();
                let order = permutation(ids(3), None, |bound| {
                    let draw = draws.next().unwrap();
                    assert!(draw < bound);
                    draw
                })
                .unwrap();
                *counts.entry(order).or_insert(0) += 1;
            }
        }
        assert_eq!(counts.len(), 6);
        assert!(counts.values().all(|count| *count == 1));
    }
    #[test]
    fn no_tracks_are_lost_in_large_collections() {
        for size in [0, 1, 2, 101, 513, 10_000] {
            let expected: HashSet<_> = ids(size).into_iter().collect();
            let result = tracks(ids(size), None).unwrap();
            assert_eq!(result.len(), size);
            assert_eq!(result.into_iter().collect::<HashSet<_>>(), expected);
        }
    }
    #[test]
    fn current_is_preserved_and_duplicate_songs_count_once() {
        let result = tracks(
            vec!["a".into(), "b".into(), "a".into(), "c".into()],
            Some("b".into()),
        )
        .unwrap();
        assert_eq!(result[0], "b");
        assert_eq!(result.len(), 3);
        assert_eq!(
            result.into_iter().collect::<HashSet<_>>(),
            ["a".into(), "b".into(), "c".into()].into_iter().collect()
        );
    }
    #[test]
    fn invalid_current_and_empty_ids_are_rejected() {
        assert!(tracks(ids(3), Some("missing".into())).is_err());
        assert!(tracks(vec![String::new()], None).is_err());
    }
}
