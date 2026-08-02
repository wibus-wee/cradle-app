import Foundation
import MCP
import WatchOutCore

@main
enum WatchOutMCPMain {
  static func main() async throws {
    let store = try WatchOutStore.makeDefault()
    let server = Server(
      name: "watchout",
      version: "0.1.0",
      capabilities: .init(
        tools: .init(listChanged: false)
      )
    )

    await server.withMethodHandler(ListTools.self) { _ in
      .init(tools: WatchOutMCPTools.tools)
    }

    await server.withMethodHandler(CallTool.self) { params in
      do {
        let text = try WatchOutMCPTools.call(name: params.name, arguments: params.arguments, store: store)
        return .init(content: [.text(text)], isError: false)
      } catch {
        return .init(content: [.text(String(describing: error))], isError: true)
      }
    }

    let transport = StdioTransport()
    try await server.start(transport: transport)
    await server.waitUntilCompleted()
  }
}

enum WatchOutMCPTools {
  static let tools: [Tool] = [
    Tool(
      name: "watchout_create",
      description: "Create an open WatchOut attention item (parking slip). Does not schedule agent turns.",
      inputSchema: .object([
        "type": .string("object"),
        "properties": .object([
          "title": .object(["type": .string("string"), "description": .string("Short title")]),
          "body": .object(["type": .string("string"), "description": .string("Optional details")]),
          "href": .object(["type": .string("string"), "description": .string("Optional deep link")]),
          "source": .object(["type": .string("string"), "description": .string("Provenance tag")]),
          "audience": .object([
            "type": .string("string"),
            "description": .string("human | agent | any"),
          ]),
        ]),
        "required": .array([.string("title")]),
      ])
    ),
    Tool(
      name: "watchout_list",
      description: "List WatchOut items. Default status=open.",
      inputSchema: .object([
        "type": .string("object"),
        "properties": .object([
          "status": .object([
            "type": .string("string"),
            "description": .string("open | done | all"),
          ]),
          "audience": .object([
            "type": .string("string"),
            "description": .string("human | agent | any"),
          ]),
          "limit": .object(["type": .string("number")]),
        ]),
      ])
    ),
    Tool(
      name: "watchout_complete",
      description: "Explicitly mark an item done. Prefer human completion for human audience items.",
      inputSchema: .object([
        "type": .string("object"),
        "properties": .object([
          "id": .object(["type": .string("string")]),
        ]),
        "required": .array([.string("id")]),
      ])
    ),
    Tool(
      name: "watchout_reopen",
      description: "Reopen a done item.",
      inputSchema: .object([
        "type": .string("object"),
        "properties": .object([
          "id": .object(["type": .string("string")]),
        ]),
        "required": .array([.string("id")]),
      ])
    ),
  ]

  static func call(
    name: String,
    arguments: [String: Value]?,
    store: WatchOutStore
  ) throws -> String {
    let encoder = JSONEncoder.watchOut

    switch name {
    case "watchout_create":
      let title = arguments?["title"]?.stringValue ?? ""
      let audienceRaw = arguments?["audience"]?.stringValue ?? AttentionItem.Audience.human.rawValue
      guard let audience = AttentionItem.Audience(rawValue: audienceRaw) else {
        throw WatchOutStoreError.database("audience must be human|agent|any")
      }
      let item = try store.create(
        AttentionItemCreate(
          title: title,
          body: arguments?["body"]?.stringValue,
          href: arguments?["href"]?.stringValue,
          source: arguments?["source"]?.stringValue ?? "mcp",
          audience: audience
        )
      )
      return try string(from: item, encoder: encoder)

    case "watchout_list":
      let statusRaw = arguments?["status"]?.stringValue ?? "open"
      let status: AttentionItem.Status? = {
        switch statusRaw {
        case "all": return nil
        case "done": return .done
        default: return .open
        }
      }()
      let audience = arguments?["audience"]?.stringValue.flatMap(AttentionItem.Audience.init(rawValue:))
      let limit: Int? = {
        guard let value = arguments?["limit"] else { return nil }
        if let string = value.stringValue, let int = Int(string) { return int }
        return nil
      }()
      let items = try store.list(AttentionListQuery(status: status, audience: audience, limit: limit))
      return try string(from: items, encoder: encoder)

    case "watchout_complete":
      guard let id = arguments?["id"]?.stringValue else {
        throw WatchOutStoreError.database("id required")
      }
      return try string(from: store.complete(id: id), encoder: encoder)

    case "watchout_reopen":
      guard let id = arguments?["id"]?.stringValue else {
        throw WatchOutStoreError.database("id required")
      }
      return try string(from: store.reopen(id: id), encoder: encoder)

    default:
      throw WatchOutStoreError.database("Unknown tool: \(name)")
    }
  }

  private static func string<T: Encodable>(from value: T, encoder: JSONEncoder) throws -> String {
    let data = try encoder.encode(value)
    return String(decoding: data, as: UTF8.self)
  }
}

private extension JSONEncoder {
  static let watchOut: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    encoder.dateEncodingStrategy = .iso8601
    return encoder
  }()
}
