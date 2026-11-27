//! A stand-in for the platform opener (HS2-3G613V): records the path it is given and the size of the file there.

use std::io::Write;

fn main() {
    let path = std::env::args_os().nth(1).expect("path argument");
    let log = std::env::var_os("GLASSBOX_OPENER_LOG").expect("log path");
    let size = std::fs::metadata(&path).expect("attachment copy exists").len();
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
        .expect("open log");
    writeln!(file, "{}\t{size}", path.to_string_lossy()).expect("write log");
}
