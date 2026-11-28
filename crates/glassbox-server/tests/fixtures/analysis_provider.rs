// A disposable subprocess used to exercise the provider protocol through the real host.
use std::io::Read;
use std::time::Duration;

fn main() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    if input.contains("list_models") {
        println!(r#"{{"version":1,"outcome":{{"status":"models","models":["fixture"]}}}}"#);
        return;
    }
    if let Some(path) = std::env::var_os("GLASSBOX_TEST_GENERATIONS") {
        use std::io::Write;
        let mut counter = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        writeln!(counter, "generated").unwrap();
    }
    std::thread::sleep(Duration::from_millis(400));
    let demo_commit = std::env::var("GLASSBOX_FIXTURE_DEMO_COMMIT").unwrap_or_default();
    let result = if !demo_commit.is_empty() && input.contains("Assess this diff") {
        let text = "Check whether resolved notes should disappear from the summary. See [the previous summary](0).";
        Box::leak(
            format!(
                r#"{{\"scores\":{{\"security\":0.1,\"correctness\":0.6,\"error_handling\":0.2,\"maintainability\":0.1,\"architecture\":0.1,\"performance\":0.1}},\"rationale\":\"Filtering changes the summary contract.\",\"observations\":[{{\"side\":\"after\",\"line\":4,\"text\":\"{text}\",\"related_locations\":[{{\"path\":\"review.ts\",\"line\":4,\"commit\":\"{demo_commit}\"}}]}}]}}"#
            )
            .into_boxed_str(),
        )
    } else if input.contains("INVALID_FIXTURE")
        || (input.contains("INVALID_ONCE") && !input.contains("Return a minimal object"))
    {
        "not JSON"
    } else if input.contains("Assess this diff") && input.contains("COMMIT_FIXTURE") {
        // Cites locations in the commits listed, one per line, in the file named by the environment
        // (HS2-B5K6GM): the first is real, the second is not in the repository.
        let file = std::env::var_os("GLASSBOX_FIXTURE_COMMIT_FILE").expect("commit file");
        let commits = std::fs::read_to_string(file).unwrap();
        let mut lines = commits.lines();
        let (real, unknown) = (lines.next().unwrap_or(""), lines.next().unwrap_or(""));
        let location = |path: &str, line: u32, commit: &str| {
            format!(r#"{{\"path\":\"{path}\",\"line\":{line},\"commit\":\"{commit}\"}}"#)
        };
        let locations = [
            location("destination.ts", 1, real),
            location("destination.ts", 1, unknown),
            location("destination.ts", 1, "HEAD"),
            location("absent.ts", 1, real),
            location("destination.ts", 99, real),
        ]
        .join(",");
        let text = r#"See [the original](0), [a lost commit](1), [a ref](2), [a missing file](3), and [a late line](4)."#;
        Box::leak(
            format!(
                r#"{{\"scores\":{{\"security\":0.1,\"correctness\":0.6,\"error_handling\":0.2,\"maintainability\":0.1,\"architecture\":0.1,\"performance\":0.1}},\"rationale\":\"Check the history.\",\"observations\":[{{\"side\":\"after\",\"line\":1,\"text\":\"{text}\",\"related_locations\":[{locations}]}}]}}"#
            )
            .into_boxed_str(),
        )
    } else if input.contains("Assess this diff") && input.contains("LINK_FIXTURE") {
        r#"{\"scores\":{\"security\":0.1,\"correctness\":0.6,\"error_handling\":0.2,\"maintainability\":0.1,\"architecture\":0.1,\"performance\":0.1},\"rationale\":\"Check the changed behavior.\",\"observations\":[{\"side\":\"after\",\"line\":1,\"text\":\"See [changed destination](0), [invalid](1), [tracked source](2), and [private file](3).\",\"related_locations\":[{\"path\":\"destination.ts\",\"line\":1},{\"path\":\"../invalid\",\"line\":1},{\"path\":\"linked.ts\",\"line\":1},{\"path\":\".git/config\",\"line\":1}]}]}"#
    } else if input.contains("Assess this diff") {
        r#"{\"scores\":{\"security\":0.1,\"correctness\":0.6,\"error_handling\":0.2,\"maintainability\":0.1,\"architecture\":0.1,\"performance\":0.1},\"rationale\":\"Check the changed behavior.\",\"observations\":[{\"side\":\"after\",\"line\":1,\"text\":\"Check the new value.\"},{\"side\":\"after\",\"line\":200,\"text\":\"Unmapped line.\"}]}"#
    } else if input.contains("Order these changed") {
        r#"[{\"index\":0,\"reason\":\"Read the modified file first.\"}]"#
    } else if input.contains("Prioritize these guidance topics when relevant: testing.") {
        r#"{\"overview\":\"Guidance emphasized testing.\",\"steps\":[{\"side\":\"after\",\"line\":1,\"text\":\"Read the new value.\"}]}"#
    } else {
        r#"{\"overview\":\"A change to the review example.\",\"steps\":[{\"side\":\"after\",\"line\":1,\"text\":\"Read the new value.\"},{\"side\":\"after\",\"line\":2,\"text\":\"Check the following line.\"}]}"#
    };
    println!(
        r#"{{"version":1,"outcome":{{"status":"generated","text":"{}"}}}}"#,
        result
    );
}
