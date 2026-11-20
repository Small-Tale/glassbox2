use std::io::{self, Read};

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    if input.contains("cannot-render") {
        println!(r#"{{"version":1,"outcome":{{"status":"unavailable"}}}}"#);
        return;
    }
    assert!(["graphviz", "mermaid", "plantuml"]
        .iter()
        .any(|name| input.contains(name)));
    println!(
        r##"{{"version":1,"outcome":{{"status":"rendered","svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"260\" height=\"100\"><rect width=\"260\" height=\"100\" fill=\"#dbe8ff\"/><text x=\"28\" y=\"56\" fill=\"#315080\">Diagram fixture</text><script>window.diagramScriptRan = true</script></svg>"}}}}"##
    );
}
