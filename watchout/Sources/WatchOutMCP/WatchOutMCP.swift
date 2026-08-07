import Foundation
import MCP
import WatchOutCore

@main
enum WatchOutMCPMain {
  static func main() async throws {
    let store = try WatchOutStore.makeDefault()
    let server = Server(
      name: "watchout",
      version: "0.5.0",
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
      name: "watchout_get",
      description: "Get one WatchOut item by id.",
      inputSchema: .object([
        "type": .string("object"),
        "properties": .object([
          "id": .object(["type": .string("string")]),
        ]),
        "required": .array([.string("id")]),
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
          "search": .object([
            "type": .string("string"),
            "description": .string("FTS match on title/body/source/href"),
          ]),
          "source": .object([
            "type": .string("string"),
            "description": .string("Exact source tag"),
          ]),
          "limit": .object(["type": .string("number")]),
        ]),
      ])
    ),
    Tool(
      name: "watchout_search",
      description: "Search open and done WatchOut items.",
      inputSchema: .object([
        "type": .string("object"),
        "properties": .object([
          "query": .object(["type": .string("string")]),
          "limit": .object(["type": .string("number")]),
        ]),
        "required": .array([.string("query")]),
      ])
    ),
    Tool(
      name: "watchout_update",
      description: "Update fields on a WatchOut item. Omit a field to leave it unchanged; pass null for body/href to clear.",
      inputSchema: .object([
        "type": .string("object"),
        "properties": .object([
          "id": .object(["type": .string("string")]),
          "title": .object(["type": .string("string")]),
          "body": .object(["description": .string("string or null to clear")]),
          "href": .object(["description": .string("string or null to clear")]),
          "source": .object(["type": .string("string")]),
          "audience": .object([
            "type": .string("string"),
            "description": .string("human | agent | any"),
          ]),
        ]),
        "required": .array([.string("id")]),
      ])
    ),
    Tool(
      name: "watchout_complete",
      description: "Mark item(s) done. Pass id, ids[], or matching=true with list filters. Explicit only — never auto-complete.",
      inputSchema: .object([
        "type": .string("object"),
        "properties": .object([
          "id": .object(["type": .string("string")]),
          "ids": .object([
            "type": .string("array"),
            "items": .object(["type": .string("string")]),
          ]),
          "matching": .object([
            "type": .string("boolean"),
            "description": .string("When true, complete all items matching status/audience/source/search"),
          ]),
          "status": .object([
            "type": .string("string"),
            "description": .string("open | done | all (for matching; default open)"),
          ]),
          "audience": .object(["type": .string("string")]),
          "source": .object(["type": .string("string")]),
          "search": .object(["type": .string("string")]),
          "limit": .object(["type": .string("number")]),
        ]),
      ])
    ),
    Tool(
      name: "watchout_export",
      description: "Export matching items as a JSON array. Filters: status/audience/source/search/limit.",
      inputSchema: .object([
        "type": .string("object"),
        "properties": .object([
          "status": .object([
            "type": .string("string"),
            "description": .string("open | done | all (default all)"),
          ]),
          "audience": .object(["type": .string("string")]),
          "source": .object(["type": .string("string")]),
          "search": .object(["type": .string("string")]),
          "limit": .object(["type": .string("number")]),
        ]),
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
    Tool(
      name: "watchout_delete",
      description: "Delete a WatchOut item permanently.",
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

    case "watchout_get":
      guard let id = arguments?["id"]?.stringValue else {
        throw WatchOutStoreError.database("id required")
      }
      guard let item = try store.get(id: id) else {
        throw WatchOutStoreError.notFound(id)
      }
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
      let source = arguments?["source"]?.stringValue
      let search = arguments?["search"]?.stringValue
      let limit = intArgument(arguments?["limit"])
      let items = try store.list(
        AttentionListQuery(
          status: status,
          audience: audience,
          source: source,
          search: search,
          limit: limit
        )
      )
      return try string(from: items, encoder: encoder)

    case "watchout_search":
      guard let query = arguments?["query"]?.stringValue, !query.isEmpty else {
        throw WatchOutStoreError.database("query required")
      }
      let limit = intArgument(arguments?["limit"]) ?? 50
      let items = try store.list(AttentionListQuery(status: nil, search: query, limit: limit))
      return try string(from: items, encoder: encoder)

    case "watchout_update":
      guard let id = arguments?["id"]?.stringValue else {
        throw WatchOutStoreError.database("id required")
      }
      let audience: AttentionItem.Audience? = try {
        guard let raw = arguments?["audience"]?.stringValue else { return nil }
        guard let value = AttentionItem.Audience(rawValue: raw) else {
          throw WatchOutStoreError.database("audience must be human|agent|any")
        }
        return value
      }()
      let item = try store.update(
        id: id,
        AttentionItemUpdate(
          title: arguments?["title"]?.stringValue,
          body: optionalStringPatch(arguments?["body"]),
          href: optionalStringPatch(arguments?["href"]),
          source: arguments?["source"]?.stringValue,
          audience: audience
        )
      )
      return try string(from: item, encoder: encoder)

    case "watchout_complete":
      if arguments?["matching"]?.boolValue == true {
        let statusRaw = arguments?["status"]?.stringValue ?? "open"
        let status: AttentionItem.Status? = {
          switch statusRaw {
          case "all": return nil
          case "done": return .done
          default: return .open
          }
        }()
        let batch = try store.completeMatching(
          AttentionListQuery(
            status: status,
            audience: arguments?["audience"]?.stringValue.flatMap(AttentionItem.Audience.init(rawValue:)),
            source: arguments?["source"]?.stringValue,
            search: arguments?["search"]?.stringValue,
            limit: intArgument(arguments?["limit"])
          )
        )
        return try string(from: batch, encoder: encoder)
      }
      if let ids = stringArrayArgument(arguments?["ids"]), !ids.isEmpty {
        return try string(from: store.complete(ids: ids), encoder: encoder)
      }
      if let id = arguments?["id"]?.stringValue {
        return try string(from: store.complete(id: id), encoder: encoder)
      }
      throw WatchOutStoreError.database("id, ids, or matching required")

    case "watchout_export":
      let statusRaw = arguments?["status"]?.stringValue ?? "all"
      let status: AttentionItem.Status? = {
        switch statusRaw {
        case "open": return .open
        case "done": return .done
        default: return nil
        }
      }()
      let data = try store.exportJSON(
        AttentionListQuery(
          status: status,
          audience: arguments?["audience"]?.stringValue.flatMap(AttentionItem.Audience.init(rawValue:)),
          source: arguments?["source"]?.stringValue,
          search: arguments?["search"]?.stringValue,
          limit: intArgument(arguments?["limit"])
        )
      )
      return String(decoding: data, as: UTF8.self)

    case "watchout_reopen":
      guard let id = arguments?["id"]?.stringValue else {
        throw WatchOutStoreError.database("id required")
      }
      return try string(from: store.reopen(id: id), encoder: encoder)

    case "watchout_delete":
      guard let id = arguments?["id"]?.stringValue else {
        throw WatchOutStoreError.database("id required")
      }
      try store.delete(id: id)
      return #"{"deleted":"\#(id)"}"#

    default:
      throw WatchOutStoreError.database("Unknown tool: \(name)")
    }
  }

  private static func optionalStringPatch(_ value: Value?) -> String?? {
    guard let value else { return nil }
    if case .null = value { return .some(nil) }
    if let string = value.stringValue { return .some(string) }
    return nil
  }

  private static func intArgument(_ value: Value?) -> Int? {
    guard let value else { return nil }
    if let int = value.intValue { return int }
    if let double = value.doubleValue { return Int(double) }
    if let string = value.stringValue, let int = Int(string) { return int }
    return nil
  }

  private static func stringArrayArgument(_ value: Value?) -> [String]? {
    guard let value else { return nil }
    if let array = value.arrayValue {
      return array.compactMap(\.stringValue)
    }
    if let string = value.stringValue {
      return string
        .split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    }
    return nil
  }

  private static func string<T: Encodable>(from value: T, encoder: JSONEncoder) throws -> String {
    let data = try encoder.encode(value)
    return String(decoding: data, as: UTF8.self)
  }
}
