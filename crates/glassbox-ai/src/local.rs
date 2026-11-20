use std::io::{self, Read};
use std::net::SocketAddr;
use std::time::Duration;

use glassbox_ai::{Failure, Invocation, Outcome, PROTOCOL_VERSION, Reply, Request};
use serde::Deserialize;
use serde_json::json;

const MAX_BODY_BYTES: u64 = 4 * 1024 * 1024;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut bytes = Vec::new();
    io::stdin()
        .lock()
        .take(MAX_BODY_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_BODY_BYTES {
        return Err("provider request is too large".into());
    }
    let invocation: Invocation = serde_json::from_slice(&bytes)?;
    if invocation.version != PROTOCOL_VERSION {
        return Err("unsupported provider protocol version".into());
    }
    let outcome = dispatch(invocation).unwrap_or_else(|code| Outcome::Error { code });
    serde_json::to_writer(
        io::stdout().lock(),
        &Reply {
            version: PROTOCOL_VERSION,
            outcome,
        },
    )?;
    Ok(())
}

#[derive(Deserialize)]
struct Models {
    data: Vec<Model>,
}

#[derive(Deserialize)]
struct Model {
    id: String,
}

#[derive(Deserialize)]
struct Completion {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: Message,
}

#[derive(Deserialize)]
struct Message {
    content: String,
}

fn dispatch(invocation: Invocation) -> Result<Outcome, Failure> {
    let address: SocketAddr = match invocation.settings.get("address") {
        Some(value) => value.as_str().ok_or(Failure::RequestRejected)?,
        None => "127.0.0.1:11434",
    }
    .parse()
    .map_err(|_| Failure::RequestRejected)?;
    if !address.ip().is_loopback() {
        return Err(Failure::RequestRejected);
    }
    let base = format!("http://{address}/v1");
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(90))
        .redirects(0)
        .build();
    match invocation.request {
        Request::ListModels => {
            let Models { data } = decode(agent.get(&format!("{base}/models")).call())?;
            Ok(Outcome::Models {
                models: data.into_iter().map(|m| m.id).collect(),
            })
        }
        Request::Generate {
            model,
            system,
            prompt,
        } => {
            let Completion { choices } = decode(agent.post(&format!("{base}/chat/completions")).send_json(json!({
                "model": model,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                "stream": false,
            })))?;
            let message = choices
                .into_iter()
                .next()
                .ok_or(Failure::BackendFailure)?
                .message;
            Ok(Outcome::Generated {
                text: message.content,
            })
        }
    }
}

fn decode<T: serde::de::DeserializeOwned>(
    result: Result<ureq::Response, ureq::Error>,
) -> Result<T, Failure> {
    let response = result.map_err(|error| match error {
        ureq::Error::Status(401 | 403, _) => Failure::AuthenticationRequired,
        ureq::Error::Status(404, _) => Failure::UnknownModel,
        ureq::Error::Status(400..=499, _) => Failure::RequestRejected,
        ureq::Error::Status(_, _) => Failure::BackendFailure,
        ureq::Error::Transport(_) => Failure::Unavailable,
    })?;
    if !(200..300).contains(&response.status()) {
        return Err(Failure::BackendFailure);
    }
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_BODY_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Failure::BackendFailure)?;
    if bytes.len() as u64 > MAX_BODY_BYTES {
        return Err(Failure::BackendFailure);
    }
    serde_json::from_slice(&bytes).map_err(|_| Failure::BackendFailure)
}
