import ArgumentParser
import Foundation
import WatchOutCore

@main
struct WatchOutCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "watchout",
    abstract: "WatchOut — local Attention Object Store (parking slips).",
    version: "0.1.0",
    subcommands: [
      Create.self,
      List.self,
      Complete.self,
      Reopen.self,
      Delete.self,
      Count.self,
      Path.self,
    ]
  )
}

extension WatchOutCLI {
  struct Create: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Create an open attention item")

    @Argument(help: "Title")
    var title: String

    @Option(name: .long, help: "Optional body")
    var body: String?

    @Option(name: .long, help: "Optional deep link / URL")
    var href: String?

    @Option(name: .long, help: "Source tag (manual, agent, cradle, …)")
    var source: String = "cli"

    @Option(name: .long, help: "Audience: human | agent | any")
    var audience: String = AttentionItem.Audience.human.rawValue

    @Flag(name: .long, help: "Print JSON")
    var json = false

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      guard let audience = AttentionItem.Audience(rawValue: audience) else {
        throw ValidationError("audience must be human|agent|any")
      }
      let item = try store.create(
        AttentionItemCreate(
          title: title,
          body: body,
          href: href,
          source: source,
          audience: audience
        )
      )
      try emit(item, json: json)
    }
  }

  struct List: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "List attention items")

    @Option(name: .long, help: "Filter status: open | done | all")
    var status: String = "open"

    @Option(name: .long, help: "Filter audience: human | agent | any")
    var audience: String?

    @Option(name: .long, help: "Max rows")
    var limit: Int?

    @Flag(name: .long, help: "Print JSON")
    var json = false

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      let statusFilter: AttentionItem.Status? = {
        switch status {
        case "all": return nil
        case "open": return .open
        case "done": return .done
        default: return nil
        }
      }()
      if !["all", "open", "done"].contains(status) {
        throw ValidationError("status must be open|done|all")
      }
      let audienceFilter = try audience.map { raw -> AttentionItem.Audience in
        guard let value = AttentionItem.Audience(rawValue: raw) else {
          throw ValidationError("audience must be human|agent|any")
        }
        return value
      }
      let items = try store.list(
        AttentionListQuery(status: statusFilter, audience: audienceFilter, limit: limit)
      )
      if json {
        let data = try JSONEncoder.watchOut.encode(items)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
      } else if items.isEmpty {
        print("(no items)")
      } else {
        for item in items {
          let mark = item.status == .open ? "[ ]" : "[x]"
          let href = item.href.map { "  \($0)" } ?? ""
          print("\(mark) \(item.id.prefix(8))  \(item.title)\(href)")
        }
      }
    }
  }

  struct Complete: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Mark an item done (explicit)")

    @Argument(help: "Item id")
    var id: String

    @Flag(name: .long, help: "Print JSON")
    var json = false

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      let item = try store.complete(id: id)
      try emit(item, json: json)
    }
  }

  struct Reopen: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Reopen a done item")

    @Argument(help: "Item id")
    var id: String

    @Flag(name: .long, help: "Print JSON")
    var json = false

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      let item = try store.reopen(id: id)
      try emit(item, json: json)
    }
  }

  struct Delete: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Delete an item")

    @Argument(help: "Item id")
    var id: String

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      try store.delete(id: id)
      print("deleted \(id)")
    }
  }

  struct Count: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Count open items")

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      print(try store.openCount())
    }
  }

  struct Path: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Print the SQLite database path")

    func run() throws {
      let url = try WatchOutStore.applicationSupportDirectory()
        .appendingPathComponent("watchout.sqlite")
      print(url.path)
    }
  }
}

private func emit(_ item: AttentionItem, json: Bool) throws {
  if json {
    let data = try JSONEncoder.watchOut.encode(item)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
  } else {
    print("\(item.id)\t\(item.status.rawValue)\t\(item.title)")
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
