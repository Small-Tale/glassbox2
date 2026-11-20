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
    std::thread::sleep(Duration::from_millis(400));
    let result = if input.contains("INVALID_FIXTURE") {
        "not JSON"
    } else if input.contains("Assess this diff") {
        r#"{\"scores\":{\"security\":0.1,\"correctness\":0.6,\"error_handling\":0.2,\"maintainability\":0.1,\"architecture\":0.1,\"performance\":0.1},\"rationale\":\"Check the changed behavior.\",\"observations\":[{\"side\":\"after\",\"line\":1,\"text\":\"Check the new value.\"},{\"side\":\"after\",\"line\":200,\"text\":\"Unmapped line.\"}]}"#
    } else if input.contains("Order these changed") {
        r#"[{\"index\":0,\"reason\":\"Read the modified file first.\"}]"#
    } else {
        r#"{\"overview\":\"A change to the review example.\",\"steps\":[{\"side\":\"after\",\"line\":1,\"text\":\"Read the new value.\"},{\"side\":\"after\",\"line\":2,\"text\":\"Check the following line.\"}]}"#
    };
    println!(
        r#"{{"version":1,"outcome":{{"status":"generated","text":"{}"}}}}"#,
        result
    );
}
