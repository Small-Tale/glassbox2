use std::ffi::OsStr;
use std::io::{self, Read};
use std::path::Path;

fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if let Some(output) = args.iter().position(|arg| arg == "-o") {
        let input = if let Some(idx) = args.iter().position(|arg| arg == "-i") {
            assert_eq!(args[0], "-i");
            &args[idx + 1]
        } else {
            assert_eq!(args[0], "-Tsvg");
            args.last().unwrap()
        };
        let source = std::fs::read_to_string(input).unwrap();
        std::fs::write(&args[output + 1], svg(&source)).unwrap();
    } else {
        assert!(
            args.iter()
                .any(|arg| arg == "-DPLANTUML_SECURITY_PROFILE=SANDBOX")
        );
        assert!(args.iter().any(|arg| arg == "-pipe"));
        let jar = args.iter().position(|arg| arg == "-jar").unwrap();
        assert_eq!(
            Path::new(&args[jar + 1]).extension(),
            Some(OsStr::new("jar"))
        );
        let mut source = String::new();
        io::stdin().read_to_string(&mut source).unwrap();
        print!("{}", svg(&source));
    }
}

fn svg(source: &str) -> String {
    match source {
        "invalid" => "not an image".into(),
        "oversized" => "a".repeat(4 * 1024 * 1024 + 1),
        _ => format!(r#"<svg xmlns="http://www.w3.org/2000/svg"><text>{source}</text></svg>"#),
    }
}
