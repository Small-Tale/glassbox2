use glassbox_model::{NoteAnchor, ReviewNote, TextHunk};

const MATCH_RADIUS: u32 = 50;

pub fn anchor_note(note: &ReviewNote, hunks: &[TextHunk]) -> NoteAnchor {
    let lines = || {
        hunks
            .iter()
            .flat_map(|hunk| &hunk.lines)
            .filter_map(|line| {
                line.after_line
                    .map(|number| (number, line.text.trim_end_matches('\r')))
            })
    };
    let original = lines()
        .find(|(number, _)| *number == note.start_line)
        .map(|(_, text)| text);
    let at_original = if original.is_some() {
        NoteAnchor::Original {
            line: note.start_line,
        }
    } else {
        NoteAnchor::OutsideDiff
    };
    let Some(snippet) = note
        .snippet
        .as_deref()
        .and_then(|text| text.lines().next())
        .filter(|line| !line.trim().is_empty())
    else {
        return at_original;
    };
    if original == Some(snippet) {
        return at_original;
    }

    let mut nearest = None;
    let mut ambiguous = false;
    for (line, _) in lines().filter(|(_, text)| *text == snippet) {
        let distance = line.abs_diff(note.start_line);
        if distance > MATCH_RADIUS {
            continue;
        }
        match nearest {
            Some((_, best)) if distance > best => {}
            Some((_, best)) if distance == best => ambiguous = true,
            _ => {
                nearest = Some((line, distance));
                ambiguous = false;
            }
        }
    }
    match (nearest, ambiguous, original) {
        (Some((line, _)), false, _) => NoteAnchor::Moved { line },
        (_, _, Some(_)) => NoteAnchor::Stale {
            line: note.start_line,
        },
        _ => NoteAnchor::OutsideDiff,
    }
}
