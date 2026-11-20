import Foundation
import FoundationModels

private let protocolVersion = 1
private let modelID = "apple-foundation"

private struct Invocation: Decodable {
    let version: Int
    let request: Request
}

private struct Request: Decodable {
    let method: String
    let model: String?
    let system: String?
    let prompt: String?
}

private struct Reply: Encodable {
    let version = protocolVersion
    let outcome: Outcome
}

private struct Outcome: Encodable {
    let status: String
    var models: [String]?
    var text: String?
    var code: String?

    static func failure(_ code: String) -> Self {
        Self(status: "error", code: code)
    }
}

@main
struct AppleFoundationProvider {
    static func main() async throws {
        let input = FileHandle.standardInput.readDataToEndOfFile()
        let invocation = try JSONDecoder().decode(Invocation.self, from: input)
        let outcome = invocation.version == protocolVersion
            ? await respond(invocation.request)
            : Outcome.failure("request_rejected")
        let output = try JSONEncoder().encode(Reply(outcome: outcome))
        try FileHandle.standardOutput.write(contentsOf: output)
    }

    private static func respond(_ request: Request) async -> Outcome {
        let model = SystemLanguageModel.default
        guard model.isAvailable else { return .failure("unavailable") }
        switch request.method {
        case "list_models":
            return Outcome(status: "models", models: [modelID])
        case "generate":
            guard request.model == modelID else { return .failure("unknown_model") }
            guard let system = request.system, let prompt = request.prompt else {
                return .failure("request_rejected")
            }
            do {
                let session = LanguageModelSession(model: model, instructions: system)
                let result = try await session.respond(to: prompt)
                return Outcome(status: "generated", text: result.content)
            } catch LanguageModelSession.GenerationError.exceededContextWindowSize {
                return .failure("request_rejected")
            } catch {
                return .failure("backend_failure")
            }
        default:
            return .failure("request_rejected")
        }
    }
}
