import Foundation
import FoundationModels

private let protocolVersion = 1
private let modelID = "apple-foundation"

private struct Invocation: Decodable {
    let version: Int
    let request: Request
    let settings: Settings?
}

private struct Settings: Decodable {
    let glassbox_analysis_shape: String?
}

@Generable
private struct AnalysisObservation: Encodable {
    @Guide(description: "Use before or after, as shown on the selected diff line.")
    var side: String
    var line: Int
    @Guide(description: "Write an observation in brief prose rather than repeating the source line.")
    var text: String
}

@Generable
private struct AnalysisScores: Encodable {
    var security: Double
    var correctness: Double
    var errorHandling: Double
    var maintainability: Double
    var architecture: Double
    var performance: Double
}

@Generable
private struct RiskAnalysis: Encodable {
    var scores: AnalysisScores
    var rationale: String
    var observations: [AnalysisObservation]
}

@Generable
private struct CodeGuidance: Encodable {
    @Guide(description: "Give a one- or two-sentence overview.")
    var overview: String
    @Guide(.maximumCount(4))
    var steps: [AnalysisObservation]
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
            ? await respond(invocation.request, shape: invocation.settings?.glassbox_analysis_shape)
            : Outcome.failure("request_rejected")
        let output = try JSONEncoder().encode(Reply(outcome: outcome))
        try FileHandle.standardOutput.write(contentsOf: output)
    }

    private static func respond(_ request: Request, shape: String?) async -> Outcome {
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
                let text: String
                switch shape {
                case "risk":
                    let result = try await session.respond(to: prompt, generating: RiskAnalysis.self)
                    text = try encode(result.content)
                case "guidance":
                    var options = GenerationOptions()
                    options.maximumResponseTokens = 480
                    let result = try await session.respond(
                        to: prompt,
                        generating: CodeGuidance.self,
                        options: options
                    )
                    text = try encode(result.content)
                default:
                    text = try await session.respond(to: prompt).content
                }
                return Outcome(status: "generated", text: text)
            } catch LanguageModelSession.GenerationError.exceededContextWindowSize {
                return .failure("request_rejected")
            } catch {
                return .failure("backend_failure")
            }
        default:
            return .failure("request_rejected")
        }
    }

    private static func encode<T: Encodable>(_ result: T) throws -> String {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return String(decoding: try encoder.encode(result), as: UTF8.self)
    }
}
